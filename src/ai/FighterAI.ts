import { FighterRuntime, Vec2 } from '../types/game';
import { PerceptionSnapshot } from './PerceptionEngine';
import { clamp, lerpAngle } from '../engine/math';

export interface AICommand {
  moveDir: -1 | 0 | 1;
  jump: boolean;
  crouch: boolean;
  primaryAttack: boolean;
  specialAbility: boolean;
  parryGuard: boolean;
  spinDeflect: boolean;
  wallHang: boolean;
  rocketJump: boolean;
  surrenderQuote: string | null;
}

export class FighterAI {
  public static decide(me: FighterRuntime, p: PerceptionSnapshot, dt: number): AICommand {
    const cmd: AICommand = {
      moveDir: 0,
      jump: false,
      crouch: false,
      primaryAttack: false,
      specialAbility: false,
      parryGuard: false,
      spinDeflect: false,
      wallHang: false,
      rocketJump: false,
      surrenderQuote: null,
    };

    // Cannot act if defeated, surrendered, frozen, stunned, ragdolled, or mid-dash
    if (
      me.aiState === 'DEFEATED' ||
      me.aiState === 'VICTORY' ||
      me.surrendered ||
      me.freezeTimer > 0 ||
      me.stunTimer > 0 ||
      me.ragdollTimer > 0 ||
      me.dashTimer > 0
    ) {
      return cmd;
    }

    // Accumulate panic meter when disarmed, weapon broken, trapped, or low HP
    const hpRatio = me.hp / me.maxHp;
    if (!me.hasWeapon || me.weaponBroken) {
      me.panicMeter = Math.min(100, me.panicMeter + dt * 16);
    } else if (hpRatio < 0.3) {
      me.panicMeter = Math.min(100, me.panicMeter + dt * 9);
    } else {
      me.panicMeter = Math.max(0, me.panicMeter - dt * 4);
    }

    // 1. Check Comical Surrender first!
    if (p.surrenderCheck?.trigger) {
      me.aiState = 'SURRENDER';
      cmd.surrenderQuote = p.surrenderCheck.quote;
      return cmd;
    }

    // Update facing with horizontal deadband so crossing fighters never rapid-flip left/right
    if (
      Math.abs(p.targetPos.x - me.x) > 26 &&
      me.activeAttackTimer <= 0 &&
      me.windupTimer <= 0
    ) {
      me.facing = p.dirToTarget;
    }

    // Smoothly aim weapon strictly within a natural forward cone relative to me.facing
    const leadTime =
      me.def.id === 'rocket' || me.def.id === 'alchemist' || me.def.id === 'earth'
        ? 0.2
        : me.def.id === 'sniper' || me.def.id === 'laser'
        ? 0.04
        : 0.07;
    const aimPoint: Vec2 = {
      x: p.targetPos.x + p.targetVel.x * leadTime,
      y:
        p.targetPos.y +
        p.targetVel.y * leadTime -
        (me.def.id === 'rocket' || me.def.id === 'alchemist' || me.def.id === 'earth' ? 30 : 0),
    };
    const relX = Math.max(54, Math.abs(aimPoint.x - me.x));
    const relY = clamp(aimPoint.y - (me.y - 34), -relX * 0.48, relX * 0.4);
    const clampedPitch = Math.atan2(relY, relX);
    const desiredAngle = me.facing === 1 ? clampedPitch : Math.PI - clampedPitch;
    me.aimAngle = lerpAngle(me.aimAngle, desiredAngle, Math.min(1, dt * 16));

    // Hold wall-hang perch while enemy floor fire still rages underneath!
    if (me.wallClingTimer > 0 && p.standingInEnemyFire) {
      cmd.wallHang = true;
      me.facing = p.dirToTarget;
      return cmd;
    }

    // If committed to a wind-up (Sniper laser, Prism Laser, Hammer slam), hold poised commitment!
    if (me.windupTimer > 0) {
      if (Math.abs(p.targetPos.x - me.x) > 20) {
        me.facing = p.dirToTarget;
      }
      if (me.windupType === 'SNIPER_LASER' || me.windupType === 'LASER_CHARGE') {
        me.laserTarget = { x: p.targetPos.x, y: p.targetPos.y };
      }
      return cmd;
    }

    // 2. Environmental Hazard Response (Reposition WITHOUT disabling attacks/counters!)
    let hazardEscapeDir: -1 | 0 | 1 = 0;
    if (p.standingInEnemyFire) {
      const id = me.def.id;
      // Long Sword iconic wall-pin katana hang!
      if (id === 'long_sword' && me.hasWeapon && p.nearWallSide !== 0) {
        if (me.grounded) cmd.jump = true;
        cmd.moveDir = p.nearWallSide;
        cmd.wallHang = true;
        return cmd;
      }
      // Elemental counters immediately extinguish enemy Blue Fire / Acid!
      if (
        (id === 'ice' || id === 'water' || id === 'wind' || id === 'earth' || id === 'spear' || id === 'shadow') &&
        me.specialCooldown <= 0 &&
        me.hasWeapon
      ) {
        cmd.specialAbility = true;
      }
      if (me.grounded && me.evadeCooldown <= 0 && id !== 'anchor') {
        cmd.jump = true;
        me.evadeCooldown = 1.45;
      }
      hazardEscapeDir =
        p.nearWallSide !== 0 ? (-p.nearWallSide as -1 | 1) : (p.horizDist > 220 ? p.dirToTarget : (-p.dirToTarget as -1 | 1));
    }

    if (p.nearBlackHole && me.def.id !== 'anchor') {
      const awayFromOrb: -1 | 1 = me.x < p.nearBlackHole.x ? -1 : 1;
      hazardEscapeDir = p.nearWallSide === awayFromOrb ? (-awayFromOrb as -1 | 1) : awayFromOrb;
      if (
        (me.def.id === 'portal' || me.def.id === 'thunder' || me.def.id === 'shadow' || me.def.id === 'spear') &&
        me.specialCooldown <= 0
      ) {
        cmd.specialAbility = true;
      }
    }

    // 3. DISARMED STATE: Run cleanly to retrieve weapon OR fight bare-handed!
    if (!me.hasWeapon) {
      me.aiState = 'DISARMED';
      if (p.retrievableWeapon) {
        const dxW = p.retrievableWeapon.x - me.x;
        cmd.moveDir = dxW >= 0 ? 1 : -1;
        if (Math.abs(dxW) > 18) me.facing = cmd.moveDir;
        if (Math.abs(dxW) > 90 && me.grounded && p.blockingObstacle && me.evadeCooldown <= 0) {
          cmd.jump = true;
          me.evadeCooldown = 1.4;
        }
        if (p.incomingThreat && p.incomingThreat.isHighShot && me.grounded) {
          cmd.crouch = true;
        }
        return cmd;
      } else {
        if (p.incomingThreat && me.evadeCooldown <= 0) {
          if (p.incomingThreat.isHighShot && me.grounded) {
            cmd.crouch = true;
            me.evadeCooldown = 0.8;
          } else if (me.grounded) {
            cmd.jump = true;
            me.evadeCooldown = 1.5;
          }
        }
        if (p.horizDist > 52) {
          cmd.moveDir = p.dirToTarget;
          if (p.blockingObstacle && me.grounded && me.evadeCooldown <= 0) {
            cmd.jump = true;
            me.evadeCooldown = 1.4;
          }
        } else if (me.attackCooldown <= 0) {
          cmd.primaryAttack = true;
          if (me.grounded && me.evadeCooldown <= 0 && Math.random() < 0.25) {
            cmd.jump = true;
            me.evadeCooldown = 1.8;
          }
        }
        return cmd;
      }
    }

    // 4. REACTIVE DEFENSE / PARRY / EVASION against Incoming Threats
    if (p.incomingThreat) {
      const id = me.def.id;
      if (Math.abs(p.targetPos.x - me.x) > 20) {
        me.facing = p.incomingThreat.fromDir;
      }

      // Long Sword: Spinning Blade Shield vs flame stream/barrage, OR crisp Parry / Matrix Duck!
      if (id === 'long_sword' && me.hasWeapon) {
        if (p.incomingThreat.isStreamBarrage) {
          me.aiState = 'DEFENDING';
          cmd.spinDeflect = true;
          return cmd;
        }
        if (p.incomingThreat.projectile || p.incomingThreat.isSniperLaserLock) {
          if (me.parryTimer <= 0 && Math.sin(me.stateTimer * 4) > -0.35) {
            me.aiState = 'DEFENDING';
            cmd.parryGuard = true;
            return cmd;
          } else if (p.incomingThreat.isHighShot && me.grounded) {
            me.aiState = 'EVADING';
            cmd.crouch = true;
            return cmd;
          }
        }
      }

      // Plier: Snip incoming projectile mid-air with giant jaws!
      if (
        id === 'plier' &&
        p.incomingThreat.projectile &&
        p.incomingThreat.timeToImpact < 0.28 &&
        me.attackCooldown <= 0
      ) {
        me.aiState = 'DEFENDING';
        cmd.primaryAttack = true;
        return cmd;
      }

      // Bulwark: Face incoming threat steadily with Tower Shield!
      if (id === 'bulwark' && me.shieldIntegrity > 0 && !p.incomingThreat.isMeleeWindup) {
        me.aiState = 'DEFENDING';
        cmd.parryGuard = true;
        cmd.moveDir = p.dirToTarget;
        return cmd;
      }

      // Magnet: Repel metallic projectile right back at shooter!
      if (
        id === 'magnet' &&
        p.incomingThreat.projectile?.isMetallic &&
        me.specialCooldown <= 0
      ) {
        me.aiState = 'DEFENDING';
        cmd.specialAbility = true;
        return cmd;
      }

      // Sonic, Wind, Portal, Clone, Shadow, Glass, Earth, Chrono reactive ability counters!
      if (
        !p.incomingThreat.isMeleeWindup &&
        me.specialCooldown <= 0 &&
        (id === 'portal' ||
          id === 'clone' ||
          id === 'glass' ||
          id === 'sonic' ||
          id === 'wind' ||
          id === 'shadow' ||
          id === 'earth' ||
          id === 'time' ||
          id === 'yo_yo')
      ) {
        me.aiState = 'DEFENDING';
        cmd.specialAbility = true;
        return cmd;
      }

      // Grounded Matrix Crouch vs horizontal shots, or disciplined cooldown-gated Jump!
      if (p.incomingThreat.isHighShot && me.grounded && !p.incomingThreat.isStreamBarrage) {
        me.aiState = 'EVADING';
        cmd.crouch = true;
        return cmd;
      } else if (me.evadeCooldown <= 0 && me.grounded && !p.incomingThreat.isStreamBarrage && id !== 'anchor') {
        me.aiState = 'EVADING';
        cmd.jump = true;
        const preferredEscape = (-p.incomingThreat.fromDir) as -1 | 1;
        cmd.moveDir =
          p.nearWallSide === preferredEscape ? (-preferredEscape as -1 | 1) : preferredEscape;
        me.evadeCooldown = 1.75;
        return cmd;
      }
    }

    // 5. ARCHETYPE-SPECIFIC STALKING & COMBAT TACTICS
    const id = me.def.id;
    const minR = me.def.idealRangeMin;
    const maxR = me.def.idealRangeMax;

    // Rocket cornered Rocket-Jump!
    if (id === 'rocket' && p.nearWallSide !== 0 && p.horizDist < 135 && me.specialCooldown <= 0) {
      me.aiState = 'EVADING';
      cmd.rocketJump = true;
      return cmd;
    }

    // Rubber: Composed athletic brawler with long stretchy club whips & deliberate elastic lunge!
    if (id === 'rubber') {
      if (p.horizDist > maxR) {
        me.aiState = 'STALKING';
        cmd.moveDir = p.dirToTarget;
      } else if (p.horizDist < minR * 0.75) {
        me.aiState = 'EVADING';
        cmd.moveDir =
          p.nearWallSide === (-p.dirToTarget as -1 | 1) ? 0 : (-p.dirToTarget as -1 | 1);
      } else {
        me.aiState = 'ATTACKING';
        cmd.moveDir = 0;
      }

      if (me.specialCooldown <= 0 && p.horizDist > 115 && p.horizDist < 310) {
        cmd.specialAbility = true;
      } else if (me.attackCooldown <= 0 && p.distToTarget < 155) {
        cmd.primaryAttack = true;
      }
      if (hazardEscapeDir !== 0 && cmd.moveDir === 0) cmd.moveDir = hazardEscapeDir;
      return cmd;
    }

    // Bulwark: Steady advancing fortress!
    if (id === 'bulwark' && me.shieldIntegrity > 0) {
      cmd.parryGuard = true;
      if (p.horizDist > 75) {
        me.aiState = 'STALKING';
        cmd.moveDir = p.dirToTarget;
        if (p.blockingObstacle && me.grounded && p.horizDist < 120) {
          cmd.specialAbility = me.specialCooldown <= 0;
        }
      } else {
        me.aiState = 'ATTACKING';
        if (me.specialCooldown <= 0) cmd.specialAbility = true;
        else if (me.attackCooldown <= 0) cmd.primaryAttack = true;
      }
      return cmd;
    }

    // Obstacle navigation or destruction for heavy / shredder / acoustic fighters
    if (p.blockingObstacle) {
      const obsDist = Math.abs(p.blockingObstacle.x + p.blockingObstacle.width * 0.5 - me.x);
      if (
        (id === 'hammer' ||
          id === 'plier' ||
          id === 'long_sword' ||
          id === 'chainsaw' ||
          id === 'anchor' ||
          id === 'sonic') &&
        obsDist < 120
      ) {
        me.aiState = 'ATTACKING';
        if ((id === 'hammer' || id === 'chainsaw' || id === 'sonic' || id === 'anchor') && me.specialCooldown <= 0) {
          cmd.specialAbility = true;
        } else if (me.attackCooldown <= 0) {
          cmd.primaryAttack = true;
        } else {
          cmd.moveDir = p.dirToTarget;
        }
        return cmd;
      } else if ((id === 'spear' || id === 'shadow') && me.specialCooldown <= 0 && obsDist < 180) {
        me.aiState = 'ATTACKING';
        cmd.specialAbility = true;
        return cmd;
      } else if (obsDist < 90 && me.grounded && id !== 'glass' && id !== 'earth' && me.evadeCooldown <= 0) {
        cmd.jump = true;
        cmd.moveDir = p.dirToTarget;
        me.evadeCooldown = 1.6;
      }
    }

    // Distance regulation (Stalking / Kiting / Poised Combat Stance)
    if (p.horizDist > maxR) {
      me.aiState = 'STALKING';
      cmd.moveDir = p.dirToTarget;

      // Gap-closing / pull specials for aggressive rushers & harvesters
      if (
        (id === 'long_sword' ||
          id === 'thunder' ||
          id === 'chainsaw' ||
          id === 'spear' ||
          id === 'shadow' ||
          id === 'water' ||
          id === 'scythe' ||
          id === 'whip') &&
        me.specialCooldown <= 0 &&
        p.horizDist < 310 &&
        (p.hasLineOfSight || id === 'shadow' || id === 'spear')
      ) {
        me.aiState = 'ATTACKING';
        cmd.specialAbility = true;
        return cmd;
      }
      // Spawners/Zoners can set traps from afar
      if (
        (id === 'portal' ||
          id === 'clone' ||
          id === 'black_hole' ||
          id === 'glass' ||
          id === 'earth' ||
          id === 'wind' ||
          id === 'time') &&
        me.specialCooldown <= 0
      ) {
        cmd.specialAbility = true;
      }
    } else if (p.horizDist < minR) {
      me.aiState = 'EVADING';
      const retreatDir = (-p.dirToTarget) as -1 | 1;
      if (p.nearWallSide === retreatDir) {
        if (me.grounded && me.evadeCooldown <= 0 && p.horizDist < 105 && id !== 'anchor') {
          cmd.jump = true;
          cmd.moveDir = p.dirToTarget;
          me.evadeCooldown = 2.1;
        } else {
          cmd.moveDir = 0;
        }
      } else {
        cmd.moveDir = retreatDir;
      }

      // Point-blank defensive specials or counter-fire
      if (me.specialCooldown <= 0) {
        if (
          id === 'portal' ||
          id === 'gravity' ||
          id === 'ice' ||
          id === 'blue_fire' ||
          id === 'magnet' ||
          id === 'glass' ||
          id === 'sonic' ||
          id === 'wind' ||
          id === 'water' ||
          id === 'yo_yo' ||
          id === 'time' ||
          id === 'alchemist' ||
          id === 'boomerang' ||
          id === 'earth'
        ) {
          cmd.specialAbility = true;
        }
      } else if (me.attackCooldown <= 0) {
        cmd.primaryAttack = true;
      }
    } else {
      // Inside Ideal Effective Combat Range
      me.aiState = 'ATTACKING';
      if (maxR <= 175 && p.horizDist > (minR + maxR) * 0.55) {
        cmd.moveDir = p.dirToTarget;
      } else {
        cmd.moveDir = 0;
      }

      if (me.specialCooldown <= 0 && id !== 'portal') {
        cmd.specialAbility = true;
      } else if (id === 'portal' && me.specialCooldown <= 0 && p.horizDist > 220) {
        cmd.specialAbility = true;
      } else if (
        me.attackCooldown <= 0 &&
        (p.hasLineOfSight ||
          maxR < 180 ||
          id === 'rocket' ||
          id === 'alchemist' ||
          id === 'boomerang' ||
          id === 'sonic' ||
          id === 'gravity' ||
          id === 'portal')
      ) {
        cmd.primaryAttack = true;
      }
    }

    if (hazardEscapeDir !== 0 && cmd.moveDir === 0) {
      cmd.moveDir = hazardEscapeDir;
    }

    return cmd;
  }
}

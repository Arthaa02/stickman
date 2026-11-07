import {
  ArenaObstacle,
  DroppedWeapon,
  FighterRuntime,
  FloorZone,
  PortalPair,
  Projectile,
  ShadowClone,
  SingularityOrb,
  Vec2,
} from '../types/game';
import { segmentIntersectsAABB } from '../engine/math';

export interface ArenaPerceptionContext {
  arenaLeft: number;
  arenaRight: number;
  arenaTop: number;
  floorY: number;
  fighters: [FighterRuntime, FighterRuntime];
  projectiles: Projectile[];
  obstacles: ArenaObstacle[];
  floorZones: FloorZone[];
  portals: PortalPair[];
  singularities: SingularityOrb[];
  droppedWeapons: DroppedWeapon[];
  clones: ShadowClone[];
}

export interface IncomingThreat {
  projectile?: Projectile;
  timeToImpact: number;
  fromDir: 1 | -1;
  isHighShot: boolean;
  isStreamBarrage: boolean;
  isMeleeWindup: boolean;
  isSniperLaserLock: boolean;
}

export interface PerceptionSnapshot {
  targetPos: Vec2;
  targetVel: Vec2;
  targetingClone: boolean;
  realEnemy: FighterRuntime;
  distToTarget: number;
  horizDist: number;
  vertDist: number;
  dirToTarget: 1 | -1;
  hasLineOfSight: boolean;
  blockingObstacle: ArenaObstacle | null;
  nearbyGlassWallCount: number;
  trappedInCornerOrGlass: boolean;
  incomingThreat: IncomingThreat | null;
  standingInEnemyFire: boolean;
  standingOnIce: boolean;
  nearBlackHole: SingularityOrb | null;
  retrievableWeapon: DroppedWeapon | null;
  nearWallSide: -1 | 0 | 1;
  surrenderCheck: { trigger: boolean; quote: string } | null;
}

export class PerceptionEngine {
  public static scan(me: FighterRuntime, ctx: ArenaPerceptionContext): PerceptionSnapshot {
    const enemySlot = me.slot === 0 ? 1 : 0;
    const realEnemy = ctx.fighters[enemySlot];

    // 1. Apparent Target Selection (Shadow Clones genuinely confuse enemy AI!)
    const enemyClones = ctx.clones.filter((c) => c.ownerSlot === enemySlot);
    let targetPos: Vec2 = { x: realEnemy.x, y: realEnemy.y - 24 };
    let targetVel: Vec2 = { x: realEnemy.vx, y: realEnemy.vy };
    let targetingClone = false;

    if (enemyClones.length > 0) {
      // Pick closest apparent figure (real enemy or shadow clone)
      let bestDist = Math.hypot(realEnemy.x - me.x, realEnemy.y - me.y);
      for (const cl of enemyClones) {
        const d = Math.hypot(cl.x - me.x, cl.y - me.y) * 0.9; // clones draw aggro aggressively!
        if (d < bestDist) {
          bestDist = d;
          targetPos = { x: cl.x, y: cl.y - 24 };
          targetVel = { x: cl.vx, y: cl.vy };
          targetingClone = true;
        }
      }
    }

    const dx = targetPos.x - me.x;
    const dy = targetPos.y - (me.y - 24);
    const distToTarget = Math.hypot(dx, dy);
    const horizDist = Math.abs(dx);
    const dirToTarget: 1 | -1 = dx >= 0 ? 1 : -1;

    // 2. Raycast Line-of-Sight against Glass Walls / Pillars
    let hasLineOfSight = true;
    let blockingObstacle: ArenaObstacle | null = null;
    let bestT = 1.0;

    for (const obs of ctx.obstacles) {
      const hit = segmentIntersectsAABB(
        me.x,
        me.y - 26,
        targetPos.x,
        targetPos.y,
        obs.x,
        obs.y,
        obs.width,
        obs.height
      );
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        hasLineOfSight = false;
        blockingObstacle = obs;
      }
    }

    // 3. Check Wall Proximity & Glass Wall Enclosure
    let nearbyGlassWallCount = 0;
    let blockedLeft = me.x - ctx.arenaLeft < 78;
    let blockedRight = ctx.arenaRight - me.x < 78;

    for (const obs of ctx.obstacles) {
      const cx = obs.x + obs.width * 0.5;
      const distObs = Math.abs(cx - me.x);
      if (distObs < 260) {
        nearbyGlassWallCount++;
      }
      if (cx < me.x && me.x - (obs.x + obs.width) < 76 && obs.y < me.y + 15) {
        blockedLeft = true;
      }
      if (cx > me.x && obs.x - me.x < 76 && obs.y < me.y + 15) {
        blockedRight = true;
      }
    }

    const trappedInCornerOrGlass =
      (blockedLeft && blockedRight && nearbyGlassWallCount >= 2) || nearbyGlassWallCount >= 4;

    const nearWallSide: -1 | 0 | 1 =
      me.x - ctx.arenaLeft < 85 ? -1 : ctx.arenaRight - me.x < 85 ? 1 : 0;

    // 4. Scan Incoming Projectiles & Dangerous Enemy Wind-ups
    let incomingThreat: IncomingThreat | null = null;
    let bestTTI = 999;
    let incomingCount = 0;

    for (const p of ctx.projectiles) {
      if (p.ownerSlot === me.slot) continue;
      const toMeX = me.x - p.x;
      if (toMeX * p.vx > 0 || Math.hypot(toMeX, me.y - 24 - p.y) < 110) {
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const distP = Math.hypot(toMeX, me.y - 24 - p.y);
        const tti = distP / speed;
        const predictedY = p.y + p.vy * tti + 0.5 * p.gravity * tti * tti;
        if (tti < 0.8 && Math.abs(predictedY - (me.y - 18)) < 68) {
          incomingCount++;
          if (tti < bestTTI) {
            bestTTI = tti;
            incomingThreat = {
              projectile: p,
              timeToImpact: tti,
              fromDir: p.x > me.x ? 1 : -1,
              isHighShot: predictedY < me.y - 14,
              isStreamBarrage: p.kind === 'FLAME_STREAM' || incomingCount >= 2,
              isMeleeWindup: false,
              isSniperLaserLock: false,
            };
          } else if (incomingThreat && (p.kind === 'FLAME_STREAM' || incomingCount >= 2)) {
            incomingThreat.isStreamBarrage = true;
          }
        }
      }
    }

    // Also perceive Sniper aiming laser, Prism Laser charge & Hammer/Anchor earthquake windup!
    if (!incomingThreat && realEnemy.windupTimer > 0) {
      if (
        (realEnemy.windupType === 'SNIPER_LASER' || realEnemy.windupType === 'LASER_CHARGE') &&
        realEnemy.windupTimer < 0.45 &&
        hasLineOfSight
      ) {
        incomingThreat = {
          timeToImpact: realEnemy.windupTimer,
          fromDir: realEnemy.x > me.x ? 1 : -1,
          isHighShot: true,
          isStreamBarrage: false,
          isMeleeWindup: false,
          isSniperLaserLock: true,
        };
      } else if (realEnemy.windupType === 'HAMMER_SLAM' && horizDist < 195) {
        incomingThreat = {
          timeToImpact: realEnemy.windupTimer,
          fromDir: realEnemy.x > me.x ? 1 : -1,
          isHighShot: false,
          isStreamBarrage: false,
          isMeleeWindup: true,
          isSniperLaserLock: false,
        };
      }
    }

    // 5. Hazard Zones & Black Holes
    let standingInEnemyFire = false;
    let standingOnIce = false;
    for (const z of ctx.floorZones) {
      if (me.x >= z.x && me.x <= z.x + z.width && Math.abs(me.y - (ctx.floorY - 58)) < 38) {
        if (
          (z.kind === 'BLUE_FIRE' || z.kind === 'ACID_POOL' || z.kind === 'TORNADO') &&
          z.ownerSlot !== me.slot
        ) {
          standingInEnemyFire = true;
        }
        if (z.kind === 'ICE_SHEET' && z.ownerSlot !== me.slot) standingOnIce = true;
      }
    }

    let nearBlackHole: SingularityOrb | null = null;
    for (const orb of ctx.singularities) {
      if (orb.ownerSlot !== me.slot) {
        const dOrb = Math.hypot(orb.x - me.x, orb.y - (me.y - 14));
        if (dOrb < orb.pullRadius * 1.05) {
          nearBlackHole = orb;
          break;
        }
      }
    }

    // 6. Dropped Weapon Retrieval Check
    let retrievableWeapon: DroppedWeapon | null = null;
    if (!me.hasWeapon && !me.weaponBroken) {
      let bestWDist = 9999;
      for (const dw of ctx.droppedWeapons) {
        if (!dw.broken && dw.pickupDelay <= 0 && dw.originalOwnerSlot === me.slot) {
          const d = Math.hypot(dw.x - me.x, dw.y - me.y);
          if (d < bestWDist) {
            bestWDist = d;
            retrievableWeapon = dw;
          }
        }
      }
    }

    // 7. Comical Surrender Evaluation (Authentic comedic helplessness triggers!)
    const surrenderCheck = PerceptionEngine.evaluateComicalSurrender(
      me,
      realEnemy,
      trappedInCornerOrGlass,
      nearbyGlassWallCount,
      incomingThreat
    );

    return {
      targetPos,
      targetVel,
      targetingClone,
      realEnemy,
      distToTarget,
      horizDist,
      vertDist: dy,
      dirToTarget,
      hasLineOfSight,
      blockingObstacle,
      nearbyGlassWallCount,
      trappedInCornerOrGlass,
      incomingThreat,
      standingInEnemyFire,
      standingOnIce,
      nearBlackHole,
      retrievableWeapon,
      nearWallSide,
      surrenderCheck,
    };
  }

  private static evaluateComicalSurrender(
    me: FighterRuntime,
    enemy: FighterRuntime,
    trappedInGlass: boolean,
    glassCount: number,
    threat: IncomingThreat | null
  ): { trigger: boolean; quote: string } | null {
    if (me.surrendered || enemy.surrendered || enemy.hp <= 0 || me.hp <= 0) {
      return null;
    }

    const hpRatio = me.hp / me.maxHp;
    const enemyHpRatio = enemy.hp / enemy.maxHp;

    // Case A: Weapon snapped/shattered (e.g. Katana snapped by Plier, Rifle sliced by Sword, or Bulwark Shield shattered by Hammer!)
    if (me.weaponBroken && hpRatio < 0.52 && enemyHpRatio > 0.3 && me.panicMeter > 25) {
      return {
        trigger: true,
        quote: me.def.surrenderQuotes[0] || 'Well done',
      };
    }

    // Case B: Trapped between thick layers of Glass pillars (exact 00:34 Plier vs Glass scene!)
    if (
      enemy.def.id === 'glass' &&
      trappedInGlass &&
      glassCount >= 3 &&
      hpRatio < 0.74 &&
      enemyHpRatio > 0.35
    ) {
      return {
        trigger: true,
        quote: 'Okay you are the winner',
      };
    }

    // Case B2: Blue Fire facing an enemy whose blade is now roaring with Blue Fire's own flames at critical HP (exact 01:14 scene!)
    if (
      me.def.id === 'blue_fire' &&
      enemy.blueFireCoated &&
      enemy.hasWeapon &&
      hpRatio < 0.26 &&
      enemyHpRatio > 0.32 &&
      Math.abs(enemy.x - me.x) < 155
    ) {
      return {
        trigger: true,
        quote: 'Okay you are the winner',
      };
    }

    // Case C: Repeatedly disarmed by Magnet and badly losing!
    if (!me.hasWeapon && me.disarmCount >= 2 && hpRatio < 0.28 && enemyHpRatio > 0.6) {
      return {
        trigger: true,
        quote: 'Stop stealing my weapon! Okay you win bro!',
      };
    }

    // Case D: Overwhelmed at critical HP (< 13%) while disarmed or staring down Sniper laser / Hammer windup
    if (
      hpRatio < 0.13 &&
      enemyHpRatio > 0.68 &&
      (!me.hasWeapon || threat?.isSniperLaserLock || threat?.isMeleeWindup) &&
      me.panicMeter > 55
    ) {
      const quotes = [
        "Nope, I'm out!",
        'Okay you win bro!',
        'Ref! Call the match, I choose life!',
        ...me.def.surrenderQuotes,
      ];
      return {
        trigger: true,
        quote: quotes[Math.floor(Math.random() * quotes.length)],
      };
    }

    return null;
  }
}


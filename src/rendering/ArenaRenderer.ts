import {
  ARENA_FLOOR_Y,
  ARENA_HEIGHT,
  ARENA_PADDING_X,
  ARENA_TOP,
  ARENA_WIDTH,
  ArenaWorld,
} from '../engine/ArenaWorld';
import { HEAD_RADIUS } from '../engine/ragdoll';
import { clamp } from '../engine/math';
import { AssetService } from '../services/assetService';
import { FighterRuntime, StickmanSkeleton } from '../types/game';
import { drawProceduralWeaponVector } from './proceduralAssets';

export class ArenaRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  public readonly assets: AssetService;

  constructor(canvas: HTMLCanvasElement, assets: AssetService) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas context unavailable');
    this.ctx = ctx;
    this.assets = assets;
    this.setupHighDpi();
  }

  public setupHighDpi(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = ARENA_WIDTH * dpr;
    this.canvas.height = ARENA_HEIGHT * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public render(world: ArenaWorld): void {
    const ctx = this.ctx;
    ctx.save();

    // Crisp pure white outer & inner background (100% clean classic Stickman Tournament look!)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Smooth harmonic camera recoil on heavy slams, rifle shots, & clashes (no per-frame random jitter!)
    ctx.save();
    if (world.screenShake > 0.15) {
      const sx = Math.sin(world.elapsedSec * 52) * world.screenShake * 0.52;
      const sy = Math.cos(world.elapsedSec * 41) * world.screenShake * 0.38;
      ctx.translate(sx, sy);
    }

    // Clip dynamic arena floor/wall effects neatly inside the white arena rectangle
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      ARENA_PADDING_X,
      ARENA_TOP,
      ARENA_WIDTH - ARENA_PADDING_X * 2,
      ARENA_FLOOR_Y - ARENA_TOP
    );
    ctx.clip();

    // 1. Portals & Singularity Black Holes
    this.drawPortals(world);
    this.drawSingularities(world);

    // 2. Cascading Glass Walls & Pillars (clipped cleanly at floor as they erupt!)
    this.drawObstacles(world);

    // 3. Dropped Weapons, Severed Weapon Tips & Glass Shards
    this.drawDroppedWeapons(world);
    this.drawGlassShards(world);

    // 4. Shadow Clones
    this.drawClones(world);

    // 5. Stickman Fighters (Full-body solid signature colors + articulated oversized weapons)
    for (const f of world.fighters) {
      this.drawFighter(f, world);
    }

    // 6. Floor Hazard Zones (drawn with dancing flames licking over feet like 00:56–01:14!)
    this.drawFloorZones(world);

    // 7. Shockwaves, Slash Arcs, Golden Bullet Tracers, Projectiles & Sparks
    this.drawShockwaves(world);
    this.drawSlashTrails(world);
    this.drawLaserTracers(world);
    this.drawProjectiles(world);
    this.drawParticles(world);

    ctx.restore(); // end arena interior clip

    // 8. Crisp Classic Black Rectangular Arena Frame
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.6;
    ctx.strokeRect(
      ARENA_PADDING_X,
      ARENA_TOP,
      ARENA_WIDTH - ARENA_PADDING_X * 2,
      ARENA_FLOOR_Y - ARENA_TOP
    );

    // 9. Match-Start Fighter Name Labels & Classic Colored Floating Dialogue
    this.drawFighterIntroNames(world);
    for (const f of world.fighters) {
      if (f.speech && f.speech.timer > 0) {
        this.drawSpeechText(f);
      }
    }

    ctx.restore(); // end screen-shake transform

    // 10. Slim Header Strip & Classic End-of-Round "WINNER : <NAME>" Typography
    this.drawArenaHUD(world);

    ctx.restore();
  }

  private drawFloorZones(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const z of world.floorZones) {
      const alpha = clamp(z.life / 0.8, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (z.kind === 'BLUE_FIRE') {
        // Dense roaring royal-blue outer flame bed (exact 00:56–01:14 look!)
        ctx.fillStyle = '#0b3be0';
        ctx.beginPath();
        ctx.moveTo(z.x, ARENA_FLOOR_Y + 2);
        const step = 13;
        for (let fx = z.x; fx <= z.x + z.width; fx += step) {
          const wave1 = Math.sin(world.elapsedSec * 22 + fx * 0.13) * 11;
          const wave2 = Math.cos(world.elapsedSec * 17 - fx * 0.08) * 7;
          const peakH = 26 + wave1 + wave2;
          ctx.lineTo(fx + step * 0.5, ARENA_FLOOR_Y - Math.max(10, peakH));
          ctx.lineTo(Math.min(fx + step, z.x + z.width), ARENA_FLOOR_Y - 8 - Math.abs(wave2) * 0.5);
        }
        ctx.lineTo(z.x + z.width, ARENA_FLOOR_Y + 2);
        ctx.closePath();
        ctx.fill();

        // Bright cyan inner flame tongues
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(z.x + 4, ARENA_FLOOR_Y + 2);
        for (let fx = z.x + 4; fx <= z.x + z.width - 4; fx += 15) {
          const h = 14 + Math.cos(world.elapsedSec * 27 + fx * 0.19) * 8;
          ctx.lineTo(fx + 7, ARENA_FLOOR_Y - Math.max(6, h));
          ctx.lineTo(Math.min(fx + 15, z.x + z.width - 4), ARENA_FLOOR_Y - 3);
        }
        ctx.lineTo(z.x + z.width - 4, ARENA_FLOOR_Y + 2);
        ctx.closePath();
        ctx.fill();
      } else if (z.kind === 'ICE_SHEET') {
        ctx.fillStyle = 'rgba(125, 211, 252, 0.72)';
        ctx.fillRect(z.x, ARENA_FLOOR_Y - 6, z.width, 7);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(z.x, ARENA_FLOOR_Y - 6, z.width, 6);
      } else if (z.kind === 'ACID_POOL') {
        ctx.fillStyle = 'rgba(132, 204, 22, 0.78)';
        ctx.beginPath();
        ctx.roundRect(z.x, ARENA_FLOOR_Y - 7, z.width, 8, 4);
        ctx.fill();
        ctx.fillStyle = '#bef264';
        for (let bx = z.x + 14; bx < z.x + z.width - 12; bx += 26) {
          const r = 2.5 + Math.abs(Math.sin(world.elapsedSec * 9 + bx * 0.2)) * 3.5;
          const by = ARENA_FLOOR_Y - 6 - ((world.elapsedSec * 24 + bx) % 12);
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (z.kind === 'TORNADO') {
        const cx = z.x + z.width * 0.5;
        const grad = ctx.createLinearGradient(cx, ARENA_FLOOR_Y - 178, cx, ARENA_FLOOR_Y);
        grad.addColorStop(0, 'rgba(20, 184, 166, 0.08)');
        grad.addColorStop(0.5, 'rgba(45, 212, 191, 0.26)');
        grad.addColorStop(1, 'rgba(13, 148, 136, 0.36)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - z.width * 0.56, ARENA_FLOOR_Y - 178);
        ctx.lineTo(cx + z.width * 0.56, ARENA_FLOOR_Y - 178);
        ctx.lineTo(cx + z.width * 0.22, ARENA_FLOOR_Y);
        ctx.lineTo(cx - z.width * 0.22, ARENA_FLOOR_Y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(13, 148, 136, 0.78)';
        ctx.lineWidth = 2.2;
        for (let ring = 0; ring < 6; ring++) {
          const ry = ARENA_FLOOR_Y - 16 - ring * 27;
          const rw = 16 + ring * 7.5;
          const wobble = Math.sin(world.elapsedSec * 18 + ring * 1.4) * 7;
          ctx.beginPath();
          ctx.ellipse(cx + wobble, ry, rw, 5.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (z.kind === 'CHRONO_FIELD') {
        const cx = z.x + z.width * 0.5;
        const radius = z.width * 0.5;
        ctx.fillStyle = 'rgba(234, 179, 8, 0.11)';
        ctx.strokeStyle = 'rgba(202, 138, 4, 0.65)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(cx, ARENA_FLOOR_Y, radius, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Rotating golden clockwork hands inside dome
        const clockY = ARENA_FLOOR_Y - radius * 0.45;
        ctx.strokeStyle = 'rgba(161, 98, 7, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, clockY, 22, 0, Math.PI * 2);
        ctx.moveTo(cx, clockY);
        ctx.lineTo(cx + Math.cos(world.elapsedSec * 4) * 18, clockY + Math.sin(world.elapsedSec * 4) * 18);
        ctx.moveTo(cx, clockY);
        ctx.lineTo(cx + Math.cos(-world.elapsedSec * 1.4) * 12, clockY + Math.sin(-world.elapsedSec * 1.4) * 12);
        ctx.stroke();
      } else if (z.kind === 'GRAVITY_CRUSH') {
        const grad = ctx.createLinearGradient(z.x, ARENA_FLOOR_Y - 95, z.x, ARENA_FLOOR_Y);
        grad.addColorStop(0, 'rgba(109, 40, 217, 0)');
        grad.addColorStop(1, 'rgba(109, 40, 217, 0.25)');
        ctx.fillStyle = grad;
        ctx.fillRect(z.x, ARENA_FLOOR_Y - 95, z.width, 95);

        ctx.strokeStyle = 'rgba(109, 40, 217, 0.55)';
        ctx.lineWidth = 2;
        const dropOffset = (world.elapsedSec * 90) % 36;
        for (let gx = z.x + 24; gx < z.x + z.width - 16; gx += 42) {
          const gy = ARENA_FLOOR_Y - 68 + dropOffset;
          ctx.beginPath();
          ctx.moveTo(gx - 7, gy - 6);
          ctx.lineTo(gx, gy);
          ctx.lineTo(gx + 7, gy - 6);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawPortals(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const pair of world.portals) {
      ctx.save();
      for (const ep of [pair.orange, pair.blue]) {
        ctx.save();
        ctx.translate(ep.x, ep.y);
        ctx.strokeStyle = ep.color;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 28, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = ep.color === '#f97316' ? 'rgba(249, 115, 22, 0.18)' : 'rgba(14, 165, 233, 0.18)';
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  private drawSingularities(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const orb of world.singularities) {
      ctx.save();
      ctx.translate(orb.x, orb.y);

      ctx.strokeStyle = 'rgba(126, 34, 206, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, orb.pullRadius * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.rotate(world.elapsedSec * 5.5);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, orb.radius + 14, 6.5, 0.3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#090d16';
      ctx.beginPath();
      ctx.arc(0, 0, orb.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawObstacles(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const obs of world.obstacles) {
      ctx.save();
      const visibleH = Math.max(2, ARENA_FLOOR_Y - obs.y);

      if (obs.kind === 'STONE_PILLAR') {
        const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.width, obs.y);
        grad.addColorStop(0, '#78716c');
        grad.addColorStop(0.5, '#a8a29e');
        grad.addColorStop(1, '#57534e');
        ctx.fillStyle = grad;
        ctx.strokeStyle = '#44403c';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.rect(obs.x, obs.y, obs.width, visibleH);
        ctx.fill();
        ctx.stroke();

        // Chiseled granite strata lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(obs.x + 5, obs.y + 5);
        ctx.lineTo(obs.x + 5, ARENA_FLOOR_Y - 4);
        ctx.stroke();
      } else {
        // Classic translucent slate-seafoam glass pillar look (00:28–00:36 in video!)
        const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.width, obs.y);
        grad.addColorStop(0, 'rgba(116, 168, 162, 0.84)');
        grad.addColorStop(0.45, 'rgba(142, 192, 186, 0.72)');
        grad.addColorStop(1, 'rgba(98, 150, 145, 0.86)');
        ctx.fillStyle = grad;
        ctx.strokeStyle = '#4c7c77';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.rect(obs.x, obs.y, obs.width, visibleH);
        ctx.fill();
        ctx.stroke();

        // Clean vertical glass highlight sheen
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(obs.x + 6, obs.y + 6);
        ctx.lineTo(obs.x + 6, ARENA_FLOOR_Y - 4);
        ctx.stroke();
      }

      // Fracture cracks when damaged
      if (obs.cracks.length > 0) {
        ctx.strokeStyle = obs.kind === 'STONE_PILLAR' ? 'rgba(41, 37, 36, 0.85)' : 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (const cr of obs.cracks) {
          if (obs.y + cr.y1 < ARENA_FLOOR_Y && obs.y + cr.y2 < ARENA_FLOOR_Y) {
            ctx.moveTo(obs.x + cr.x1, obs.y + cr.y1);
            ctx.lineTo(obs.x + cr.x2, obs.y + cr.y2);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawDroppedWeapons(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const dw of world.droppedWeapons) {
      ctx.save();
      ctx.translate(dw.x, dw.y);
      ctx.rotate(dw.angle);
      drawProceduralWeaponVector(ctx, dw.fighterId, {
        broken: dw.broken,
        severedTipOnly: dw.pickupDelay > 50,
        blueFireCoated: dw.blueFireCoated,
        timeSec: world.elapsedSec,
      });
      ctx.restore();
    }
  }

  private drawGlassShards(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const gs of world.glassShards) {
      ctx.save();
      ctx.translate(gs.x, gs.y);
      ctx.rotate(gs.angle);
      ctx.fillStyle = 'rgba(116, 168, 162, 0.85)';
      ctx.strokeStyle = '#4c7c77';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-gs.size, -gs.size * 0.45);
      ctx.lineTo(gs.size, 0);
      ctx.lineTo(-gs.size * 0.25, gs.size * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawClones(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const cl of world.clones) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      this.drawSkeletonBackAndTorso(cl.skeleton, '#4f46e5', 5.2);
      ctx.save();
      ctx.translate(cl.skeleton.handR.x, cl.skeleton.handR.y);
      if (cl.facing === -1) ctx.scale(-1, 1);
      drawProceduralWeaponVector(ctx, 'clone', { timeSec: world.elapsedSec });
      ctx.restore();
      this.drawSkeletonFrontArm(cl.skeleton, '#4f46e5', 5.2);
      ctx.restore();
    }
  }

  private drawFighter(f: FighterRuntime, world: ArenaWorld): void {
    const ctx = this.ctx;
    const timeSec = world.elapsedSec;

    // 1. Subtle dash / flash-step afterimages
    for (const ai of f.afterimages) {
      ctx.save();
      ctx.globalAlpha = ai.alpha * 0.35;
      this.drawSkeletonBackAndTorso(ai.skeleton, ai.color, 5.2);
      this.drawSkeletonFrontArm(ai.skeleton, ai.color, 5.2);
      ctx.restore();
    }

    // 2. Sniper / Prism Laser Aiming Sight Line!
    if (
      (f.windupType === 'SNIPER_LASER' || f.windupType === 'LASER_CHARGE') &&
      f.windupTimer > 0 &&
      f.laserTarget
    ) {
      const progress = 1 - f.windupTimer / Math.max(0.1, f.windupMax);
      const isPrism = f.windupType === 'LASER_CHARGE';
      ctx.save();
      ctx.strokeStyle = isPrism
        ? progress > 0.72
          ? 'rgba(244, 63, 94, 0.9)'
          : 'rgba(251, 113, 133, 0.5)'
        : progress > 0.78
          ? 'rgba(220, 38, 38, 0.85)'
          : 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = progress > 0.75 ? 2.2 : 1.3;
      if (progress < 0.72) ctx.setLineDash([8, 6]);
      const muzzleDirX = Math.cos(f.smoothWeaponAngle);
      const muzzleDirY = Math.sin(f.smoothWeaponAngle);
      const barrelLen = isPrism ? 54 : 88;
      ctx.beginPath();
      ctx.moveTo(f.skeleton.handL.x + muzzleDirX * barrelLen, f.skeleton.handL.y + muzzleDirY * barrelLen);
      ctx.lineTo(f.laserTarget.x, f.laserTarget.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.save();
    if (f.phaseTimer > 0) {
      ctx.globalAlpha = 0.42;
    }

    // 3. Full-Body Solid Signature Stickman Color (Head + Torso + Legs + Back Arm)
    const isShocked = f.stunTimer > 0 && f.electroFlash && Math.floor(timeSec * 28) % 2 === 0;
    const bodyColor = isShocked ? '#eab308' : f.def.color;

    this.drawSkeletonBackAndTorso(f.skeleton, bodyColor, 5.8);

    // 4. Held Articulated Oversized Weapon (sandwiched naturally between back arm L & front arm R!)
    const yoyoInFlight =
      f.def.id === 'yo_yo' &&
      (f.orbitSawTimer > 0 || world.projectiles.some((p) => p.ownerSlot === f.slot && p.kind === 'YOYO_DISK'));
    const boomerangOut =
      f.def.id === 'boomerang' &&
      world.projectiles.some((p) => p.ownerSlot === f.slot && p.kind === 'BOOMERANG');

    if (!f.surrendered && f.hasWeapon && !yoyoInFlight && !boomerangOut) {
      const atkProgress =
        f.activeAttackTimer > 0 && f.attackAnimDuration > 0
          ? clamp(1 - f.activeAttackTimer / f.attackAnimDuration, 0, 1)
          : -1;

      ctx.save();
      const id = f.def.id;
      if (id === 'bulwark') {
        ctx.translate(f.skeleton.handR.x, f.skeleton.handR.y);
        if (f.facing === -1) ctx.scale(-1, 1);
      } else if (id === 'blue_fire' || id === 'water') {
        // Upright flickering palm element in lead casting hand!
        ctx.translate(f.skeleton.handR.x, f.skeleton.handR.y);
        if (f.facing === -1) ctx.scale(-1, 1);
      } else if (id === 'sniper' || id === 'rocket' || id === 'laser' || id === 'chainsaw') {
        // Anchor trigger/stock at handL so handR naturally supports the barrel/saw forend!
        const ang = f.smoothWeaponAngle;
        ctx.translate(f.skeleton.handL.x, f.skeleton.handL.y);
        ctx.rotate(ang);
        if (Math.cos(ang) < 0) {
          ctx.scale(1, -1);
        }
      } else {
        const ang = f.smoothWeaponAngle;
        ctx.translate(f.skeleton.handR.x, f.skeleton.handR.y);
        ctx.rotate(ang);
        if (Math.cos(ang) < 0 && !f.spinDeflectTimer) {
          ctx.scale(1, -1);
        }
      }

      drawProceduralWeaponVector(ctx, id, {
        broken: f.weaponBroken,
        blueFireCoated: f.blueFireCoated,
        spinning: f.spinDeflectTimer > 0,
        attackProgress: atkProgress,
        timeSec,
      });
      ctx.restore();
    }

    // 4B. Yo-Yo 360° Around-the-World Buzzsaw Orbit + Taut Tether String!
    if (f.orbitSawTimer > 0 && f.hasWeapon) {
      const orbitA = timeSec * 18 * f.facing;
      const ox = f.x + Math.cos(orbitA) * 68;
      const oy = f.y - 24 + Math.sin(orbitA) * 68;
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(f.skeleton.handR.x, f.skeleton.handR.y);
      ctx.lineTo(ox, oy);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y - 24, 68, 0, Math.PI * 2);
      ctx.stroke();

      ctx.translate(ox, oy);
      ctx.rotate(timeSec * 28);
      drawProceduralWeaponVector(ctx, 'yo_yo', {
        blueFireCoated: f.blueFireCoated,
        timeSec,
      });
      ctx.restore();
    }

    // 5. Front Arm (R) drawn over weapon handle for crisp grip!
    this.drawSkeletonFrontArm(f.skeleton, bodyColor, 5.8);
    ctx.restore(); // end phaseTimer alpha

    // 6. Solid Ice Block Encasement if Frozen by Cryomancy!
    if (f.freezeTimer > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(125, 211, 252, 0.5)';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(f.x - 28, f.skeleton.head.y - 18, 56, 134, 6);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.x - 16, f.skeleton.head.y - 8);
      ctx.lineTo(f.x - 2, f.skeleton.head.y + 28);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draws back leg (L), back arm (L), spine, front leg (R), and solid-colored circle head
   * with 100% unified stickman color (no black lollipop border — exact classic animation style!).
   */
  private drawSkeletonBackAndTorso(
    sk: StickmanSkeleton,
    color: string,
    lineWidth: number
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Back leg (L) & back arm (L)
    ctx.beginPath();
    ctx.moveTo(sk.pelvis.x, sk.pelvis.y);
    ctx.lineTo(sk.kneeL.x, sk.kneeL.y);
    ctx.lineTo(sk.footL.x, sk.footL.y);
    ctx.moveTo(sk.neck.x, sk.neck.y);
    ctx.lineTo(sk.elbowL.x, sk.elbowL.y);
    ctx.lineTo(sk.handL.x, sk.handL.y);
    ctx.stroke();

    // Spine / Torso
    ctx.lineWidth = lineWidth + 0.7;
    ctx.beginPath();
    ctx.moveTo(sk.neck.x, sk.neck.y);
    ctx.lineTo(sk.pelvis.x, sk.pelvis.y);
    ctx.stroke();

    // Front leg (R)
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(sk.pelvis.x, sk.pelvis.y);
    ctx.lineTo(sk.kneeR.x, sk.kneeR.y);
    ctx.lineTo(sk.footR.x, sk.footR.y);
    ctx.stroke();

    // Solid Colored Stickman Head
    ctx.beginPath();
    ctx.arc(sk.head.x, sk.head.y, HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSkeletonFrontArm(
    sk: StickmanSkeleton,
    color: string,
    lineWidth: number
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sk.neck.x, sk.neck.y);
    ctx.lineTo(sk.elbowR.x, sk.elbowR.y);
    ctx.lineTo(sk.handR.x, sk.handR.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renders fighter names right above each stickman at the opening of the round
   * ("PLIER" vs "GLASS", "BLUE FIRE" vs "LONG SWORD" — exact 00:26 & 00:42 intro!).
   */
  private drawFighterIntroNames(world: ArenaWorld): void {
    if (world.elapsedSec > 2.2 || world.result) return;
    const ctx = this.ctx;
    const alpha = world.elapsedSec < 1.5 ? 1 : clamp((2.2 - world.elapsedSec) / 0.7, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '800 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';

    for (const f of world.fighters) {
      if (f.speech) continue;
      const label = f.def.name.toUpperCase();
      const tx = clamp(f.skeleton.head.x, ARENA_PADDING_X + 55, ARENA_WIDTH - ARENA_PADDING_X - 55);
      const ty = clamp(f.skeleton.head.y - 34, ARENA_TOP + 24, ARENA_FLOOR_Y - 90);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = f.def.color;
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  /**
   * Renders clean, classic floating colored text above the stickman's head
   * ("Well done", "Okay you are the winner", "Roger that" — exact 00:19, 00:34, 01:14 look!).
   */
  private drawSpeechText(f: FighterRuntime): void {
    if (!f.speech) return;
    const ctx = this.ctx;
    const text = f.speech.text;
    ctx.save();
    ctx.font = '700 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const halfW = ctx.measureText(text).width * 0.5 + 10;
    const highestY = Math.min(
      f.skeleton.head.y,
      f.surrendered ? f.skeleton.handR.y : f.skeleton.head.y
    );
    const tx = clamp(f.skeleton.head.x, ARENA_PADDING_X + halfW, ARENA_WIDTH - ARENA_PADDING_X - halfW);
    const ty = clamp(highestY - 22, ARENA_TOP + 22, ARENA_FLOOR_Y - 60);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5;
    ctx.strokeText(text, tx, ty);

    ctx.fillStyle = f.def.color;
    ctx.fillText(text, tx, ty);
    ctx.restore();
  }

  private drawProjectiles(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const p of world.projectiles) {
      if (p.kind === 'YOYO_DISK') {
        const owner = world.fighters[p.ownerSlot];
        ctx.save();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(owner.skeleton.handR.x, owner.skeleton.handR.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));

      if (p.kind === 'FLAME_STREAM') {
        // Jagged roaring azure & cyan flamethrower tongue (00:52, 01:01, 01:11 in video!)
        const r = p.radius;
        const flick = Math.sin(world.elapsedSec * 35 + p.id) * 4;
        ctx.fillStyle = '#0b3be0';
        ctx.beginPath();
        ctx.moveTo(-r * 1.5, -r * 0.45);
        ctx.quadraticCurveTo(-r * 0.2, -r * 1.15 + flick, r * 1.45, 0);
        ctx.quadraticCurveTo(-r * 0.2, r * 1.15 - flick, -r * 1.5, r * 0.45);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.25);
        ctx.quadraticCurveTo(0, -r * 0.6, r * 0.95, 0);
        ctx.quadraticCurveTo(0, r * 0.6, -r * 0.9, r * 0.25);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'SNIPER_BULLET') {
        // Supersonic golden-amber high-caliber round + bright streak!
        const grad = ctx.createLinearGradient(-46, 0, 14, 0);
        grad.addColorStop(0, 'rgba(250, 204, 21, 0)');
        grad.addColorStop(0.7, 'rgba(234, 179, 8, 0.85)');
        grad.addColorStop(1, '#ca8a04');
        ctx.fillStyle = grad;
        ctx.fillRect(-46, -2.4, 58, 4.8);

        ctx.fillStyle = '#a16207';
        ctx.beginPath();
        ctx.moveTo(8, -2.6);
        ctx.lineTo(17, 0);
        ctx.lineTo(8, 2.6);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'GLASS_DAGGER') {
        // Translucent seafoam crystal slab/block (00:27–00:29 in video!)
        ctx.fillStyle = 'rgba(116, 168, 162, 0.86)';
        ctx.strokeStyle = '#4c7c77';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.rect(-13, -7, 26, 14);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'ICE_SHARD') {
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(-1, -5);
        ctx.lineTo(14, 0);
        ctx.lineTo(-1, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'ROCKET') {
        ctx.fillStyle = '#2d4732';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.roundRect(-12, -5, 21, 10, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(9, -5);
        ctx.lineTo(17, 0);
        ctx.lineTo(9, 5);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'BOOMERANG') {
        ctx.rotate(world.elapsedSec * 22);
        drawProceduralWeaponVector(ctx, 'boomerang', {
          blueFireCoated: p.blueFireCoated,
          timeSec: world.elapsedSec,
        });
      } else if (p.kind === 'YOYO_DISK') {
        ctx.rotate(world.elapsedSec * 28);
        drawProceduralWeaponVector(ctx, 'yo_yo', {
          blueFireCoated: p.blueFireCoated,
          timeSec: world.elapsedSec,
        });
      } else if (p.kind === 'SONIC_WAVE') {
        ctx.strokeStyle = p.blueFireCoated ? '#0b3be0' : '#06b6d4';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-4, 0, 12, -0.85, 0.85);
        ctx.stroke();
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(-8, 0, 18, -0.7, 0.7);
        ctx.stroke();
      } else if (p.kind === 'WIND_BLADE') {
        ctx.strokeStyle = p.blueFireCoated ? '#0b3be0' : '#14b8a6';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-8, 0, 16, -0.95, 0.95);
        ctx.stroke();
      } else if (p.kind === 'WATER_JET') {
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.quadraticCurveTo(2, -8, 12, 0);
        ctx.quadraticCurveTo(2, 8, -14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(4, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'VENOM_GLOB') {
        ctx.fillStyle = '#65a30d';
        ctx.strokeStyle = '#365314';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.quadraticCurveTo(2, -7, 10, 0);
        ctx.quadraticCurveTo(2, 7, -11, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'BOULDER') {
        ctx.rotate(world.elapsedSec * 9);
        ctx.fillStyle = '#78716c';
        ctx.strokeStyle = '#44403c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-13, -6);
        ctx.lineTo(-3, -14);
        ctx.lineTo(11, -9);
        ctx.lineTo(14, 4);
        ctx.lineTo(4, 13);
        ctx.lineTo(-10, 9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'CHRONO_BOLT') {
        ctx.fillStyle = '#ca8a04';
        ctx.strokeStyle = '#713f12';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-12, -2);
        ctx.lineTo(4, -4);
        ctx.lineTo(15, 0);
        ctx.lineTo(4, 4);
        ctx.lineTo(-12, 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'ALCHEMY_FLASK') {
        ctx.rotate(world.elapsedSec * 12);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 2, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 3, 6.5, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = '#92400e';
        ctx.fillRect(-3, -9, 6, 4);
      } else if (p.kind === 'THROWN_WEAPON' && p.weaponDefId) {
        ctx.rotate(world.elapsedSec * 14);
        drawProceduralWeaponVector(ctx, p.weaponDefId, {
          blueFireCoated: p.blueFireCoated,
          timeSec: world.elapsedSec,
        });
      } else {
        ctx.fillStyle = p.blueFireCoated ? '#0b3be0' : p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawShockwaves(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const sw of world.shockwaves) {
      const alpha = clamp(1 - sw.radius / sw.maxRadius, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawSlashTrails(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const st of world.slashTrails) {
      if (st.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = clamp(st.alpha * 0.72, 0, 1);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.points[0].x, st.points[0].y);
      for (let i = 1; i < st.points.length; i++) {
        ctx.lineTo(st.points[i].x, st.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawLaserTracers(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const lt of world.laserTracers) {
      ctx.save();
      ctx.globalAlpha = clamp(lt.alpha, 0, 1);
      ctx.strokeStyle = lt.color;
      ctx.lineWidth = lt.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lt.x1, lt.y1);
      ctx.lineTo(lt.x2, lt.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(world: ArenaWorld): void {
    const ctx = this.ctx;
    for (const pt of world.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(pt.alpha, 0, 1);
      if (pt.shape === 'ring') {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (pt.shape === 'spark') {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 2.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x - pt.vx * 0.04, pt.y - pt.vy * 0.04);
        ctx.stroke();
      } else if (pt.shape === 'flame') {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.moveTo(pt.x - pt.size * 0.7, pt.y + pt.size * 0.5);
        ctx.lineTo(pt.x, pt.y - pt.size * 1.35);
        ctx.lineTo(pt.x + pt.size * 0.7, pt.y + pt.size * 0.5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawArenaHUD(world: ArenaWorld): void {
    const ctx = this.ctx;
    const f0 = world.fighters[0];
    const f1 = world.fighters[1];

    ctx.save();
    // Clean Minimal Top Header Strip (strictly above ARENA_TOP = 54 so the white arena stays pure!)
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(world.roundBannerTitle.toUpperCase(), ARENA_WIDTH * 0.5, 22);

    const remaining = Math.max(0, Math.ceil(world.maxMatchDurationSec - world.elapsedSec));
    ctx.font = '700 10px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`${remaining}s`, ARENA_WIDTH * 0.5, 38);

    // Slim Left & Right HP Bars
    const barW = 265;
    const barH = 8;
    const leftX = ARENA_PADDING_X;
    const barY = 34;

    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.roundRect(leftX, barY, barW, barH, 4);
    ctx.fill();

    const hp0Ratio = clamp(f0.smoothHp / f0.maxHp, 0, 1);
    if (hp0Ratio > 0) {
      ctx.fillStyle = f0.def.color;
      ctx.beginPath();
      ctx.roundRect(leftX, barY, barW * hp0Ratio, barH, 4);
      ctx.fill();
    }
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(leftX, barY, barW, barH, 4);
    ctx.stroke();

    ctx.fillStyle = f0.def.color;
    ctx.font = '800 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${f0.def.name.toUpperCase()} (${Math.ceil(f0.hp)})`, leftX, barY - 5);

    const rightX = ARENA_WIDTH - ARENA_PADDING_X - barW;
    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.roundRect(rightX, barY, barW, barH, 4);
    ctx.fill();

    const hp1Ratio = clamp(f1.smoothHp / f1.maxHp, 0, 1);
    if (hp1Ratio > 0) {
      ctx.fillStyle = f1.def.color;
      ctx.beginPath();
      ctx.roundRect(rightX + barW * (1 - hp1Ratio), barY, barW * hp1Ratio, barH, 4);
      ctx.fill();
    }
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rightX, barY, barW, barH, 4);
    ctx.stroke();

    ctx.fillStyle = f1.def.color;
    ctx.textAlign = 'right';
    ctx.fillText(`(${Math.ceil(f1.hp)}) ${f1.def.name.toUpperCase()}`, rightX + barW, barY - 5);

    // Subtle Waiting-to-Start Prompt
    if (!world.isRunning && !world.result && world.elapsedSec === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Press "Start Match" or enable "Auto-Tourney" to watch', ARENA_WIDTH * 0.5, ARENA_TOP + 34);
    }

    // Classic Clean "WINNER : <NAME>" Typography inside the white arena (exact 00:20, 00:36, 01:16 look!)
    if (world.result) {
      const winnerDef = world.fighters[world.result.winnerSlot].def;
      const wy = ARENA_TOP + 82;

      ctx.lineJoin = 'round';
      ctx.textAlign = 'center';
      ctx.font = '800 28px Inter, sans-serif';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      const winText = `WINNER : ${winnerDef.name.toUpperCase()}`;
      ctx.strokeText(winText, ARENA_WIDTH * 0.5, wy);
      ctx.fillStyle = winnerDef.color;
      ctx.fillText(winText, ARENA_WIDTH * 0.5, wy);

      const sub =
        world.result.reason === 'SURRENDER'
          ? `Won by Surrender (${world.result.durationSec.toFixed(1)}s)`
          : world.result.reason === 'KO'
          ? `Knockout (${world.result.durationSec.toFixed(1)}s)`
          : `Referee Decision`;
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(sub, ARENA_WIDTH * 0.5, wy + 22);
    }

    ctx.restore();
  }
}

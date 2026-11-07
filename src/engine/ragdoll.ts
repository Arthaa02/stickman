import {
  ArenaObstacle,
  FighterRuntime,
  RagdollConstraint,
  RagdollNode,
  SeveredLimb,
  StickmanSkeleton,
  Vec2,
} from '../types/game';
import { clamp, lerp, lerpAngle, solveTwoBoneIK } from './math';

// Sleek, tall athletic classic stickman proportions (arena = 960x540, box height = 450px)
// Total standing height ~ 128px (~29% of arena box, matching classic @scenic.chill proportions!)
export const HEAD_RADIUS = 12.5;
export const TORSO_LEN = 42;
export const UPPER_ARM = 25;
export const LOWER_ARM = 25;
export const THIGH_LEN = 31;
export const SHIN_LEN = 31;
export const STAND_PELVIS_HEIGHT = 58;

// Node indices in ragdollNodes array:
// 0: head, 1: neck, 2: pelvis, 3: elbowL, 4: handL, 5: elbowR, 6: handR, 7: kneeL, 8: footL, 9: kneeR, 10: footR
export function createInitialSkeleton(x: number, floorY: number): StickmanSkeleton {
  const pelvis: Vec2 = { x, y: floorY - STAND_PELVIS_HEIGHT };
  const neck: Vec2 = { x, y: pelvis.y - TORSO_LEN };
  const head: Vec2 = { x, y: neck.y - HEAD_RADIUS - 3 };
  const elbowL: Vec2 = { x: x - 14, y: neck.y + 19 };
  const handL: Vec2 = { x: x - 8, y: neck.y + 36 };
  const elbowR: Vec2 = { x: x + 8, y: neck.y + 22 };
  const handR: Vec2 = { x: x + 24, y: neck.y + 16 };
  const kneeL: Vec2 = { x: x - 4, y: pelvis.y + 29 };
  const footL: Vec2 = { x: x - 13, y: floorY };
  const kneeR: Vec2 = { x: x + 11, y: pelvis.y + 29 };
  const footR: Vec2 = { x: x + 15, y: floorY };

  const pts = [head, neck, pelvis, elbowL, handL, elbowR, handR, kneeL, footL, kneeR, footR];
  const ragdollNodes: RagdollNode[] = pts.map((p) => ({
    x: p.x,
    y: p.y,
    oldX: p.x,
    oldY: p.y,
  }));

  const ragdollConstraints: RagdollConstraint[] = [
    { a: 0, b: 1, length: HEAD_RADIUS + 3 },
    { a: 1, b: 2, length: TORSO_LEN },
    { a: 0, b: 2, length: TORSO_LEN + HEAD_RADIUS + 2 }, // spinal stiffness helper
    { a: 1, b: 3, length: UPPER_ARM },
    { a: 3, b: 4, length: LOWER_ARM },
    { a: 1, b: 5, length: UPPER_ARM },
    { a: 5, b: 6, length: LOWER_ARM },
    { a: 2, b: 7, length: THIGH_LEN },
    { a: 7, b: 8, length: SHIN_LEN },
    { a: 2, b: 9, length: THIGH_LEN },
    { a: 9, b: 10, length: SHIN_LEN },
  ];

  return {
    head: { ...head },
    neck: { ...neck },
    pelvis: { ...pelvis },
    elbowL: { ...elbowL },
    handL: { ...handL },
    elbowR: { ...elbowR },
    handR: { ...handR },
    kneeL: { ...kneeL },
    footL: { ...footL },
    kneeR: { ...kneeR },
    footR: { ...footR },
    ragdollNodes,
    ragdollConstraints,
  };
}

/**
 * Shifts all world-space smoothed IK effectors & skeleton joints by (dx, dy)
 * so instant dashes, flash-steps, shadow-swaps, and portal warps NEVER stretch limbs across the arena!
 */
export function shiftFighterSkeleton(f: FighterRuntime, dx: number, dy: number): void {
  const sk = f.skeleton;
  const pts = [
    sk.head,
    sk.neck,
    sk.pelvis,
    sk.elbowL,
    sk.handL,
    sk.elbowR,
    sk.handR,
    sk.kneeL,
    sk.footL,
    sk.kneeR,
    sk.footR,
    f.smoothHandL,
    f.smoothHandR,
    f.smoothFootL,
    f.smoothFootR,
  ];
  for (const p of pts) {
    p.x += dx;
    p.y += dy;
  }
  for (const n of sk.ragdollNodes) {
    n.x += dx;
    n.y += dy;
    n.oldX += dx;
    n.oldY += dy;
  }
}

export function cloneSkeletonPose(s: StickmanSkeleton): StickmanSkeleton {
  return {
    head: { ...s.head },
    neck: { ...s.neck },
    pelvis: { ...s.pelvis },
    elbowL: { ...s.elbowL },
    handL: { ...s.handL },
    elbowR: { ...s.elbowR },
    handR: { ...s.handR },
    kneeL: { ...s.kneeL },
    footL: { ...s.footL },
    kneeR: { ...s.kneeR },
    footR: { ...s.footR },
    ragdollNodes: [],
    ragdollConstraints: [],
  };
}

/**
 * Syncs Verlet ragdoll nodes from current active IK skeleton with fighter velocity,
 * so transitioning into ragdoll knockback is 100% seamless and carries momentum!
 */
export function syncRagdollFromActivePose(f: FighterRuntime, dt: number): void {
  const sk = f.skeleton;
  const pts = [
    sk.head,
    sk.neck,
    sk.pelvis,
    sk.elbowL,
    sk.handL,
    sk.elbowR,
    sk.handR,
    sk.kneeL,
    sk.footL,
    sk.kneeR,
    sk.footR,
  ];
  for (let i = 0; i < pts.length; i++) {
    const n = sk.ragdollNodes[i];
    n.x = pts[i].x;
    n.y = pts[i].y;
    n.oldX = pts[i].x - f.vx * dt;
    n.oldY = pts[i].y - f.vy * dt;
  }
}

/**
 * Steps full Verlet ragdoll physics when fighter is knocked out or tumbled by heavy force.
 */
export function stepVerletRagdoll(
  f: FighterRuntime,
  dt: number,
  arenaLeft: number,
  arenaRight: number,
  arenaTop: number,
  floorY: number,
  gravityAccel: number,
  obstacles: ArenaObstacle[]
): void {
  const sk = f.skeleton;
  const nodes = sk.ragdollNodes;
  const g = gravityAccel * f.gravityScale;
  const bounce = f.def.id === 'rubber' ? 0.36 : 0.15;
  const damping = 0.965;

  const enforceMinDist = (idxA: number, idxB: number, minLen: number) => {
    const na = nodes[idxA];
    const nb = nodes[idxB];
    const dx = nb.x - na.x;
    const dy = nb.y - na.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d < minLen) {
      const push = ((minLen - d) / d) * 0.5;
      na.x -= dx * push;
      na.y -= dy * push;
      nb.x += dx * push;
      nb.y += dy * push;
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const vx = (n.x - n.oldX) * damping;
    const vy = (n.y - n.oldY) * damping;
    n.oldX = n.x;
    n.oldY = n.y;
    n.x += vx;
    n.y += vy + g * dt * dt;
  }

  for (let iter = 0; iter < 7; iter++) {
    for (const c of sk.ragdollConstraints) {
      const na = nodes[c.a];
      const nb = nodes[c.b];
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const diff = ((c.length - d) / d) * 0.5;
      na.x -= dx * diff;
      na.y -= dy * diff;
      nb.x += dx * diff;
      nb.y += dy * diff;
    }

    // Anti-folding anatomical joint limits so KO'd stickmen collapse naturally instead of tangling into a ball
    enforceMinDist(0, 2, 48); // head <-> pelvis
    enforceMinDist(2, 8, 42); // pelvis <-> footL
    enforceMinDist(2, 10, 42); // pelvis <-> footR
    enforceMinDist(0, 8, 70); // head <-> footL
    enforceMinDist(0, 10, 70); // head <-> footR
    enforceMinDist(1, 4, 28); // neck <-> handL
    enforceMinDist(1, 6, 28); // neck <-> handR
    enforceMinDist(8, 10, 14); // footL <-> footR

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const pad = i === 0 ? HEAD_RADIUS : 3;

      if (n.x < arenaLeft + pad) {
        const vx = n.x - n.oldX;
        n.x = arenaLeft + pad;
        n.oldX = n.x + vx * bounce;
      } else if (n.x > arenaRight - pad) {
        const vx = n.x - n.oldX;
        n.x = arenaRight - pad;
        n.oldX = n.x + vx * bounce;
      }

      if (n.y < arenaTop + pad) {
        const vy = n.y - n.oldY;
        n.y = arenaTop + pad;
        n.oldY = n.y + vy * bounce;
      } else if (n.y > floorY - pad) {
        const vy = n.y - n.oldY;
        const vx = n.x - n.oldX;
        n.y = floorY - pad;
        n.oldY = n.y + vy * bounce;
        const fric = f.slipTimer > 0 ? 0.96 : 0.78;
        n.oldX = n.x - vx * fric;
      }

      for (const obs of obstacles) {
        if (
          n.x > obs.x - pad &&
          n.x < obs.x + obs.width + pad &&
          n.y > obs.y - pad &&
          n.y < obs.y + obs.height + pad
        ) {
          const dLeft = Math.abs(n.x - (obs.x - pad));
          const dRight = Math.abs(obs.x + obs.width + pad - n.x);
          const dTop = Math.abs(n.y - (obs.y - pad));
          const minD = Math.min(dLeft, dRight, dTop);
          if (minD === dTop) {
            n.y = obs.y - pad;
          } else if (minD === dLeft) {
            n.x = obs.x - pad;
          } else {
            n.x = obs.x + obs.width + pad;
          }
        }
      }
    }
  }

  sk.head.x = nodes[0].x;
  sk.head.y = nodes[0].y;
  sk.neck.x = nodes[1].x;
  sk.neck.y = nodes[1].y;
  sk.pelvis.x = nodes[2].x;
  sk.pelvis.y = nodes[2].y;
  sk.elbowL.x = nodes[3].x;
  sk.elbowL.y = nodes[3].y;
  sk.handL.x = nodes[4].x;
  sk.handL.y = nodes[4].y;
  sk.elbowR.x = nodes[5].x;
  sk.elbowR.y = nodes[5].y;
  sk.handR.x = nodes[6].x;
  sk.handR.y = nodes[6].y;
  sk.kneeL.x = nodes[7].x;
  sk.kneeL.y = nodes[7].y;
  sk.footL.x = nodes[8].x;
  sk.footL.y = nodes[8].y;
  sk.kneeR.x = nodes[9].x;
  sk.kneeR.y = nodes[9].y;
  sk.footR.x = nodes[10].x;
  sk.footR.y = nodes[10].y;

  f.x = sk.pelvis.x;
  f.y = sk.pelvis.y;
  f.vx = clamp((nodes[2].x - nodes[2].oldX) / Math.max(dt, 0.001), -900, 900);
  f.vy = clamp((nodes[2].y - nodes[2].oldY) / Math.max(dt, 0.001), -900, 900);

  f.smoothHandL = { ...sk.handL };
  f.smoothHandR = { ...sk.handR };
  f.smoothFootL = { ...sk.footL };
  f.smoothFootR = { ...sk.footR };
}

export function createSeveredLimb(
  id: number,
  kind: 'HEAD' | 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R',
  sk: StickmanSkeleton,
  color: string,
  impulseX: number,
  impulseY: number
): SeveredLimb {
  const dt = 1 / 60;
  const nodes: RagdollNode[] = [];
  const constraints: RagdollConstraint[] = [];

  if (kind === 'HEAD') {
    // 0: head, 1: neck
    const h = { x: sk.head.x, y: sk.head.y, oldX: sk.head.x - impulseX * dt, oldY: sk.head.y - impulseY * dt };
    const n = { x: sk.neck.x, y: sk.neck.y, oldX: sk.neck.x - impulseX * dt, oldY: sk.neck.y - impulseY * dt };
    nodes.push(h, n);
    constraints.push({ a: 0, b: 1, length: HEAD_RADIUS + 3 });
  } else if (kind === 'ARM_L') {
    const e = { x: sk.elbowL.x, y: sk.elbowL.y, oldX: sk.elbowL.x - impulseX * dt, oldY: sk.elbowL.y - impulseY * dt };
    const h = { x: sk.handL.x, y: sk.handL.y, oldX: sk.handL.x - impulseX * dt, oldY: sk.handL.y - impulseY * dt };
    nodes.push(e, h);
    constraints.push({ a: 0, b: 1, length: LOWER_ARM });
  } else if (kind === 'ARM_R') {
    const e = { x: sk.elbowR.x, y: sk.elbowR.y, oldX: sk.elbowR.x - impulseX * dt, oldY: sk.elbowR.y - impulseY * dt };
    const h = { x: sk.handR.x, y: sk.handR.y, oldX: sk.handR.x - impulseX * dt, oldY: sk.handR.y - impulseY * dt };
    nodes.push(e, h);
    constraints.push({ a: 0, b: 1, length: LOWER_ARM });
  } else if (kind === 'LEG_L') {
    const k = { x: sk.kneeL.x, y: sk.kneeL.y, oldX: sk.kneeL.x - impulseX * dt, oldY: sk.kneeL.y - impulseY * dt };
    const f = { x: sk.footL.x, y: sk.footL.y, oldX: sk.footL.x - impulseX * dt, oldY: sk.footL.y - impulseY * dt };
    nodes.push(k, f);
    constraints.push({ a: 0, b: 1, length: SHIN_LEN });
  } else {
    const k = { x: sk.kneeR.x, y: sk.kneeR.y, oldX: sk.kneeR.x - impulseX * dt, oldY: sk.kneeR.y - impulseY * dt };
    const f = { x: sk.footR.x, y: sk.footR.y, oldX: sk.footR.x - impulseX * dt, oldY: sk.footR.y - impulseY * dt };
    nodes.push(k, f);
    constraints.push({ a: 0, b: 1, length: SHIN_LEN });
  }

  return {
    id,
    kind,
    nodes,
    constraints,
    color,
    life: 3.5,
    alpha: 1.0,
  };
}

export function stepSeveredLimb(
  limb: SeveredLimb,
  dt: number,
  arenaLeft: number,
  arenaRight: number,
  arenaTop: number,
  floorY: number,
  gravityAccel: number
): void {
  limb.life -= dt;
  if (limb.life < 1.0) {
    limb.alpha = Math.max(0, limb.life);
  }
  const damping = 0.96;
  const bounce = 0.28;

  for (const n of limb.nodes) {
    const vx = (n.x - n.oldX) * damping;
    const vy = (n.y - n.oldY) * damping;
    n.oldX = n.x;
    n.oldY = n.y;
    n.x += vx;
    n.y += vy + gravityAccel * dt * dt;
  }

  for (let iter = 0; iter < 4; iter++) {
    for (const c of limb.constraints) {
      const na = limb.nodes[c.a];
      const nb = limb.nodes[c.b];
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const diff = ((c.length - d) / d) * 0.5;
      na.x -= dx * diff;
      na.y -= dy * diff;
      nb.x += dx * diff;
      nb.y += dy * diff;
    }

    for (const n of limb.nodes) {
      if (n.x < arenaLeft + 4) {
        const vx = n.x - n.oldX;
        n.x = arenaLeft + 4;
        n.oldX = n.x + vx * bounce;
      } else if (n.x > arenaRight - 4) {
        const vx = n.x - n.oldX;
        n.x = arenaRight - 4;
        n.oldX = n.x + vx * bounce;
      }
      if (n.y < arenaTop + 4) {
        const vy = n.y - n.oldY;
        n.y = arenaTop + 4;
        n.oldY = n.y + vy * bounce;
      } else if (n.y > floorY - 4) {
        const vy = n.y - n.oldY;
        const vx = n.x - n.oldX;
        n.y = floorY - 4;
        n.oldY = n.y + vy * bounce;
        n.oldX = n.x - vx * 0.8;
      }
    }
  }
}

export function blendSkeletonPose(from: StickmanSkeleton, to: StickmanSkeleton, t: number): StickmanSkeleton {
  const b = (p1: Vec2, p2: Vec2) => ({
    x: lerp(p1.x, p2.x, t),
    y: lerp(p1.y, p2.y, t),
  });
  return {
    head: b(from.head, to.head),
    neck: b(from.neck, to.neck),
    pelvis: b(from.pelvis, to.pelvis),
    elbowL: b(from.elbowL, to.elbowL),
    handL: b(from.handL, to.handL),
    elbowR: b(from.elbowR, to.elbowR),
    handR: b(from.handR, to.handR),
    kneeL: b(from.kneeL, to.kneeL),
    footL: b(from.footL, to.footL),
    kneeR: b(from.kneeR, to.kneeR),
    footR: b(from.footR, to.footR),
    ragdollNodes: from.ragdollNodes,
    ragdollConstraints: from.ragdollConstraints,
  };
}

/**
 * Updates fluid, spring-interpolated 2-Bone IK stickman pose & weapon angle.
 * Anatomically accurate forward-hinged knees, gravity-hung elbows, zero-moonwalk blended stride,
 * deep matrix duck, wall-hang, and classic stickman tournament choreography.
 */
export function updateProceduralIKSkeleton(
  f: FighterRuntime,
  dt: number,
  floorY: number,
  arenaTop: number,
  arenaLeft: number,
  arenaRight: number,
  timeSec: number
): void {
  const sk = f.skeleton;
  const dir = f.facing;
  const upsideDown = f.gravityScale < 0;
  const verticalSign = upsideDown ? -1 : 1;

  // Mirror 2D side-profile effectors cleanly on turnaround so weapons/limbs NEVER helicopter-spin 180°!
  if (f.lastPoseFacing !== undefined && f.lastPoseFacing !== dir) {
    f.smoothHandL.x = f.x - (f.smoothHandL.x - f.x);
    f.smoothHandR.x = f.x - (f.smoothHandR.x - f.x);
    f.smoothFootL.x = f.x - (f.smoothFootL.x - f.x);
    f.smoothFootR.x = f.x - (f.smoothFootR.x - f.x);
    f.spineLean = -f.spineLean;
    f.smoothWeaponAngle = Math.PI - f.smoothWeaponAngle;
  }
  f.lastPoseFacing = dir;

  // Smooth exponential damping factors (frame-rate independent, silky on 60Hz-240Hz!)
  const poseSmooth = 1 - Math.exp(-dt * 20);
  const fastLimbSmooth = 1 - Math.exp(-dt * 26);

  // Subtle squash & stretch clamped tightly so stickman torso stays sleek
  f.stretchScaleX = clamp(lerp(f.stretchScaleX, 1, Math.min(1, dt * 14)), 0.88, 1.15);
  f.stretchScaleY = clamp(lerp(f.stretchScaleY, 1, Math.min(1, dt * 14)), 0.88, 1.15);

  // Smoothly blended human stride: zero threshold snapping and zero moonwalking!
  const speedAbs = Math.abs(f.vx);
  const canWalk =
    (f.grounded || f.onCeiling) &&
    !f.crouching &&
    !f.surrendered &&
    f.aiState !== 'VICTORY';
  const walkBlend = canWalk ? clamp((speedAbs - 6) / 52, 0, 1) : 0;

  if (walkBlend > 0.01) {
    f.walkPhase += (speedAbs * 0.032 + 2.1) * dt;
    // Slight downward pelvis settle on foot-plant keeps knees subtly flexed (never locked/popping!)
    const targetBob = walkBlend * Math.abs(Math.cos(f.walkPhase)) * 2.2;
    f.hipBob = lerp(f.hipBob, targetBob, poseSmooth);
  } else {
    f.hipBob = lerp(f.hipBob, 0, poseSmooth);
  }

  // Deep crouch dodge (like 00:01 in video!), 10G Gravity Crush, or Active Get-Up Recovery!
  const isCrushed = f.gravityScale > 3;
  const isRecovering = f.recoveryTimer > 0;
  const recoveryDrop = isRecovering ? (f.recoveryTimer / 0.38) * 32 : 0;
  const targetCrouchDrop = isCrushed ? 26 : f.crouching ? 30 : recoveryDrop;

  // Pelvis anchor with stride hip-bob
  const targetPelvisY = f.y + (targetCrouchDrop + f.hipBob) * verticalSign;
  sk.pelvis.x = f.x;
  if (Math.abs(sk.pelvis.y - targetPelvisY) > 75) {
    sk.pelvis.y = targetPelvisY;
  } else {
    sk.pelvis.y = lerp(sk.pelvis.y, targetPelvisY, 1 - Math.exp(-dt * 24));
  }

  // Poised spine lean: subtle martial-arts forward lean, low duck when crouching
  let desiredLean = clamp(f.vx * 0.024, -8, 8);
  if (f.crouching) {
    desiredLean = dir * 20;
  } else if (f.wallClingTimer > 0 && f.wallTouch !== 0) {
    desiredLean = -f.wallTouch * 8;
  } else if (f.slipTimer > 0) {
    desiredLean = Math.sin(timeSec * 16) * 10 - dir * 6;
  } else if (f.surrendered) {
    desiredLean = 0;
  } else if (f.activeAttackTimer > 0) {
    desiredLean += dir * 8;
  }
  f.spineLean = lerp(f.spineLean, desiredLean, poseSmooth);

  const torsoHeightScale = isCrushed ? 0.6 : f.crouching ? 0.66 : f.stretchScaleY;
  const effectiveTorso = TORSO_LEN * torsoHeightScale * verticalSign;
  const neckHorizontal = f.spineLean;
  const neckVertical =
    Math.sqrt(Math.max(144, effectiveTorso * effectiveTorso - neckHorizontal * neckHorizontal)) *
    verticalSign;

  sk.neck.x = sk.pelvis.x + neckHorizontal;
  sk.neck.y = sk.pelvis.y - neckVertical;

  sk.head.x = sk.neck.x + neckHorizontal * 0.22;
  sk.head.y = sk.neck.y - (HEAD_RADIUS + 2.5) * verticalSign;

  // Electro-stun high-voltage jitter (with anatomical joint orientations)
  if (f.stunTimer > 0 && f.electroFlash) {
    const jx = () => (Math.random() - 0.5) * 6;
    const jy = () => (Math.random() - 0.5) * 6;
    sk.head.x += jx();
    sk.head.y += jy();
    sk.elbowL = { x: sk.neck.x - 16 + jx(), y: sk.neck.y + 12 * verticalSign + jy() };
    sk.handL = { x: sk.neck.x - 24 + jx(), y: sk.neck.y + 4 * verticalSign + jy() };
    sk.elbowR = { x: sk.neck.x + 16 + jx(), y: sk.neck.y + 12 * verticalSign + jy() };
    sk.handR = { x: sk.neck.x + 24 + jx(), y: sk.neck.y + 4 * verticalSign + jy() };
    sk.kneeL = { x: sk.pelvis.x - 8 + jx(), y: sk.pelvis.y + 28 * verticalSign };
    sk.footL = { x: sk.pelvis.x - 15 + jx(), y: sk.pelvis.y + 56 * verticalSign };
    sk.kneeR = { x: sk.pelvis.x + 10 + jx(), y: sk.pelvis.y + 28 * verticalSign };
    sk.footR = { x: sk.pelvis.x + 15 + jx(), y: sk.pelvis.y + 56 * verticalSign };
    syncRagdollFromActivePose(f, dt);
    return;
  }

  // ============================================================================
  // 1. LEGS: Blended Grounded Stance <-> True Forward/Backward Stride + Airborne
  // ============================================================================
  let rawFootL: Vec2;
  let rawFootR: Vec2;
  const surfaceY = upsideDown ? arenaTop + 2 : floorY;

  if (f.wallClingTimer > 0 && f.wallTouch !== 0) {
    const wallX = f.wallTouch === -1 ? arenaLeft + 4 : arenaRight - 4;
    if (f.def.id === 'long_sword' && f.hasWeapon) {
      const dangle = Math.sin(timeSec * 4.5) * 3;
      rawFootL = { x: sk.pelvis.x - 6 + dangle, y: sk.pelvis.y + 55 };
      rawFootR = { x: sk.pelvis.x + 5 + dangle, y: sk.pelvis.y + 57 };
    } else {
      rawFootL = { x: wallX, y: sk.pelvis.y + 18 };
      rawFootR = { x: wallX, y: sk.pelvis.y + 42 };
    }
  } else if (!f.grounded && !f.onCeiling) {
    if (!f.hasWeapon && f.activeAttackTimer > 0) {
      // Flying martial-arts jump kick
      rawFootR = { x: sk.pelvis.x + dir * 46, y: sk.pelvis.y + 4 * verticalSign };
      rawFootL = { x: sk.pelvis.x - dir * 16, y: sk.pelvis.y + 40 * verticalSign };
    } else {
      // Composed airborne martial-arts tuck (front knee slightly raised, trailing leg extended)
      const velTilt = clamp(f.vx * 0.025, -10, 10);
      rawFootL = { x: sk.pelvis.x - dir * 14 - velTilt * 0.3, y: sk.pelvis.y + 50 * verticalSign };
      rawFootR = { x: sk.pelvis.x + dir * 16 - velTilt * 0.2, y: sk.pelvis.y + 43 * verticalSign };
    }
  } else if (f.crouching) {
    // Wide low split-brace crouch (00:01 bullet dodge!)
    rawFootL = { x: sk.pelvis.x - dir * 28, y: surfaceY };
    rawFootR = { x: sk.pelvis.x + dir * 24, y: surfaceY };
  } else {
    // Grounded ready stance smoothly blended into authentic human walk cycle
    const spreadBack = f.surrendered || f.aiState === 'VICTORY' ? 12 : 13;
    const spreadFront = f.surrendered || f.aiState === 'VICTORY' ? 12 : 15;
    const stanceL: Vec2 = { x: sk.pelvis.x - dir * spreadBack, y: surfaceY };
    const stanceR: Vec2 = { x: sk.pelvis.x + dir * spreadFront, y: surfaceY };

    if (walkBlend > 0.001) {
      const moveSign = speedAbs > 2 ? (f.vx >= 0 ? 1 : -1) : dir;
      const stride = isCrushed ? 11 : clamp(14 + speedAbs * 0.03, 14, 21);
      const maxLift = isCrushed ? 3 : 11;

      const phiL = f.walkPhase;
      const phiR = f.walkPhase + Math.PI;
      // Foot lifts ONLY while swinging in direction of travel (cos > 0), stays planted while pushing back!
      const liftL = Math.max(0, Math.cos(phiL)) * maxLift;
      const liftR = Math.max(0, Math.cos(phiR)) * maxLift;

      const walkL: Vec2 = {
        x: sk.pelvis.x + moveSign * Math.sin(phiL) * stride,
        y: surfaceY - verticalSign * liftL,
      };
      const walkR: Vec2 = {
        x: sk.pelvis.x + moveSign * Math.sin(phiR) * stride,
        y: surfaceY - verticalSign * liftR,
      };

      rawFootL = {
        x: lerp(stanceL.x, walkL.x, walkBlend),
        y: lerp(stanceL.y, walkL.y, walkBlend),
      };
      rawFootR = {
        x: lerp(stanceR.x, walkR.x, walkBlend),
        y: lerp(stanceR.y, walkR.y, walkBlend),
      };
    } else {
      rawFootL = stanceL;
      rawFootR = stanceR;
    }
  }

  // Safety snap if fighter just dashed/warped across arena OR flipped gravity direction!
  if (
    Math.hypot(f.smoothFootL.x - sk.pelvis.x, f.smoothFootL.y - sk.pelvis.y) > 95 ||
    (f.smoothFootL.y - sk.pelvis.y) * verticalSign < 4 ||
    (f.smoothFootR.y - sk.pelvis.y) * verticalSign < 4
  ) {
    f.smoothFootL = { ...rawFootL };
    f.smoothFootR = { ...rawFootR };
  } else {
    f.smoothFootL.x = lerp(f.smoothFootL.x, rawFootL.x, fastLimbSmooth);
    f.smoothFootL.y = lerp(f.smoothFootL.y, rawFootL.y, fastLimbSmooth);
    f.smoothFootR.x = lerp(f.smoothFootR.x, rawFootR.x, fastLimbSmooth);
    f.smoothFootR.y = lerp(f.smoothFootR.y, rawFootR.y, fastLimbSmooth);
  }

  // Anatomically accurate knee bend: knees ALWAYS bend forward in facing direction!
  const kneeBend = (-dir * verticalSign) as 1 | -1;
  const legL = solveTwoBoneIK(sk.pelvis, f.smoothFootL, THIGH_LEN, SHIN_LEN, kneeBend);
  const legR = solveTwoBoneIK(sk.pelvis, f.smoothFootR, THIGH_LEN, SHIN_LEN, kneeBend);
  sk.kneeL = legL.mid;
  sk.footL = legL.end;
  sk.kneeR = legR.mid;
  sk.footR = legR.end;

  // ============================================================================
  // 2. ARMS & WEAPON POSTURE: Poised Keyframed Poses per Archetype & Action
  // ============================================================================
  let rawHandL: Vec2;
  let rawHandR: Vec2;
  let desiredWeaponAngle = f.aimAngle;
  const id = f.def.id;

  // Attack progress 0 -> 1 across activeAttackTimer with cubic smoothstep easing!
  const atkProgress =
    f.activeAttackTimer > 0 && f.attackAnimDuration > 0
      ? clamp(1 - f.activeAttackTimer / f.attackAnimDuration, 0, 1)
      : -1;
  const smoothAtk =
    atkProgress >= 0 ? atkProgress * atkProgress * (3 - 2 * atkProgress) : -1;

  // Smooth elastic whip extension for Rubber only during active club swing
  const armScale =
    id === 'rubber' && atkProgress >= 0 ? 1 + Math.sin(atkProgress * Math.PI) * 0.55 : 1;

  if (f.surrendered) {
    // Hands raised cleanly above head in classic stickman "I surrender" pose (01:14 in video!)
    const subtleWave = Math.sin(timeSec * 6) * 1.5;
    rawHandL = { x: sk.neck.x - 19 + subtleWave, y: sk.head.y - 23 * verticalSign };
    rawHandR = { x: sk.neck.x + 19 + subtleWave, y: sk.head.y - 23 * verticalSign };
  } else if (f.wallClingTimer > 0 && f.wallTouch !== 0 && id === 'long_sword' && f.hasWeapon) {
    // Hanging with both hands gripping the katana hilt pinned into the arena wall (00:56–00:58!)
    const wallX = f.wallTouch === -1 ? arenaLeft : arenaRight;
    const hiltX = wallX - f.wallTouch * 112;
    const hiltY = sk.neck.y - 18;
    rawHandR = { x: hiltX, y: hiltY };
    rawHandL = { x: hiltX - f.wallTouch * 8, y: hiltY + 2 };
    desiredWeaponAngle = f.wallTouch === 1 ? 0 : Math.PI;
  } else if (f.aiState === 'VICTORY') {
    // Calm, composed classic stickman victory stance (00:20 & 01:16!)
    if ((id === 'long_sword' || id === 'scythe' || id === 'spear') && f.hasWeapon) {
      rawHandR = { x: sk.neck.x + dir * 20, y: sk.neck.y + 20 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 15, y: sk.neck.y + 24 * verticalSign };
      desiredWeaponAngle = dir === 1 ? -1.35 : Math.PI + 1.35;
    } else {
      rawHandR = { x: sk.neck.x + dir * 16, y: sk.neck.y + 28 * verticalSign };
      rawHandL = { x: sk.neck.x - dir * 8, y: sk.neck.y + 34 * verticalSign };
      desiredWeaponAngle = dir === 1 ? 0.16 : Math.PI - 0.16;
    }
  } else if (!f.hasWeapon) {
    // Bare-handed martial arts guard or relaxed disarmed run
    if (atkProgress >= 0) {
      const ext = Math.sin(atkProgress * Math.PI) * 38;
      rawHandR = { x: sk.neck.x + dir * (14 + ext), y: sk.neck.y + 6 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 10, y: sk.neck.y + 20 * verticalSign };
    } else {
      const swing = Math.sin(f.walkPhase) * 9 * walkBlend;
      rawHandR = { x: sk.neck.x + dir * 16 + swing * 0.5, y: sk.neck.y + 20 * verticalSign };
      rawHandL = { x: sk.neck.x - dir * 6 - swing * 0.5, y: sk.neck.y + 30 * verticalSign };
    }
  } else if (id === 'long_sword' || id === 'scythe') {
    // ---- LONG SWORD & GRIM REAPER SCYTHE TWO-HANDED CHOREOGRAPHY ----
    if (f.spinDeflectTimer > 0) {
      rawHandR = { x: sk.neck.x + dir * 30, y: sk.neck.y + 8 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 23, y: sk.neck.y + 12 * verticalSign };
      desiredWeaponAngle = timeSec * 34 * dir;
    } else if (f.crouching) {
      rawHandR = { x: sk.neck.x + dir * 24, y: sk.neck.y + 18 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 15, y: sk.neck.y + 21 * verticalSign };
      desiredWeaponAngle = dir === 1 ? 0.04 : Math.PI - 0.04;
    } else if (f.parryWindowActive) {
      rawHandR = { x: sk.neck.x + dir * 26, y: sk.neck.y + 10 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 20, y: sk.neck.y + 17 * verticalSign };
      desiredWeaponAngle = dir === 1 ? -1.15 : Math.PI + 1.15;
    } else if (smoothAtk >= 0) {
      if (f.attackStyle === 'THRUST') {
        const thrust = Math.sin(atkProgress * Math.PI);
        rawHandR = { x: sk.neck.x + dir * (22 + thrust * 22), y: sk.neck.y + 12 * verticalSign };
        rawHandL = { x: sk.neck.x + dir * (14 + thrust * 20), y: sk.neck.y + 15 * verticalSign };
        desiredWeaponAngle = dir === 1 ? 0 : Math.PI;
      } else if (f.attackStyle === 'SLASH_UP') {
        const sweep = lerp(0.5, -1.25, smoothAtk);
        rawHandR = {
          x: sk.neck.x + dir * (24 + Math.sin(atkProgress * Math.PI) * 14),
          y: sk.neck.y + lerp(22, -6, smoothAtk) * verticalSign,
        };
        rawHandL = { x: rawHandR.x - dir * 8, y: rawHandR.y + 7 * verticalSign };
        desiredWeaponAngle = dir === 1 ? sweep : Math.PI - sweep;
      } else {
        const sweep = lerp(-1.32, 0.34, smoothAtk);
        rawHandR = {
          x: sk.neck.x + dir * (22 + Math.sin(atkProgress * Math.PI) * 16),
          y: sk.neck.y + lerp(-8, 18, smoothAtk) * verticalSign,
        };
        rawHandL = { x: rawHandR.x - dir * 8, y: rawHandR.y + 6 * verticalSign };
        desiredWeaponAngle = dir === 1 ? sweep : Math.PI - sweep;
      }
    } else {
      const breathe = Math.sin(timeSec * 2.5 + f.slot) * 0.04;
      const baseHold = id === 'scythe' ? -0.62 : -0.85;
      rawHandR = { x: sk.neck.x + dir * 24, y: sk.neck.y + 18 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 16, y: sk.neck.y + 23 * verticalSign };
      desiredWeaponAngle = dir === 1 ? baseHold + breathe : Math.PI - baseHold - breathe;
    }
  } else if (id === 'spear' || id === 'venom') {
    // ---- TWO-HANDED POLEARM / GLAIVE THRUST & DRAGOON SKY-DIVE ----
    if (f.dashKind === 'SPEAR_PLUNGE') {
      const diveAng = dir === 1 ? 0.62 : Math.PI - 0.62;
      rawHandR = { x: sk.neck.x + dir * 28, y: sk.neck.y + 18 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 14, y: sk.neck.y + 12 * verticalSign };
      desiredWeaponAngle = diveAng;
    } else if (smoothAtk >= 0) {
      const thrust = Math.sin(atkProgress * Math.PI) * 24;
      rawHandR = { x: sk.neck.x + dir * (22 + thrust), y: sk.neck.y + 14 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * (10 + thrust * 0.8), y: sk.neck.y + 17 * verticalSign };
      desiredWeaponAngle = f.aimAngle;
    } else {
      const breathe = Math.sin(timeSec * 2.6 + f.slot) * 0.03;
      rawHandR = { x: sk.neck.x + dir * 22, y: sk.neck.y + 18 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 10, y: sk.neck.y + 21 * verticalSign };
      desiredWeaponAngle = dir === 1 ? -0.18 + breathe : Math.PI + 0.18 - breathe;
    }
  } else if (id === 'sniper' || id === 'rocket' || id === 'laser') {
    // ---- SNIPER RIFLE / ROCKET LAUNCHER / PRISM LASER TWO-HANDED SHOULDER BRACE ----
    const recoilKick = atkProgress >= 0 ? Math.sin(atkProgress * Math.PI) * -0.16 : 0;
    const baseAng = f.aimAngle + recoilKick * dir;
    desiredWeaponAngle = baseAng;
    const cosA = Math.cos(baseAng);
    const sinA = Math.sin(baseAng);
    rawHandL = {
      x: sk.neck.x + cosA * 12,
      y: sk.neck.y + 12 * verticalSign + sinA * 12,
    };
    rawHandR = {
      x: sk.neck.x + cosA * 32,
      y: sk.neck.y + 12 * verticalSign + sinA * 32,
    };
  } else if (id === 'plier' || id === 'chainsaw') {
    // ---- GIANT PLIER / INDUSTRIAL CHAINSAW TWO-HANDED GRIP ----
    const lunge = atkProgress >= 0 ? Math.sin(atkProgress * Math.PI) * 16 : 0;
    const tilt = atkProgress >= 0 ? Math.sin(atkProgress * Math.PI) * -0.14 * dir : 0.04 * dir;
    desiredWeaponAngle = (dir === 1 ? 0 : Math.PI) + tilt;
    rawHandR = { x: sk.neck.x + dir * (26 + lunge), y: sk.neck.y + 15 * verticalSign };
    rawHandL = { x: sk.neck.x + dir * (15 + lunge), y: sk.neck.y + 20 * verticalSign };
  } else if (id === 'hammer' || id === 'anchor') {
    // ---- COLOSSAL WARHAMMER & NAVAL ANCHOR WINDUP & SLAM ----
    if (f.windupType === 'HAMMER_SLAM' && f.windupTimer > 0) {
      rawHandR = { x: sk.neck.x - dir * 14, y: sk.head.y - 20 * verticalSign };
      rawHandL = { x: sk.neck.x - dir * 6, y: sk.head.y - 14 * verticalSign };
      desiredWeaponAngle = dir === 1 ? -2.2 : Math.PI + 2.2;
    } else if (smoothAtk >= 0) {
      const slamAng = lerp(-1.85, 0.36, smoothAtk);
      rawHandR = { x: sk.neck.x + dir * 30, y: sk.neck.y + 22 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 20, y: sk.neck.y + 26 * verticalSign };
      desiredWeaponAngle = dir === 1 ? slamAng : Math.PI - slamAng;
    } else {
      rawHandR = { x: sk.neck.x + dir * 22, y: sk.neck.y + 20 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 13, y: sk.neck.y + 25 * verticalSign };
      desiredWeaponAngle = dir === 1 ? -0.65 : Math.PI + 0.65;
    }
  } else if (id === 'bulwark' && f.shieldIntegrity > 0) {
    // ---- TOWER SHIELD FORTRESS BRACE ----
    const bash = atkProgress >= 0 ? Math.sin(atkProgress * Math.PI) * 18 : 0;
    rawHandR = { x: sk.neck.x + dir * (23 + bash), y: sk.neck.y + 15 * verticalSign };
    rawHandL = { x: sk.neck.x + dir * (16 + bash), y: sk.neck.y + 22 * verticalSign };
    desiredWeaponAngle = dir === 1 ? 0 : Math.PI;
  } else if (
    id === 'blue_fire' ||
    id === 'glass' ||
    id === 'ice' ||
    id === 'gravity' ||
    id === 'black_hole' ||
    id === 'portal' ||
    id === 'sonic' ||
    id === 'earth' ||
    id === 'water' ||
    id === 'wind' ||
    id === 'alchemist'
  ) {
    // ---- ELEMENTAL / ACOUSTIC / ALCHEMICAL CASTERS ----
    if (
      f.windupType === 'GLASS_BARRAGE' ||
      f.windupType === 'FLAME_TORNADO' ||
      (f.attackStyle === 'RAISE_SUMMON' && atkProgress >= 0)
    ) {
      rawHandR = { x: sk.neck.x + dir * 14, y: sk.head.y - 25 * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 9, y: sk.neck.y + 30 * verticalSign };
      desiredWeaponAngle = -Math.PI * 0.5;
    } else if (atkProgress >= 0) {
      const cosA = Math.cos(f.aimAngle);
      const sinA = Math.sin(f.aimAngle);
      const ext = Math.sin(atkProgress * Math.PI) * 13;
      rawHandR = {
        x: sk.neck.x + cosA * (26 + ext),
        y: sk.neck.y + 10 * verticalSign + sinA * (26 + ext),
      };
      rawHandL = { x: sk.neck.x + dir * 8, y: sk.neck.y + 29 * verticalSign };
      desiredWeaponAngle = f.aimAngle;
    } else {
      const sway = Math.sin(timeSec * 3.5) * 2;
      rawHandR = { x: sk.neck.x + dir * 25, y: sk.neck.y + (14 + sway) * verticalSign };
      rawHandL = { x: sk.neck.x + dir * 9, y: sk.neck.y + (30 - sway * 0.5) * verticalSign };
      desiredWeaponAngle = f.aimAngle;
    }
  } else {
    // ---- MAGNET, RUBBER, CLONE, THUNDER, BOOMERANG, WHIP, SHADOW, YO-YO, TIME ----
    const whipExtend =
      id === 'rubber' && atkProgress >= 0
        ? Math.sin(atkProgress * Math.PI) * 44
        : (id === 'whip' || id === 'yo_yo') && atkProgress >= 0
        ? Math.sin(atkProgress * Math.PI) * 22
        : atkProgress >= 0
        ? Math.sin(atkProgress * Math.PI) * 15
        : 0;
    const reach = 24 + whipExtend;
    const swingOff =
      atkProgress >= 0 && id !== 'whip' && id !== 'yo_yo'
        ? Math.sin(atkProgress * Math.PI) * 0.52 * dir
        : 0;
    desiredWeaponAngle = f.aimAngle + swingOff;
    rawHandR = {
      x: sk.neck.x + Math.cos(desiredWeaponAngle) * reach,
      y: sk.neck.y + 13 * verticalSign + Math.sin(desiredWeaponAngle) * reach,
    };
    rawHandL = {
      x: sk.neck.x + dir * 9,
      y: sk.neck.y + 30 * verticalSign,
    };
  }

  // Active Get-Up Recovery: both hands planted firmly on the floor to push body up
  if (f.recoveryTimer > 0) {
    const handY = floorY - 4;
    rawHandL = { x: sk.pelvis.x - dir * 16, y: handY };
    rawHandR = { x: sk.pelvis.x + dir * 14, y: handY };
    desiredWeaponAngle = dir === 1 ? -0.3 : Math.PI + 0.3;
  }

  // Smoothly interpolate effector targets & weapon angle (with warp-snap safety!)
  if (Math.hypot(f.smoothHandR.x - sk.neck.x, f.smoothHandR.y - sk.neck.y) > 110) {
    f.smoothHandL = { ...rawHandL };
    f.smoothHandR = { ...rawHandR };
  } else {
    f.smoothHandL.x = lerp(f.smoothHandL.x, rawHandL.x, fastLimbSmooth);
    f.smoothHandL.y = lerp(f.smoothHandL.y, rawHandL.y, fastLimbSmooth);
    f.smoothHandR.x = lerp(f.smoothHandR.x, rawHandR.x, fastLimbSmooth);
    f.smoothHandR.y = lerp(f.smoothHandR.y, rawHandR.y, fastLimbSmooth);
  }

  if (f.spinDeflectTimer > 0) {
    f.smoothWeaponAngle = desiredWeaponAngle;
  } else {
    f.smoothWeaponAngle = lerpAngle(f.smoothWeaponAngle, desiredWeaponAngle, fastLimbSmooth);
  }

  // Exact gravity-aligned elbow IK:
  // sin(theta0 + a) - sin(theta0 - a) = 2 * cos(theta0) * sin(a) >= 0 iff hand.x >= neck.x!
  // Using sign(hand.x - neck.x) * verticalSign guarantees the elbow ALWAYS hangs downward under gravity
  // (including turnaround frames, overhead hammer windup, off-hand guard, and \_O_/ surrender)!
  const signHandL = f.smoothHandL.x >= sk.neck.x ? 1 : -1;
  const signHandR = f.smoothHandR.x >= sk.neck.x ? 1 : -1;
  const elbowBendL = (signHandL * verticalSign) as 1 | -1;
  const elbowBendR = (signHandR * verticalSign) as 1 | -1;

  const armL = solveTwoBoneIK(
    sk.neck,
    f.smoothHandL,
    UPPER_ARM * armScale,
    LOWER_ARM * armScale,
    elbowBendL
  );
  const armR = solveTwoBoneIK(
    sk.neck,
    f.smoothHandR,
    UPPER_ARM * armScale,
    LOWER_ARM * armScale,
    elbowBendR
  );
  sk.elbowL = armL.mid;
  sk.handL = armL.end;
  sk.elbowR = armR.mid;
  sk.handR = armR.end;

  syncRagdollFromActivePose(f, dt);
}

import { Vec2 } from '../types/game';

export const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
};

export const normalize = (x: number, y: number): Vec2 => {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
};

export const lerpAngle = (a: number, b: number, t: number): number => {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
};

/**
 * Analytic 2-bone Inverse Kinematics solver for 2D stickman arms and legs.
 * Given root joint (hip/shoulder), target position (foot/hand), upper bone length L1,
 * lower bone length L2, and bendDirection (+1 or -1), returns { midJoint, endJoint }.
 */
export function solveTwoBoneIK(
  root: Vec2,
  target: Vec2,
  L1: number,
  L2: number,
  bendDir: 1 | -1
): { mid: Vec2; end: Vec2 } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);
  const maxReach = L1 + L2 - 0.5;
  const minReach = Math.abs(L1 - L2) + 0.5;
  const d = clamp(rawDist, minReach, maxReach);

  const baseAngle = Math.atan2(dy, dx);
  const cosAngle = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const jointOffset = Math.acos(cosAngle) * bendDir;
  const theta1 = baseAngle + jointOffset;

  const mid: Vec2 = {
    x: root.x + Math.cos(theta1) * L1,
    y: root.y + Math.sin(theta1) * L1,
  };

  const endDir = normalize(target.x - mid.x, target.y - mid.y);
  const end: Vec2 =
    rawDist > maxReach
      ? {
          x: root.x + Math.cos(baseAngle) * maxReach,
          y: root.y + Math.sin(baseAngle) * maxReach,
        }
      : {
          x: mid.x + endDir.x * L2,
          y: mid.y + endDir.y * L2,
        };

  return { mid, end };
}

/**
 * Ray-AABB intersection test (slab method). Returns parametric t in [0, 1] along segment p1->p2, or null.
 */
export function segmentIntersectsAABB(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): { t: number; hitX: number; hitY: number; normalX: number; normalY: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;

  let tmin = 0;
  let tmax = 1;
  let hitNormalX = 0;
  let hitNormalY = 0;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < rx || x1 > rx + rw) return null;
  } else {
    const invD = 1 / dx;
    let t1 = (rx - x1) * invD;
    let t2 = (rx + rw - x1) * invD;
    let nx = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      nx = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNormalX = nx;
      hitNormalY = 0;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < ry || y1 > ry + rh) return null;
  } else {
    const invD = 1 / dy;
    let t1 = (ry - y1) * invD;
    let t2 = (ry + rh - y1) * invD;
    let ny = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      ny = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNormalX = 0;
      hitNormalY = ny;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return {
    t: tmin,
    hitX: x1 + dx * tmin,
    hitY: y1 + dy * tmin,
    normalX: hitNormalX,
    normalY: hitNormalY,
  };
}

/**
 * Closest distance from point (px, py) to segment (ax, ay)-(bx, by).
 */
export function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = clamp((wx * vx + wy * vy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}


import { addGameIntegers, assertGameInteger } from './fixed-point';

interface ArenaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface CircleBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
}

type CollisionAxis = 'x' | 'y' | null;

interface CollisionResolution {
  collided: boolean;
  axis: CollisionAxis;
  bodies: [CircleBody, CircleBody];
}

function validateBounds(bounds: ArenaBounds): void {
  for (const [label, value] of Object.entries(bounds)) {
    assertGameInteger(value, `bounds.${label}`);
  }
  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    throw new RangeError('arena bounds must have positive width and height');
  }
}

function validateBody(body: CircleBody): void {
  assertGameInteger(body.id, 'body.id');
  assertGameInteger(body.x, 'body.x');
  assertGameInteger(body.y, 'body.y');
  assertGameInteger(body.vx, 'body.vx');
  assertGameInteger(body.vy, 'body.vy');
  assertGameInteger(body.radius, 'body.radius');
  if (body.id < 0 || body.radius <= 0) {
    throw new RangeError('body id must be non-negative and radius must be positive');
  }
}

function squaredDistance(left: Pick<CircleBody, 'x' | 'y'>, right: Pick<CircleBody, 'x' | 'y'>): bigint {
  assertGameInteger(left.x, 'left.x');
  assertGameInteger(left.y, 'left.y');
  assertGameInteger(right.x, 'right.x');
  assertGameInteger(right.y, 'right.y');
  const dx = BigInt(right.x) - BigInt(left.x);
  const dy = BigInt(right.y) - BigInt(left.y);
  return dx * dx + dy * dy;
}

function circlesTouchOrOverlap(first: CircleBody, second: CircleBody): boolean {
  validateBody(first);
  validateBody(second);
  if (!first.active || !second.active) return false;
  const radiusSum = BigInt(first.radius) + BigInt(second.radius);
  return squaredDistance(first, second) <= radiusSum * radiusSum;
}

function clampBodyToArena(body: CircleBody, bounds: ArenaBounds): CircleBody {
  validateBounds(bounds);
  validateBody(body);
  const minX = addGameIntegers(bounds.minX, body.radius, 'minimum body x');
  const maxX = addGameIntegers(bounds.maxX, -body.radius, 'maximum body x');
  const minY = addGameIntegers(bounds.minY, body.radius, 'minimum body y');
  const maxY = addGameIntegers(bounds.maxY, -body.radius, 'maximum body y');
  if (minX > maxX || minY > maxY) {
    throw new RangeError('body does not fit inside the arena');
  }

  const x = Math.min(maxX, Math.max(minX, body.x));
  const y = Math.min(maxY, Math.max(minY, body.y));
  return {
    ...body,
    x,
    y,
    vx: x !== body.x ? 0 : body.vx,
    vy: y !== body.y ? 0 : body.vy,
  };
}

function stopApproaching(body: CircleBody, other: CircleBody, axis: 'x' | 'y', direction: number): void {
  if (axis === 'x') {
    if (body.vx * direction > 0) body.vx = 0;
    if (other.vx * direction < 0) other.vx = 0;
  } else {
    if (body.vy * direction > 0) body.vy = 0;
    if (other.vy * direction < 0) other.vy = 0;
  }
}

/**
 * Resolves one pair in ascending ID order. The lower ID receives the odd
 * pixel when an overlap cannot be split evenly, so pair order cannot decide
 * which body gets the advantage.
 */
function resolveCircleCollision(left: CircleBody, right: CircleBody): CollisionResolution {
  validateBody(left);
  validateBody(right);
  const ordered: [CircleBody, CircleBody] = left.id <= right.id ? [{ ...left }, { ...right }] : [{ ...right }, { ...left }];
  const [first, second] = ordered;

  if (!first.active || !second.active) {
    return { collided: false, axis: null, bodies: ordered };
  }

  const radiusSum = first.radius + second.radius;
  assertGameInteger(radiusSum, 'collision radius sum');
  const distance = squaredDistance(first, second);
  const radiusSquared = BigInt(radiusSum) * BigInt(radiusSum);
  if (distance > radiusSquared) {
    return { collided: false, axis: null, bodies: ordered };
  }
  if (distance === radiusSquared) {
    return { collided: true, axis: null, bodies: ordered };
  }

  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const overlapX = radiusSum - Math.abs(dx);
  const overlapY = radiusSum - Math.abs(dy);
  const axis: 'x' | 'y' = overlapX <= overlapY ? 'x' : 'y';
  const penetration = Math.max(1, axis === 'x' ? overlapX : overlapY);
  const direction = axis === 'x' ? (dx === 0 ? 1 : Math.sign(dx)) : (dy === 0 ? 1 : Math.sign(dy));
  const firstPush = Math.ceil(penetration / 2);
  const secondPush = penetration - firstPush;

  if (axis === 'x') {
    first.x = addGameIntegers(first.x, -direction * firstPush, 'collision first x');
    second.x = addGameIntegers(second.x, direction * secondPush, 'collision second x');
  } else {
    first.y = addGameIntegers(first.y, -direction * firstPush, 'collision first y');
    second.y = addGameIntegers(second.y, direction * secondPush, 'collision second y');
  }
  stopApproaching(first, second, axis, direction);
  return { collided: true, axis, bodies: ordered };
}

export {
  clampBodyToArena,
  circlesTouchOrOverlap,
  resolveCircleCollision,
  squaredDistance,
  validateBody,
  validateBounds,
};
export type { ArenaBounds, CircleBody, CollisionAxis, CollisionResolution };

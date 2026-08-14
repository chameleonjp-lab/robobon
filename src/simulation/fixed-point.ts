/**
 * Deterministic integer helpers used by the simulation layer.
 *
 * The browser UI may display decimal values, but the simulation keeps its
 * authoritative values as bounded integers.  Keeping the bound below both
 * Number.MAX_SAFE_INTEGER and int32 makes serialization and cross-engine
 * comparisons explicit.
 */

const FIXED_POINT_SCALE = 1_000;
const MAX_GAME_INTEGER = 2_000_000_000;

function assertGameInteger(value: number, label = 'value'): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_GAME_INTEGER) {
    throw new RangeError(`${label} must be a bounded safe integer`);
  }
  return value;
}

function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('cannot round a non-finite value');
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function toFixed(value: number, label = 'value'): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
  return assertGameInteger(roundHalfAwayFromZero(value * FIXED_POINT_SCALE), label);
}

function fromFixed(value: number, label = 'fixed value'): number {
  return assertGameInteger(value, label) / FIXED_POINT_SCALE;
}

function addGameIntegers(left: number, right: number, label = 'sum'): number {
  assertGameInteger(left, 'left operand');
  assertGameInteger(right, 'right operand');
  return assertGameInteger(left + right, label);
}

function multiplyFixed(left: number, right: number, label = 'product'): number {
  assertGameInteger(left, 'left operand');
  assertGameInteger(right, 'right operand');

  const product = BigInt(left) * BigInt(right);
  const sign = product < 0n ? -1n : 1n;
  const absolute = product < 0n ? -product : product;
  const rounded = ((absolute + BigInt(FIXED_POINT_SCALE / 2)) / BigInt(FIXED_POINT_SCALE)) * sign;

  if (rounded > BigInt(MAX_GAME_INTEGER) || rounded < BigInt(-MAX_GAME_INTEGER)) {
    throw new RangeError(`${label} exceeds the bounded safe integer range`);
  }
  return Number(rounded);
}

export {
  FIXED_POINT_SCALE,
  MAX_GAME_INTEGER,
  addGameIntegers,
  assertGameInteger,
  fromFixed,
  multiplyFixed,
  roundHalfAwayFromZero,
  toFixed,
};

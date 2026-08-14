import { assertGameInteger } from './fixed-point';

/** Stable purpose tags. Do not derive these from object or enum iteration. */
const PURPOSE_TAGS = {
  aim: 0x243f6a88,
  damage: 0x85a308d3,
  effect: 0x13198a2e,
  spawn: 0x9e3779b9,
} as const;

type RandomPurpose = keyof typeof PURPOSE_TAGS;

const DEFAULT_SEED = 0x6d2b79f5;

function normalizeSeed(seed: number): number {
  assertGameInteger(seed, 'seed');
  const normalized = seed >>> 0;
  return normalized === 0 ? DEFAULT_SEED : normalized;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function assertTuplePart(value: number, label: string): number {
  assertGameInteger(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
  return value;
}

/**
 * Return one deterministic 32-bit value for an independent random stream.
 * The tuple is intentionally explicit so adding a new effect does not shift
 * every later random value in a replay.
 */
function randomUint(
  seed: number,
  tick: number,
  entityId: number,
  purpose: RandomPurpose,
  index: number,
): number {
  const tag = PURPOSE_TAGS[purpose];
  if (tag === undefined) {
    throw new RangeError(`unknown random purpose: ${String(purpose)}`);
  }

  let state = normalizeSeed(seed);
  state = mix32(state ^ Math.imul(assertTuplePart(tick, 'tick') >>> 0, 0x9e3779b9));
  state = mix32(state ^ Math.imul(assertTuplePart(entityId, 'entityId') >>> 0, 0x85ebca6b));
  state = mix32(state ^ tag);
  state = mix32(state ^ Math.imul(assertTuplePart(index, 'index') >>> 0, 0xc2b2ae35));
  return state >>> 0;
}

function randomUnit(
  seed: number,
  tick: number,
  entityId: number,
  purpose: RandomPurpose,
  index: number,
): number {
  return randomUint(seed, tick, entityId, purpose, index) / 0x1_0000_0000;
}

export { DEFAULT_SEED, PURPOSE_TAGS, normalizeSeed, randomUint, randomUnit };
export type { RandomPurpose };

import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, normalizeSeed, randomUint, randomUnit } from './prng';

describe('independent deterministic random streams', () => {
  it('normalizes zero to the documented non-zero seed', () => {
    expect(normalizeSeed(0)).toBe(DEFAULT_SEED);
    expect(normalizeSeed(0)).toBe(normalizeSeed(DEFAULT_SEED));
  });

  it('returns the same value for the same tuple across calls', () => {
    const tuple = [1234, 60, 7, 'damage', 2] as const;
    expect(randomUint(...tuple)).toBe(randomUint(...tuple));
    expect(randomUnit(...tuple)).toBe(randomUnit(...tuple));
  });

  it('does not share a sequence when purpose or index changes', () => {
    const base = randomUint(1234, 60, 7, 'damage', 2);
    expect(randomUint(1234, 60, 7, 'effect', 2)).not.toBe(base);
    expect(randomUint(1234, 60, 7, 'damage', 3)).not.toBe(base);
    expect(randomUnit(1234, 60, 7, 'damage', 2)).toBeGreaterThanOrEqual(0);
    expect(randomUnit(1234, 60, 7, 'damage', 2)).toBeLessThan(1);
  });
});

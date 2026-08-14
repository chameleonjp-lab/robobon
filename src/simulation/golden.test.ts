import { describe, expect, it } from 'vitest';
import { randomUint } from './prng';
import { hashSimulationState } from './state-hash';

describe('golden replay seed', () => {
  it('keeps a stable random value and state fingerprint', () => {
    const state = {
      tick: 60,
      entities: [
        { id: 1, x: 100, y: 20, vx: 10, vy: 0, health: 100, heat: 0, active: true },
        { id: 2, x: 200, y: -50, vx: 0, vy: 10, health: 80, heat: 3, active: true },
      ],
    } as const;
    expect(randomUint(1234, 60, 7, 'damage', 2)).toBe(3_814_058_794);
    expect(hashSimulationState(state)).toBe('0xf4fbdbda');
  });
});

import { describe, expect, it } from 'vitest';
import { canonicalStateBytes, hashSimulationState } from './state-hash';
import type { SimulationState } from './state-hash';

const state: SimulationState = {
  tick: 60,
  entities: [
    { id: 2, x: 200, y: -50, vx: 0, vy: 10, health: 80, heat: 3, active: true },
    { id: 1, x: 100, y: 20, vx: 10, vy: 0, health: 100, heat: 0, active: true },
  ],
};

describe('canonical state hash', () => {
  it('sorts entities by stable id before serializing', () => {
    const reordered: SimulationState = { ...state, entities: [...state.entities].reverse() };
    expect(hashSimulationState(state)).toBe(hashSimulationState(reordered));
    expect(canonicalStateBytes(state)).toHaveLength(16 + 29 * 2);
  });

  it('changes when an authoritative value changes', () => {
    const changed: SimulationState = {
      ...state,
      entities: state.entities.map((entity) => (entity.id === 1 ? { ...entity, health: 99 } : entity)),
    };
    expect(hashSimulationState(changed)).not.toBe(hashSimulationState(state));
  });

  it('rejects non-finite and unbounded values', () => {
    expect(() => hashSimulationState({ ...state, tick: Number.NaN })).toThrow(RangeError);
    expect(() =>
      hashSimulationState({
        ...state,
        entities: [{ ...state.entities[0], x: 2_000_000_001 }],
      }),
    ).toThrow(RangeError);
  });
});

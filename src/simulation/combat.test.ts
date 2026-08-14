import { describe, expect, it } from 'vitest';
import {
  MAX_HEAT,
  OVERHEAT_DURATION_TICKS,
  createCombatState,
  evaluateMatchOutcome,
  runCombat,
  stepCombat,
  type CombatCommand,
  type CombatantState,
  type ProjectileState,
  type WeaponSpec,
} from './combat';

const arena = { minX: 0, maxX: 1_000, minY: 0, maxY: 600 };
const pulse: WeaponSpec = {
  id: 'pulse',
  ammoCost: 1,
  damage: 12,
  heat: 8,
  cooldownTicks: 2,
  projectileSpeed: 20,
  projectileRadius: 4,
  lifetimeTicks: 20,
};

function fighter(overrides: Partial<CombatantState> = {}): CombatantState {
  return {
    id: 1,
    x: 200,
    y: 300,
    radius: 12,
    maxHealth: 100,
    health: 100,
    heat: 0,
    ammo: 6,
    fireCooldownRemaining: 0,
    overheatRemaining: 0,
    damageDealt: 0,
    active: true,
    ...overrides,
  };
}

function initialState(overrides: Partial<Parameters<typeof createCombatState>[0]> = {}) {
  return createCombatState({
    arena,
    maxTicks: 120,
    combatants: [fighter(), fighter({ id: 2, x: 800 })],
    ...overrides,
  });
}

function fire(ownerId: number, heading: number, weapon = pulse): CombatCommand {
  return { kind: 'fire', ownerId, heading, weapon };
}

describe('combat actions and heat', () => {
  it('fires one projectile, consumes ammo, adds heat, and records the event', () => {
    const state = stepCombat(initialState(), [fire(1, 0)]);
    expect(state.combatants[0]).toMatchObject({ ammo: 5, heat: 8, fireCooldownRemaining: 2 });
    expect(state.projectiles).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: 'PROJECTILE_FIRED', sourceId: 1, projectileId: 0 });
  });

  it('rejects firing while cooling down, overheated, empty, or beyond the heat limit', () => {
    const cooling = stepCombat(initialState({ combatants: [fighter({ fireCooldownRemaining: 2 }), fighter({ id: 2, x: 800 })] }), [fire(1, 0)]);
    expect(cooling.events.at(-1)).toMatchObject({ type: 'ACTION_UNAVAILABLE', reason: 'cooldown' });

    const overheated = stepCombat(initialState({ combatants: [fighter({ overheatRemaining: 2 }), fighter({ id: 2, x: 800 })] }), [fire(1, 0)]);
    expect(overheated.events.at(-1)).toMatchObject({ type: 'ACTION_UNAVAILABLE', reason: 'overheated' });

    const tooHot: WeaponSpec = { ...pulse, heat: 11 };
    const blocked = stepCombat(initialState({ combatants: [fighter({ heat: 90 }), fighter({ id: 2, x: 800 })] }), [fire(1, 0, tooHot)]);
    expect(blocked.events.at(-1)).toMatchObject({ type: 'ACTION_UNAVAILABLE', reason: 'heat-limit' });
  });

  it('cools heat without shortening the overheat lock', () => {
    const state = stepCombat(
      initialState({ combatants: [fighter({ heat: 80, overheatRemaining: OVERHEAT_DURATION_TICKS }), fighter({ id: 2, x: 800 })] }),
      [{ kind: 'cool', ownerId: 1, amount: 25 }],
    );
    expect(state.combatants[0]).toMatchObject({ heat: 55, overheatRemaining: OVERHEAT_DURATION_TICKS - 1 });
    expect(state.events[0]).toMatchObject({ type: 'COOLED', value: 25 });
  });

  it('starts the fixed overheat timer when heat reaches the cap', () => {
    const hotWeapon: WeaponSpec = { ...pulse, heat: 10 };
    const state = stepCombat(initialState({ combatants: [fighter({ heat: 90 }), fighter({ id: 2, x: 800 })] }), [fire(1, 0, hotWeapon)]);
    expect(state.combatants[0]).toMatchObject({ heat: MAX_HEAT, overheatRemaining: OVERHEAT_DURATION_TICKS });
    expect(state.events.at(-1)).toMatchObject({ type: 'HEAT_STARTED', value: MAX_HEAT });
  });
});

describe('projectile hits and deterministic outcomes', () => {
  it('applies a hit once after the projectile crosses the target', () => {
    const state = runCombat(initialState({ combatants: [fighter({ x: 200 }), fighter({ id: 2, x: 300 })] }), [
      [fire(1, 0)],
      [],
      [],
      [],
      [],
    ]);
    expect(state.combatants[1]?.health).toBe(88);
    expect(state.events.filter((event) => event.type === 'HIT_CONFIRMED')).toHaveLength(1);
    expect(state.projectiles).toHaveLength(0);
  });

  it('applies both same-tick hits before deciding a simultaneous destruction draw', () => {
    const projectileA: ProjectileState = { id: 0, ownerId: 1, x: 788, y: 300, vx: 0, vy: 0, radius: 4, damage: 20, remainingTicks: 10, active: true };
    const projectileB: ProjectileState = { id: 1, ownerId: 2, x: 212, y: 300, vx: 0, vy: 0, radius: 4, damage: 20, remainingTicks: 10, active: true };
    const state = stepCombat(
      initialState({
        combatants: [fighter({ id: 1, x: 200, health: 20 }), fighter({ id: 2, x: 800, health: 20 })],
        projectiles: [projectileA, projectileB],
        nextProjectileId: 2,
      }),
      [],
    );
    expect(state.outcome).toEqual({ status: 'finished', winnerId: null, reason: 'draw' });
    expect(state.events.filter((event) => event.type === 'HIT_CONFIRMED')).toHaveLength(2);
  });

  it('uses health ratio, then lower heat, then damage as the time-limit tie-break', () => {
    const first = fighter({ id: 1, health: 50, maxHealth: 100, heat: 20, damageDealt: 10 });
    const second = fighter({ id: 2, x: 800, health: 25, maxHealth: 50, heat: 30, damageDealt: 40 });
    expect(evaluateMatchOutcome([first, second], 120, 120)).toEqual({ status: 'finished', winnerId: 1, reason: 'time-limit' });
    expect(evaluateMatchOutcome([fighter({ id: 1, health: 50, heat: 40 }), fighter({ id: 2, x: 800, health: 50, heat: 20 })], 120, 120)).toMatchObject({ winnerId: 2 });
    expect(evaluateMatchOutcome([fighter({ id: 1, health: 50, heat: 20, damageDealt: 10 }), fighter({ id: 2, x: 800, health: 50, heat: 20, damageDealt: 20 })], 120, 120)).toMatchObject({ winnerId: 2 });
  });

  it('finishes a short screen-free replay with the same result every time', () => {
    const commands = Array.from({ length: 20 }, (_, tick) => (tick === 0 ? [fire(1, 0)] : []));
    const first = runCombat(initialState({ maxTicks: 20, combatants: [fighter({ x: 200 }), fighter({ id: 2, x: 250, health: 12 })] }), commands);
    const second = runCombat(initialState({ maxTicks: 20, combatants: [fighter({ x: 200 }), fighter({ id: 2, x: 250, health: 12 })] }), commands);
    expect(first).toEqual(second);
    expect(first.outcome.status).toBe('finished');
  });
});

import { describe, expect, it } from 'vitest';
import { createGameSession } from '../application/game-session';
import {
  assessBattleAction,
  createBattleState,
  hasLineOfSight,
  hasProjectileWarning,
  type BattleActorConfig,
  type BattleRobotInput,
  type BattleState,
} from './battle-state';
import { runBattle, stepBattle } from './battle-step';
import type { RuleCard } from './rules';

const ARENA = { minX: 0, maxX: 640, minY: 0, maxY: 360 } as const;
const WEAPON = {
  id: 'pulse', ammoCost: 1, damage: 12, heat: 8, cooldownTicks: 30,
  projectileSpeed: 8, projectileRadius: 4, lifetimeTicks: 120,
  range: 250, aimTolerance: 8,
};

function robot(id: number, x: number, overrides: Partial<BattleRobotInput> = {}): BattleRobotInput {
  const heading = id === 1 ? 0 : 128;
  return {
    id, x, y: 180, radius: 16, maxHealth: 100, health: 100,
    heat: 0, ammo: 6, fireCooldownRemaining: 0, overheatRemaining: 0,
    damageDealt: 0, active: true, heading, turretHeading: heading,
    ...overrides,
  };
}

function actor(id: number, rules: readonly RuleCard[], overrides: Partial<BattleActorConfig> = {}): BattleActorConfig {
  return {
    id, rules, weapon: WEAPON, sensorRange: 1_000, nearRange: 120,
    moveSpeed: 2, strafeSpeed: 3, exploreSpeed: 1, turnSpeed: 64, turretTurnSpeed: 64,
    ...overrides,
  };
}

function state(
  playerRules: readonly RuleCard[],
  player: BattleRobotInput = robot(1, 190),
  enemyRules: readonly RuleCard[] = [{ id: 'enemy-stop', priority: 0, conditions: [], action: 'stop' }],
  enemy: BattleRobotInput = robot(2, 430),
  playerConfig: Partial<BattleActorConfig> = {},
  enemyConfig: Partial<BattleActorConfig> = {},
  extra: Partial<Parameters<typeof createBattleState>[0]> = {},
): BattleState {
  return createBattleState({
    arena: ARENA, maxTicks: 1_200,
    combatants: [player, enemy],
    actors: [actor(1, playerRules, playerConfig), actor(2, enemyRules, enemyConfig)],
    ...extra,
  });
}

describe('R01 common battle executor', () => {
  it('executes all seven actions as state changes, not labels', () => {
    const face = stepBattle(state([{ id: 'face', priority: 0, conditions: [], action: 'face-target' }], robot(1, 190, { heading: 64, turretHeading: 64 }), undefined, undefined, { turnSpeed: 8, turretTurnSpeed: 8 }));
    expect(face.combatants[0]).toMatchObject({ heading: 56, turretHeading: 56, speed: 0, vx: 0, vy: 0 });
    expect(face.actionEvents).toContainEqual(expect.objectContaining({ type: 'action-start', action: 'face-target' }));

    const fired = stepBattle(state([{ id: 'fire', priority: 0, conditions: [], action: 'fire-pulse' }]));
    expect(fired.combatants[0]).toMatchObject({ ammo: 5, heat: 8 });
    expect(fired.events).toContainEqual(expect.objectContaining({ type: 'PROJECTILE_FIRED', sourceId: 1 }));

    const retreated = stepBattle(state([{ id: 'retreat', priority: 0, conditions: [], action: 'retreat' }], robot(1, 190, { heading: 128, turretHeading: 128 })));
    expect(retreated.combatants[0]!.x).toBeLessThan(190);

    const strafed = stepBattle(state([{ id: 'strafe', priority: 0, conditions: [{ id: 'projectile-warning' }], action: 'strafe' }], robot(1, 190), undefined, robot(2, 430), {}, {}, {
      projectiles: [{ id: 0, ownerId: 2, x: 250, y: 180, vx: -8, vy: 0, radius: 4, damage: 1, remainingTicks: 20, active: true }],
    }));
    expect(strafed.combatants[0]!.y).not.toBe(180);

    const cooled = stepBattle(state([{ id: 'cool', priority: 0, conditions: [], action: 'cool' }], robot(1, 190, { heat: 40 }), undefined, undefined, { cooler: { amount: 10, cooldownTicks: 5 } }));
    expect(cooled.combatants[0]).toMatchObject({ heat: 30, coolingCooldownRemaining: 5 });

    const explored = stepBattle(state([{ id: 'explore', priority: 0, conditions: [], action: 'explore' }]));
    expect(explored.combatants[0]!.x).toBeGreaterThan(190);

    const stopped = stepBattle(state([{ id: 'stop', priority: 0, conditions: [], action: 'stop' }], robot(1, 190, { vx: 5, vy: 0, speed: 5 })));
    expect(stopped.combatants[0]).toMatchObject({ x: 190, speed: 0, vx: 0, vy: 0 });
  });

  it('skips a matching but unavailable card and chooses the first startable card', () => {
    const rules: RuleCard[] = [
      { id: 'face', priority: 0, conditions: [], action: 'face-target' },
      { id: 'fire', priority: 1, conditions: [], action: 'fire-pulse' },
    ];
    const next = stepBattle(state(rules));
    expect(next.combatants[0]?.runningAction?.action).toBe('fire-pulse');
    expect(next.actionEvents).toContainEqual(expect.objectContaining({
      type: 'preselectionskip', ruleId: 'face', reason: 'already-aimed',
    }));
    expect(next.selectionTrace.find((trace) => trace.actorId === 1)?.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'face', startable: false, selection: 'preselection-skip' }),
      expect.objectContaining({ ruleId: 'fire', startable: true, selection: 'selected' }),
    ]));
  });

  it('keeps a long action running and only switches at an evaluation boundary', () => {
    const rules: RuleCard[] = [
      { id: 'danger', priority: 0, conditions: [{ id: 'projectile-warning' }], action: 'retreat', durationTicks: 30 },
      { id: 'fallback', priority: 1, conditions: [], action: 'explore', durationTicks: 30 },
    ];
    let current = state(rules, robot(1, 190));
    current = stepBattle(current);
    expect(current.combatants[0]?.runningAction?.action).toBe('explore');
    for (let index = 0; index < 5; index += 1) current = stepBattle(current);
    expect(current.combatants[0]?.runningAction?.action).toBe('explore');
    const eventCount = current.actionEvents.length;
    for (let index = 0; index < 5; index += 1) current = stepBattle(current);
    expect(current.actionEvents.length).toBeGreaterThan(eventCount);

    const interruptionRules: RuleCard[] = [
      { id: 'danger', priority: 0, conditions: [{ id: 'projectile-warning' }], action: 'retreat' },
      { id: 'fallback', priority: 1, conditions: [], action: 'explore', durationTicks: 30 },
    ];
    const initialFallback = stepBattle(state(interruptionRules));
    const withProjectile = {
      ...initialFallback,
      projectiles: [{ id: 0, ownerId: 2, x: 400, y: 180, vx: -8, vy: 0, radius: 4, damage: 1, remainingTicks: 40, active: true }],
      nextProjectileId: 1,
    } as BattleState;
    let interrupted = stepBattle(withProjectile);
    interrupted = stepBattle(interrupted);
    interrupted = stepBattle(interrupted);
    interrupted = stepBattle(interrupted);
    interrupted = stepBattle(interrupted);
    interrupted = stepBattle(interrupted);
    expect(interrupted.combatants[0]?.runningAction?.action).toBe('retreat');
    expect(interrupted.actionEvents).toContainEqual(expect.objectContaining({ type: 'action-interrupt', ruleId: 'danger' }));

    const fired = state([{ id: 'fire', priority: 0, conditions: [], action: 'fire-pulse', durationTicks: 30 }]);
    let firedNext = stepBattle(fired);
    for (let index = 0; index < 5; index += 1) firedNext = stepBattle(firedNext);
    expect(firedNext.events.filter((event) => event.type === 'PROJECTILE_FIRED' && event.sourceId === 1)).toHaveLength(1);
    expect(firedNext.combatants[0]!.ammo).toBe(5);
  });

  it('records a post-start final failure without consuming ammunition', () => {
    const next = stepBattle(state(
      [{ id: 'fire', priority: 0, conditions: [], action: 'fire-pulse' }],
      robot(1, 190, { turretHeading: 0 }),
      [{ id: 'retreat', priority: 0, conditions: [], action: 'retreat' }],
      robot(2, 190, { heading: 128, turretHeading: 128 }),
      { weapon: { ...WEAPON, range: 0 } },
    ));
    expect(next.combatants[0]!.ammo).toBe(6);
    expect(next.actionEvents).toContainEqual(expect.objectContaining({
      type: 'poststartfailure', ruleId: 'fire', actionStartId: 0,
    }));
  });

  it('uses obstacle-aware line of sight and the same startability gate for facts and firing', () => {
    const blocked = state([{ id: 'fire', priority: 0, conditions: [], action: 'fire-pulse' }], robot(1, 190), undefined, robot(2, 430), {}, {}, {
      obstacles: [{ id: 'wall', x: 295, y: 150, width: 20, height: 60 }],
    });
    expect(hasLineOfSight(blocked, 1, 2)).toBe(false);
    expect(assessBattleAction(blocked, 1, 'fire-pulse')).toMatchObject({ startable: false, reason: 'line-of-sight' });
    const next = stepBattle(blocked);
    expect(next.combatants[0]?.runningAction?.action).toBeUndefined();
    expect(next.actionEvents).toContainEqual(expect.objectContaining({ type: 'preselectionskip', reason: 'line-of-sight' }));
  });

  it('does not warn for a projectile after its remaining lifetime and clears edge speed', () => {
    const shortLived = state([{ id: 'stop', priority: 0, conditions: [], action: 'stop' }], robot(1, 190), undefined, robot(2, 430), {}, {}, {
      projectiles: [{ id: 0, ownerId: 2, x: 400, y: 180, vx: -8, vy: 0, radius: 4, damage: 1, remainingTicks: 1, active: true }],
    });
    expect(hasProjectileWarning(shortLived, 1)).toBe(false);

    const edge = stepBattle(state([{ id: 'explore', priority: 0, conditions: [], action: 'explore' }], robot(1, 624)));
    expect(edge.combatants[0]).toMatchObject({ x: 624, vx: 0, vy: 0, speed: 0 });
  });

  it('runs both actors through the same step and stays deterministic across full replays', () => {
    const rules: RuleCard[] = [{ id: 'explore', priority: 0, conditions: [], action: 'explore' }];
    const first = runBattle(createGameSession(rules, 1_200), 1_200);
    const second = runBattle(createGameSession(rules, 1_200), 1_200);
    expect(first).toEqual(second);
    expect(first.combatants[0]!.x).not.toBe(190);
    expect(first.simulationVersion).toBe('r01-1');
    expect(first.selectionTrace.filter((trace) => trace.actorId === 1).length).toBeGreaterThan(0);
    expect(first.selectionTrace.filter((trace) => trace.actorId === 2).length).toBeGreaterThan(0);
    expect(first.actionEvents.some((event) => event.actorId === 2)).toBe(true);
  });
});

import { createBattleState, type BattleState } from '../simulation/battle-state';
import type { CombatantState } from '../simulation/combat';
import type { RuleCard } from '../simulation/rules';

export const PLAYER_ID = 1;
export const ENEMY_ID = 2;
export const MAX_BATTLE_TICKS = 20 * 60;
export const ARENA = { minX: 0, maxX: 640, minY: 0, maxY: 360 } as const;

export const DEFAULT_RULES: readonly RuleCard[] = [
  { id: 'rule-cool', priority: 0, conditions: [{ id: 'heat-high' }], action: 'cool' },
  { id: 'rule-face', priority: 1, conditions: [{ id: 'enemy-visible' }], action: 'face-target' },
  { id: 'rule-fire', priority: 2, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'rule-fallback', priority: 3, conditions: [], action: 'explore' },
];

export const ENEMY_RULES: readonly RuleCard[] = [
  { id: 'enemy-face', priority: 0, conditions: [{ id: 'enemy-visible' }], action: 'face-target' },
  { id: 'enemy-fire', priority: 1, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'enemy-stop', priority: 2, conditions: [], action: 'stop' },
];

const PULSE_WEAPON = {
  id: 'pulse', ammoCost: 1, damage: 12, heat: 8, cooldownTicks: 30,
  projectileSpeed: 8, projectileRadius: 4, lifetimeTicks: 120,
  range: 250, aimTolerance: 8,
};

const MOTION_AND_SENSORS = {
  sensorRange: 360, nearRange: 120, moveSpeed: 2, strafeSpeed: 3,
  exploreSpeed: 1, turnSpeed: 4, turretTurnSpeed: 8,
};

function makeCombatant(id: number, x: number): CombatantState & { heading: number; turretHeading: number } {
  const heading = id === PLAYER_ID ? 0 : 128;
  return {
    id, x, y: 180, radius: 16, maxHealth: 100, health: 100,
    heat: 0, ammo: 6, fireCooldownRemaining: 0, overheatRemaining: 0,
    damageDealt: 0, active: true, heading, turretHeading: heading,
  };
}

/** Both the real screen and integration checks start through this factory. */
export function createGameSession(rules: readonly RuleCard[], maxTicks = MAX_BATTLE_TICKS): BattleState {
  return createBattleState({
    arena: ARENA,
    maxTicks,
    combatants: [makeCombatant(PLAYER_ID, 190), makeCombatant(ENEMY_ID, 430)],
    actors: [
      { ...MOTION_AND_SENSORS, id: PLAYER_ID, rules, weapon: PULSE_WEAPON, cooler: { amount: 25, cooldownTicks: 120 } },
      { ...MOTION_AND_SENSORS, id: ENEMY_ID, rules: ENEMY_RULES, weapon: { ...PULSE_WEAPON, id: 'enemy-pulse', damage: 15, cooldownTicks: 45 } },
    ],
  });
}

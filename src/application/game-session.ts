import { createBattleState, type BattleState } from '../simulation/battle-state';
import type { CombatantState } from '../simulation/combat';
import type { RuleCard } from '../simulation/rules';
import {
  BATTLE_WEAPONS,
  INTRO_ARENA,
  missionById,
  type MissionCombatantSpec,
  type MissionId,
} from '../missions';

export const PLAYER_ID = 1;
export const ENEMY_ID = 2;
export const MAX_BATTLE_TICKS = 20 * 60;
/** Kept as a named application export for existing callers and tests. */
export const ARENA = INTRO_ARENA;

/**
 * The starter deck intentionally leaves two useful reactions below the
 * unconditional exploration card. Moving either card above it is a single,
 * legible change that can alter the first mission without adding a new rule.
 */
export const DEFAULT_RULES: readonly RuleCard[] = [
  { id: 'rule-cool', priority: 0, conditions: [{ id: 'heat-high' }], action: 'cool' },
  { id: 'rule-face', priority: 1, conditions: [{ id: 'enemy-visible' }], action: 'face-target' },
  { id: 'rule-fire', priority: 2, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'rule-fallback', priority: 3, conditions: [], action: 'explore' },
  { id: 'rule-retreat-near', priority: 4, conditions: [{ id: 'enemy-near' }], action: 'retreat' },
  { id: 'rule-strafe-warning', priority: 5, conditions: [{ id: 'projectile-warning' }], action: 'strafe' },
];

/** Default enemy behaviour is kept as a compatibility export for callers. */
export const ENEMY_RULES = missionById('dock-approach').battle.enemyRules;

function makeCombatant(
  id: number,
  setup: MissionCombatantSpec,
): CombatantState & { heading: number; turretHeading: number } {
  return {
    id,
    x: setup.x,
    y: setup.y,
    radius: setup.radius,
    maxHealth: setup.maxHealth,
    health: setup.health,
    heat: 0,
    ammo: setup.ammo,
    fireCooldownRemaining: 0,
    overheatRemaining: 0,
    damageDealt: 0,
    active: true,
    heading: setup.heading,
    turretHeading: setup.turretHeading,
  };
}

/** Both the real screen and integration checks start through this factory. */
export function createGameSession(
  rules: readonly RuleCard[],
  maxTicks = MAX_BATTLE_TICKS,
  missionId: MissionId = 'dock-approach',
): BattleState {
  const mission = missionById(missionId);
  const battle = mission.battle;
  return createBattleState({
    arena: battle.arena,
    maxTicks,
    combatants: [
      makeCombatant(PLAYER_ID, battle.player),
      makeCombatant(ENEMY_ID, battle.enemy),
    ],
    actors: [
      { ...battle.playerActor, id: PLAYER_ID, rules },
      { ...battle.enemyActor, id: ENEMY_ID, rules: battle.enemyRules },
    ],
    obstacles: battle.obstacles,
    contentVersion: battle.contentVersion,
  });
}

export { BATTLE_WEAPONS };

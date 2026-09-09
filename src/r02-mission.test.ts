import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, ENEMY_ID, PLAYER_ID, createGameSession } from './application/game-session';
import { missionById, INTRO_MISSIONS, MISSION_CONTENT_VERSION, BATTLE_WEAPONS } from './missions';
import { assessBattleAction, createBattleState, hasLineOfSight, readBattleFacts, withBattleCombatants } from './simulation/battle-state';
import { runBattle, stepBattle } from './simulation/battle-step';
import { compactReplayState } from './replay';
import type { RuleCard } from './simulation/rules';

function moveRule(rules: readonly RuleCard[], from: number, to: number): RuleCard[] {
  const next = rules.map((rule) => ({ ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })) }));
  const [moved] = next.splice(from, 1);
  if (!moved) throw new Error(`rule ${from} does not exist`);
  next.splice(to, 0, moved);
  return next.map((rule, priority) => ({ ...rule, priority }));
}

function runIntro(rules: readonly RuleCard[]) {
  const mission = missionById('dock-approach');
  return runBattle(createGameSession(rules, mission.battleTicks, mission.id), mission.battleTicks);
}

describe('R02 mission content and balance', () => {
  it('keeps weapon and mission setup in one versioned, distinct content contract', () => {
    expect(MISSION_CONTENT_VERSION).toBe('r02-1');
    expect(BATTLE_WEAPONS.playerPulse.range).toBe(250);
    expect(BATTLE_WEAPONS.enemyPulse.range).toBe(190);
    expect(INTRO_MISSIONS).toHaveLength(3);
    expect(createGameSession(DEFAULT_RULES, 120, 'dock-approach').contentVersion).toBe(MISSION_CONTENT_VERSION);
    expect(new Set(INTRO_MISSIONS.map((mission) => JSON.stringify({ setup: mission.battle.player, enemy: mission.battle.enemy, obstacles: mission.battle.obstacles }))).size).toBe(3);
    for (const mission of INTRO_MISSIONS) {
      expect(mission.battle.contentVersion).toBe(MISSION_CONTENT_VERSION);
      expect(mission.battle.obstacles.length).toBeGreaterThan(0);
      expect(mission.battle.improvementPaths).toHaveLength(2);
      expect(mission.battle.arena).toEqual({ minX: 0, maxX: 640, minY: 0, maxY: 360 });
    }
  });

  it('makes a weak first-mission deck lose while retreat and strafe changes win', () => {
    const baseline = runIntro(DEFAULT_RULES);
    const retreat = runIntro(moveRule(DEFAULT_RULES, 4, 3));
    const strafe = runIntro(moveRule(DEFAULT_RULES, 5, 3));

    expect(baseline.outcome).toMatchObject({ status: 'finished', winnerId: ENEMY_ID, reason: 'destruction' });
    expect(baseline.combatants[0]?.health).toBe(0);
    expect(retreat.outcome.winnerId).toBe(PLAYER_ID);
    expect(retreat.combatants[0]?.health).toBeGreaterThan(0);
    expect(strafe.outcome.winnerId).toBe(PLAYER_ID);
    expect(strafe.combatants[0]?.health).toBeGreaterThan(0);
    expect(baseline.actionEvents.some((event) => event.actorId === ENEMY_ID && event.action === 'explore')).toBe(true);
    expect(retreat.actionEvents.some((event) => event.actorId === PLAYER_ID && event.action === 'retreat')).toBe(true);
    expect(strafe.actionEvents.some((event) => event.actorId === PLAYER_ID && event.action === 'strafe')).toBe(true);
  });

  it('keeps range and terrain boundaries identical for facts and fire checks', () => {
    const mission = missionById('dock-approach');
    const state = createGameSession(DEFAULT_RULES, mission.battleTicks, mission.id);
    const boundary = withBattleCombatants(state, state.combatants.map((robot) => (
      robot.id === ENEMY_ID ? { ...robot, x: state.combatants.find((candidate) => candidate.id === PLAYER_ID)!.x + BATTLE_WEAPONS.playerPulse.range } : robot
    )));
    expect(readBattleFacts(boundary, PLAYER_ID).enemyInRange).toBe(true);
    expect(assessBattleAction(boundary, PLAYER_ID, 'fire-pulse')).toMatchObject({ startable: true, reason: 'available' });
    const outside = withBattleCombatants(state, state.combatants.map((robot) => (
      robot.id === ENEMY_ID ? { ...robot, x: state.combatants.find((candidate) => candidate.id === PLAYER_ID)!.x + BATTLE_WEAPONS.playerPulse.range + 1 } : robot
    )));
    expect(readBattleFacts(outside, PLAYER_ID).enemyInRange).toBe(false);
    expect(assessBattleAction(outside, PLAYER_ID, 'fire-pulse')).toMatchObject({ startable: false, reason: 'range' });

    const signal = createGameSession(DEFAULT_RULES, missionById('signal-gap').battleTicks, 'signal-gap');
    expect(hasLineOfSight(signal, PLAYER_ID, ENEMY_ID)).toBe(false);
    const signalClose = withBattleCombatants(signal, signal.combatants.map((robot) => (
      robot.id === ENEMY_ID ? { ...robot, x: 350 } : robot
    )));
    expect(assessBattleAction(signalClose, PLAYER_ID, 'fire-pulse')).toMatchObject({ startable: false, reason: 'line-of-sight' });
    expect(compactReplayState(signal).obstacles).toEqual(signal.obstacles);
  });

  it('reaches high heat, overheat, and cooling through the common battle step', () => {
    const mission = missionById('heat-window');
    const end = runBattle(createGameSession(DEFAULT_RULES, mission.battleTicks, mission.id), mission.battleTicks);
    expect(end.events.some((event) => event.type === 'HEAT_STARTED' && event.sourceId === PLAYER_ID)).toBe(true);
    expect(end.events.some((event) => event.type === 'COOLED' && event.sourceId === PLAYER_ID)).toBe(true);
    expect(end.events.some((event) => event.type === 'PROJECTILE_FIRED' && event.sourceId === PLAYER_ID)).toBe(true);
  });

  it('stops a moving body at a solid mission obstacle instead of drawing through it', () => {
    const mission = missionById('dock-approach');
    const state = createBattleState({
      arena: mission.battle.arena,
      maxTicks: 120,
      combatants: [
        { id: PLAYER_ID, x: 270, y: 180, radius: 16, maxHealth: 100, health: 100, heat: 0, ammo: 8, fireCooldownRemaining: 0, overheatRemaining: 0, damageDealt: 0, active: true, heading: 0, turretHeading: 0 },
        { id: ENEMY_ID, x: 560, y: 180, radius: 16, maxHealth: 100, health: 100, heat: 0, ammo: 8, fireCooldownRemaining: 0, overheatRemaining: 0, damageDealt: 0, active: true, heading: 128, turretHeading: 128 },
      ],
      actors: [
        { ...mission.battle.playerActor, id: PLAYER_ID, rules: [{ id: 'move', priority: 0, conditions: [], action: 'explore' }] },
        { ...mission.battle.enemyActor, id: ENEMY_ID, rules: [{ id: 'hold', priority: 0, conditions: [], action: 'stop' }] },
      ],
      obstacles: [{ id: 'test-wall', x: 280, y: 150, width: 40, height: 60 }],
    });
    let current = state;
    for (let tick = 0; tick < 20; tick += 1) current = stepBattle(current);
    expect(current.combatants.find((robot) => robot.id === PLAYER_ID)?.x).toBe(264);
  });
});

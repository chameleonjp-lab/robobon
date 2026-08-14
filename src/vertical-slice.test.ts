import { describe, expect, it } from 'vitest';
import { createCombatState } from './simulation/combat';
import { addRuleCard, DEFAULT_RULES, factsFromCombat, MAX_VERTICAL_SLICE_RULES } from './vertical-slice';

function combatant(id: number, x: number) {
  return {
    id,
    x,
    y: 180,
    radius: 16,
    maxHealth: 100,
    health: 100,
    heat: 0,
    ammo: 6,
    fireCooldownRemaining: 0,
    overheatRemaining: 0,
    damageDealt: 0,
    active: true,
  } as const;
}

describe('P1-09 vertical slice model', () => {
  it('starts with a cooling rule, a firing rule, and a safe fallback', () => {
    expect(DEFAULT_RULES.map((rule) => [rule.action, rule.priority])).toEqual([
      ['cool', 0],
      ['fire-pulse', 1],
      ['explore', 2],
    ]);
  });

  it('converts the combat state into facts the cards can explain', () => {
    const state = createCombatState({
      arena: { minX: 0, maxX: 640, minY: 0, maxY: 360 },
      maxTicks: 1_200,
      combatants: [combatant(1, 190), combatant(2, 430)],
    });
    expect(factsFromCombat(state)).toMatchObject({
      enemyVisible: true,
      enemyNear: false,
      enemyInRange: true,
      ammoAvailable: true,
      heatHigh: false,
      lineOfSight: true,
    });
  });

  it('adds cards up to the eight-card editing cap and refuses a ninth', () => {
    let rules = DEFAULT_RULES;
    while (rules.length < MAX_VERTICAL_SLICE_RULES) rules = addRuleCard(rules);

    expect(rules).toHaveLength(MAX_VERTICAL_SLICE_RULES);
    expect(rules.map((rule, index) => rule.priority)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(addRuleCard(rules)).toEqual(rules);
  });

  it('creates a stable new id when an earlier card was deleted', () => {
    const rules = addRuleCard(DEFAULT_RULES.filter((rule) => rule.id !== 'rule-2'));
    expect(rules.at(-1)?.id).toBe('rule-1');
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  });
});

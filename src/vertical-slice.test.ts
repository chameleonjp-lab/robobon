import { describe, expect, it } from 'vitest';
import { createCombatState } from './simulation/combat';
import {
  addRuleCard,
  commitRuleEdit,
  createRuleEditHistory,
  DEFAULT_RULES,
  durationSecondsLabel,
  factsFromCombat,
  inspectPreBattleRules,
  MAX_VERTICAL_SLICE_RULES,
  moveRuleCard,
  parseRuleDurationSeconds,
  scaleBattleElapsed,
  updateRuleAction,
  updateRuleCondition,
  undoRuleEdit,
} from './vertical-slice';

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
    const rules = addRuleCard(addRuleCard(DEFAULT_RULES)).filter((rule) => rule.id !== 'rule-1');
    const restored = addRuleCard(rules);
    expect(restored.at(-1)?.id).toBe('rule-1');
    expect(new Set(restored.map((rule) => rule.id)).size).toBe(restored.length);
  });

  it('moves cards without drag and always reassigns vertical priorities', () => {
    const moved = moveRuleCard(DEFAULT_RULES, 2, -1);
    expect(moved.map((rule) => rule.id)).toEqual(['rule-cool', 'rule-fallback', 'rule-fire']);
    expect(moved.map((rule) => rule.priority)).toEqual([0, 1, 2]);
  });

  it('keeps an undo history across editor rerenders', () => {
    const initial = createRuleEditHistory(DEFAULT_RULES);
    const changed = commitRuleEdit(initial, moveRuleCard(DEFAULT_RULES, 2, -1));
    const changedAgain = commitRuleEdit(changed, addRuleCard(changed.rules));
    const restoredOnce = undoRuleEdit(changedAgain);
    const restoredTwice = undoRuleEdit(restoredOnce);

    expect(restoredOnce.rules).toHaveLength(DEFAULT_RULES.length);
    expect(restoredOnce.rules[1]?.id).toBe('rule-fallback');
    expect(restoredTwice.rules).toEqual(DEFAULT_RULES);
    expect(undoRuleEdit(restoredTwice)).toEqual(restoredTwice);
  });

  it('rejects invalid condition and action values before they reach a rule', () => {
    expect(updateRuleCondition(DEFAULT_RULES, 0, 'unknown-condition')).toBeNull();
    expect(updateRuleAction(DEFAULT_RULES, 0, 'unknown-action')).toBeNull();
    expect(updateRuleCondition(DEFAULT_RULES, 99, 'always')).toBeNull();
  });

  it('accepts bounded duration input and converts seconds to fixed ticks', () => {
    expect(parseRuleDurationSeconds('0.1')).toEqual({ valid: true, durationTicks: 6 });
    expect(parseRuleDurationSeconds('10.0')).toEqual({ valid: true, durationTicks: 600 });
    expect(parseRuleDurationSeconds('')).toEqual({ valid: true, durationTicks: undefined });
    expect(durationSecondsLabel(30)).toBe('0.5');
  });

  it('does not save out-of-range or fractional-tenth duration values', () => {
    expect(parseRuleDurationSeconds('0')).toMatchObject({ valid: false });
    expect(parseRuleDurationSeconds('10.1')).toMatchObject({ valid: false });
    expect(parseRuleDurationSeconds('0.15')).toMatchObject({ valid: false });
    expect(parseRuleDurationSeconds('not-a-number')).toMatchObject({ valid: false });
  });

  it('scales speed without allowing an unbounded delayed frame', () => {
    expect(scaleBattleElapsed(16, 1)).toBe(16);
    expect(scaleBattleElapsed(16, 2)).toBe(32);
    expect(scaleBattleElapsed(500, 2)).toBe(200);
    expect(() => scaleBattleElapsed(Number.NaN, 1)).toThrow(RangeError);
  });

  it('allows a complete default作戦 and reports no pre-battle issues', () => {
    expect(inspectPreBattleRules(DEFAULT_RULES)).toEqual({ canStart: true, issues: [] });
  });

  it('blocks malformed作戦 but keeps strategic warnings separate', () => {
    const malformed = [{ ...DEFAULT_RULES[0], action: 'invalid-action' }] as never;
    const blocked = inspectPreBattleRules(malformed);
    expect(blocked.canStart).toBe(false);
    expect(blocked.issues[0]).toMatchObject({ severity: 'error', code: 'invalid-rule-set' });

    const noFallback = DEFAULT_RULES.map((rule) => ({
      ...rule,
      conditions: rule.conditions.length > 0 ? rule.conditions : [{ id: 'enemy-visible' as const }],
    }));
    const warned = inspectPreBattleRules(noFallback);
    expect(warned.canStart).toBe(true);
    expect(warned.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', code: 'no-fallback' }),
    ]));
  });
});

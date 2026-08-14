import { describe, expect, it } from 'vitest';
import {
  ACTION_DURATION_TICKS,
  ActionSwitchGuard,
  MAX_ACTION_SWITCHES_PER_SECOND,
  advanceAction,
  selectRule,
  type RuleCard,
  type RuleFacts,
} from './rules';

const facts: RuleFacts = {
  tick: 0,
  enemyVisible: true,
  enemyNear: true,
  enemyInRange: true,
  projectileWarning: false,
  ammoAvailable: true,
  heatHigh: false,
  boundaryDanger: false,
  lineOfSight: true,
};

const retreat: RuleCard = {
  id: 'retreat',
  priority: 0,
  conditions: [{ id: 'projectile-warning' }],
  action: 'retreat',
};

const fire: RuleCard = {
  id: 'fire',
  priority: 1,
  conditions: [{ id: 'enemy-in-range' }, { id: 'ammo-available' }],
  action: 'fire-pulse',
};

describe('rule selection', () => {
  it('selects the first matching card and records only inspected cards', () => {
    const result = selectRule([retreat, fire], facts);
    expect(result.rule?.id).toBe('fire');
    expect(result.reason).toBe('matched-first');
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations[0]?.matched).toBe(false);
    expect(result.evaluations[1]?.conditions.every((condition) => condition.passed)).toBe(true);
  });

  it('supports explicit negative conditions and a no-match explanation', () => {
    const result = selectRule(
      [{ id: 'safe', priority: 0, conditions: [{ id: 'enemy-visible', expected: false }], action: 'explore' }],
      facts,
    );
    expect(result.rule).toBeNull();
    expect(result.reason).toBe('no-match');
    expect(result.evaluations[0]?.conditions[0]).toMatchObject({ actual: true, expected: false, passed: false });
  });

  it('rejects ambiguous rule order and duplicate conditions', () => {
    expect(() => selectRule([{ ...retreat, priority: 1 }], facts)).toThrow(/vertical index/);
    expect(() =>
      selectRule(
        [{ ...retreat, conditions: [{ id: 'enemy-visible' }, { id: 'enemy-visible' }] }],
        facts,
      ),
    ).toThrow(/duplicate condition/);
  });
});

describe('action continuation and interruption', () => {
  it('continues an action until its fixed duration, then emits one completion', () => {
    const selected = selectRule([retreat], { ...facts, projectileWarning: true });
    const started = advanceAction(null, selected, 0);
    expect(started.status).toBe('started');
    const continued = advanceAction(started.running, selected, 1);
    expect(continued.status).toBe('continued');
    const completed = advanceAction(started.running, selected, ACTION_DURATION_TICKS.retreat);
    expect(completed).toMatchObject({ status: 'completed', reason: 'duration-elapsed', running: null });
  });

  it('does not let a lower-priority match interrupt an unfinished action', () => {
    const high = selectRule([retreat], { ...facts, projectileWarning: true });
    const low = selectRule([retreat, fire], facts);
    const started = advanceAction(null, high, 0);
    const decision = advanceAction(started.running, low, 1);
    expect(decision).toMatchObject({ status: 'continued', reason: 'lower-priority-held' });
    expect(decision.running?.ruleId).toBe('retreat');
  });

  it('allows a higher-priority match to interrupt and report the event', () => {
    const low: RuleCard = { ...fire, priority: 1, action: 'strafe' };
    const high: RuleCard = { ...retreat, priority: 0 };
    const started = advanceAction(null, selectRule([high, low], facts), 0);
    const decision = advanceAction(started.running, selectRule([high, low], { ...facts, projectileWarning: true }), 1);
    expect(decision).toMatchObject({ status: 'interrupted', reason: 'higher-priority-interrupt' });
    expect(decision.running?.ruleId).toBe('retreat');
  });
});

describe('action switch guard', () => {
  it('allows four switches per second, rejects the fifth, and resets on the next second', () => {
    const guard = new ActionSwitchGuard();
    expect(guard.trySwitch(0, 'a')).toBe(true);
    expect(guard.trySwitch(1, 'b')).toBe(true);
    expect(guard.trySwitch(2, 'c')).toBe(true);
    expect(guard.trySwitch(3, 'd')).toBe(true);
    expect(guard.trySwitch(4, 'e')).toBe(false);
    expect(guard.switchesInWindow).toBe(MAX_ACTION_SWITCHES_PER_SECOND);
    expect(guard.trySwitch(60, 'e')).toBe(true);
    expect(guard.switchesInWindow).toBe(1);
  });

  it('does not consume switch budget when the same action is reevaluated', () => {
    const guard = new ActionSwitchGuard();
    expect(guard.trySwitch(0, 'retreat:retreat')).toBe(true);
    expect(guard.trySwitch(1, 'retreat:retreat')).toBe(true);
    expect(guard.switchesInWindow).toBe(1);
  });
});

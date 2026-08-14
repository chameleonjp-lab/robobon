/**
 * Deterministic vertical rule-card executor.
 *
 * The executor deliberately knows nothing about rendering or input.  A caller
 * supplies a complete snapshot of facts for one simulation tick, and the
 * first matching card in the declared order wins.  This keeps replay output
 * independent from object iteration order and makes the reason for a decision
 * inspectable in the analysis screen later.
 */

export const TICKS_PER_SECOND = 60;
export const MAX_RULES = 12;
export const MAX_CONDITIONS_PER_RULE = 2;
export const MAX_ACTION_SWITCHES_PER_SECOND = 4;

export type ConditionId =
  | 'enemy-visible'
  | 'enemy-near'
  | 'enemy-in-range'
  | 'projectile-warning'
  | 'ammo-available'
  | 'heat-high'
  | 'boundary-danger'
  | 'line-of-sight';

export type ActionId =
  | 'face-target'
  | 'fire-pulse'
  | 'retreat'
  | 'strafe'
  | 'cool'
  | 'explore'
  | 'stop';

export interface RuleCondition {
  readonly id: ConditionId;
  /** Defaults to true.  false means an explicit NOT condition. */
  readonly expected?: boolean;
}

export interface RuleCard {
  readonly id: string;
  /** Lower numbers are higher in the vertical list. */
  readonly priority: number;
  readonly conditions: readonly RuleCondition[];
  readonly action: ActionId;
  /** Optional deterministic override for the action's default duration. */
  readonly durationTicks?: number;
}

export interface RuleFacts {
  readonly tick: number;
  readonly enemyVisible: boolean;
  readonly enemyNear: boolean;
  readonly enemyInRange: boolean;
  readonly projectileWarning: boolean;
  readonly ammoAvailable: boolean;
  readonly heatHigh: boolean;
  readonly boundaryDanger: boolean;
  readonly lineOfSight: boolean;
}

export interface ConditionEvaluation {
  readonly id: ConditionId;
  readonly expected: boolean;
  readonly actual: boolean;
  readonly passed: boolean;
}

export interface RuleEvaluation {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly conditions: readonly ConditionEvaluation[];
}

export interface RuleSelection {
  readonly rule: RuleCard | null;
  readonly evaluations: readonly RuleEvaluation[];
  readonly reason: 'matched-first' | 'no-match';
}

export type ActionDecisionStatus =
  | 'started'
  | 'continued'
  | 'completed'
  | 'interrupted'
  | 'idle'
  | 'held';

export type ActionDecisionReason =
  | 'new-selection'
  | 'same-rule'
  | 'duration-elapsed'
  | 'no-match-while-active'
  | 'higher-priority-interrupt'
  | 'lower-priority-held'
  | 'switch-rate-limit'
  | 'no-selection';

export interface RunningAction {
  readonly ruleId: string;
  readonly priority: number;
  readonly action: ActionId;
  readonly startedTick: number;
  readonly completesAtTick: number;
  readonly lastTick: number;
}

export interface ActionDecision {
  readonly status: ActionDecisionStatus;
  readonly reason: ActionDecisionReason;
  readonly running: RunningAction | null;
}

export const ACTION_DURATION_TICKS: Readonly<Record<ActionId, number>> = {
  'face-target': 1,
  'fire-pulse': 1,
  retreat: 6,
  strafe: 6,
  cool: 12,
  explore: 12,
  stop: 1,
};

const CONDITION_IDS = new Set<ConditionId>([
  'enemy-visible',
  'enemy-near',
  'enemy-in-range',
  'projectile-warning',
  'ammo-available',
  'heat-high',
  'boundary-danger',
  'line-of-sight',
]);

const ACTION_IDS = new Set<ActionId>([
  'face-target',
  'fire-pulse',
  'retreat',
  'strafe',
  'cool',
  'explore',
  'stop',
]);

const FACT_KEYS = [
  'enemyVisible',
  'enemyNear',
  'enemyInRange',
  'projectileWarning',
  'ammoAvailable',
  'heatHigh',
  'boundaryDanger',
  'lineOfSight',
] as const satisfies readonly (keyof RuleFacts)[];

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a safe integer in [${min}, ${max}]`);
  }
}

function assertTick(tick: number): void {
  assertIntegerInRange(tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
}

function assertRuleId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(id)) {
    throw new Error(`rule id is invalid: ${id}`);
  }
}

function readConditionValue(condition: ConditionId, facts: RuleFacts): boolean {
  switch (condition) {
    case 'enemy-visible':
      return facts.enemyVisible;
    case 'enemy-near':
      return facts.enemyNear;
    case 'enemy-in-range':
      return facts.enemyInRange;
    case 'projectile-warning':
      return facts.projectileWarning;
    case 'ammo-available':
      return facts.ammoAvailable;
    case 'heat-high':
      return facts.heatHigh;
    case 'boundary-danger':
      return facts.boundaryDanger;
    case 'line-of-sight':
      return facts.lineOfSight;
  }
}

function validateFacts(facts: RuleFacts): void {
  if (!facts || typeof facts !== 'object') {
    throw new Error('facts must be an object');
  }
  assertTick(facts.tick);
  for (const key of FACT_KEYS) {
    if (typeof facts[key] !== 'boolean') {
      throw new Error(`fact ${key} must be boolean`);
    }
  }
  const allowedKeys = new Set<string>(['tick', ...FACT_KEYS]);
  for (const key of Object.keys(facts)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`unknown fact: ${key}`);
    }
  }
}

/** Validates the bounded, canonical representation used by replays. */
export function validateRuleSet(rules: readonly RuleCard[]): void {
  if (!Array.isArray(rules) || rules.length > MAX_RULES) {
    throw new Error(`rule count must be in [0, ${MAX_RULES}]`);
  }

  const ids = new Set<string>();
  rules.forEach((rule, index) => {
    assertRuleId(rule.id);
    if (ids.has(rule.id)) {
      throw new Error(`duplicate rule id: ${rule.id}`);
    }
    ids.add(rule.id);
    assertIntegerInRange(rule.priority, 0, MAX_RULES - 1, `priority for ${rule.id}`);
    if (rule.priority !== index) {
      throw new Error(`rule ${rule.id} priority must equal its vertical index ${index}`);
    }
    const conditions: readonly RuleCondition[] = rule.conditions;
    if (!Array.isArray(conditions) || conditions.length > MAX_CONDITIONS_PER_RULE) {
      throw new Error(`rule ${rule.id} has too many conditions`);
    }
    const conditionIds = new Set<ConditionId>();
    conditions.forEach((condition: RuleCondition) => {
      if (!CONDITION_IDS.has(condition.id)) {
        throw new Error(`unknown condition: ${String(condition.id)}`);
      }
      if (conditionIds.has(condition.id)) {
        throw new Error(`duplicate condition ${condition.id} in ${rule.id}`);
      }
      conditionIds.add(condition.id);
      if (condition.expected !== undefined && typeof condition.expected !== 'boolean') {
        throw new Error(`condition expected must be boolean in ${rule.id}`);
      }
    });
    if (!ACTION_IDS.has(rule.action)) {
      throw new Error(`unknown action: ${String(rule.action)}`);
    }
    if (rule.durationTicks !== undefined) {
      assertIntegerInRange(rule.durationTicks, 1, TICKS_PER_SECOND * 10, `duration for ${rule.id}`);
    }
  });
}

/**
 * Evaluates every card in order and returns the first match plus an audit
 * record for every rejected card.  An empty condition list is an explicit
 * fallback card and therefore matches all fact snapshots.
 */
export function selectRule(rules: readonly RuleCard[], facts: RuleFacts): RuleSelection {
  validateRuleSet(rules);
  validateFacts(facts);

  const evaluations: RuleEvaluation[] = [];
  for (const rule of rules) {
    const conditions = rule.conditions.map((condition): ConditionEvaluation => {
      const expected = condition.expected ?? true;
      const actual = readConditionValue(condition.id, facts);
      return { id: condition.id, expected, actual, passed: actual === expected };
    });
    const matched = conditions.every((condition) => condition.passed);
    evaluations.push({ ruleId: rule.id, matched, conditions });
    if (matched) {
      return { rule, evaluations, reason: 'matched-first' };
    }
  }
  return { rule: null, evaluations, reason: 'no-match' };
}

function actionKey(rule: RuleCard): string {
  return `${rule.id}:${rule.action}`;
}

/**
 * Sliding one-second guard for the visible action timeline.  Re-evaluating the
 * same action is not a switch; only a different action key consumes budget.
 */
export class ActionSwitchGuard {
  private windowStartTick = 0;
  private switchCount = 0;
  private lastActionKey: string | null = null;
  private lastObservedTick = -1;

  public trySwitch(tick: number, nextActionKey: string): boolean {
    assertTick(tick);
    if (tick <= this.lastObservedTick) {
      throw new Error(`action switch tick must increase: ${tick}`);
    }
    this.lastObservedTick = tick;
    if (tick - this.windowStartTick >= TICKS_PER_SECOND) {
      this.windowStartTick = tick;
      this.switchCount = 0;
      this.lastActionKey = null;
    }
    if (this.lastActionKey === null) {
      this.lastActionKey = nextActionKey;
      return true;
    }
    if (this.lastActionKey === nextActionKey) {
      return true;
    }
    if (this.switchCount >= MAX_ACTION_SWITCHES_PER_SECOND) {
      return false;
    }
    this.switchCount += 1;
    this.lastActionKey = nextActionKey;
    return true;
  }

  public get switchesInWindow(): number {
    return this.switchCount;
  }
}

function durationFor(rule: RuleCard): number {
  return rule.durationTicks ?? ACTION_DURATION_TICKS[rule.action];
}

function startAction(
  rule: RuleCard,
  tick: number,
  reason: ActionDecisionReason,
  guard?: ActionSwitchGuard,
): ActionDecision {
  if (guard && !guard.trySwitch(tick, actionKey(rule))) {
    return { status: 'held', reason: 'switch-rate-limit', running: null };
  }
  const duration = durationFor(rule);
  return {
    status: 'started',
    reason,
    running: {
      ruleId: rule.id,
      priority: rule.priority,
      action: rule.action,
      startedTick: tick,
      completesAtTick: tick + duration,
      lastTick: tick,
    },
  };
}

/**
 * Advances one action state.  A lower-priority card cannot interrupt an
 * unfinished action; a higher-priority card may interrupt it.  Completion is
 * reported once, so the caller can record the event before starting a new
 * action on the next simulation tick.
 */
export function advanceAction(
  running: RunningAction | null,
  selection: RuleSelection,
  tick: number,
  guard?: ActionSwitchGuard,
): ActionDecision {
  assertTick(tick);
  const selected = selection.rule;
  if (!running) {
    return selected
      ? startAction(selected, tick, 'new-selection', guard)
      : { status: 'idle', reason: 'no-selection', running: null };
  }
  if (tick <= running.lastTick) {
    throw new Error(`action tick must increase: ${tick}`);
  }

  const updateRunning = (status: ActionDecisionStatus, reason: ActionDecisionReason): ActionDecision => ({
    status,
    reason,
    running: { ...running, lastTick: tick },
  });

  if (tick >= running.completesAtTick) {
    return { status: 'completed', reason: 'duration-elapsed', running: null };
  }
  if (!selected) {
    return updateRunning('continued', 'no-match-while-active');
  }
  if (selected.id === running.ruleId) {
    return updateRunning('continued', 'same-rule');
  }
  if (selected.priority < running.priority) {
    const decision = startAction(selected, tick, 'higher-priority-interrupt', guard);
    return decision.status === 'held' ? { ...decision, running } : { ...decision, status: 'interrupted' };
  }
  return updateRunning('continued', 'lower-priority-held');
}

import { addGameIntegers, assertGameInteger } from './fixed-point';
import { createCombatState, MAX_COMBAT_TICKS, MAX_EVENTS_PER_REPLAY, MAX_HEAT } from './combat';
import type {
  CombatState,
  CombatantState,
  WeaponSpec,
} from './combat';
import { squaredDistance, validateBounds } from './geometry';
import type { ArenaBounds } from './geometry';
import { forecastBoundaryRisk, headingToPoint, readSensor } from './sensor';
import type { MotionBody } from './motion';
import {
  ACTION_DURATION_TICKS,
  evaluateRuleCard,
  MAX_ACTION_SWITCHES_PER_SECOND,
  type ActionId,
  type RuleCard,
  type RuleEvaluation,
  type RuleFacts,
  type RunningAction,
  validateRuleSet,
} from './rules';
import { CURRENT_SIMULATION_VERSION } from './version';

/** The rule scheduler samples facts every 0.1 seconds (six 60Hz ticks). */
export const BATTLE_RULE_EVALUATION_INTERVAL_TICKS = 6;
export const BATTLE_TICKS_PER_SECOND = 60;
export const DEFAULT_SENSOR_RANGE = 1_000;
export const DEFAULT_AIM_TOLERANCE = 4;
export const DEFAULT_NEAR_RANGE = 300;
export const DEFAULT_MOVE_SPEED = 4;
export const DEFAULT_TURN_SPEED = 8;
export const DEFAULT_COOLING_AMOUNT = 20;
export const DEFAULT_COOLING_COOLDOWN_TICKS = 30;
export const DEFAULT_PROJECTILE_WARNING_LOOKAHEAD_TICKS = 30;
export const MAX_BATTLE_ACTION_EVENTS = MAX_EVENTS_PER_REPLAY;
export const MAX_BATTLE_SELECTION_TRACE = MAX_EVENTS_PER_REPLAY;

/** A rectangular, axis-aligned piece of solid arena geometry. */
export interface BattleObstacle {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Convenient authoring shape accepted by createBattleState. */
export type BattleObstacleInput =
  | BattleObstacle
  | {
      readonly id: string | number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly id: string | number;
      readonly minX: number;
      readonly maxX: number;
      readonly minY: number;
      readonly maxY: number;
    };

export interface CoolerSpec {
  readonly id?: string;
  readonly amount: number;
  readonly cooldownTicks?: number;
}

/** Weapon values used by the R01 action-start and final fire checks. */
export interface BattleWeaponSpec extends WeaponSpec {
  /** Maximum centre-to-centre firing distance. Omitted means sensor range. */
  readonly range?: number;
  /** Maximum fixed-heading error accepted by the fire gate. */
  readonly aimTolerance?: number;
}

export interface BattleActorConfig {
  readonly id: number;
  readonly rules: readonly RuleCard[];
  readonly weapon: BattleWeaponSpec;
  readonly cooler?: CoolerSpec;
  readonly moveSpeed?: number;
  readonly turnSpeed?: number;
  readonly turretTurnSpeed?: number;
  readonly sensorRange?: number;
  readonly nearRange?: number;
  readonly aimTolerance?: number;
  readonly strafeSpeed?: number;
  readonly exploreSpeed?: number;
  readonly projectileWarningLookaheadTicks?: number;
}

/** Input combatants may omit motion/action fields; defaults are deterministic. */
export type BattleRobotInput = CombatantState &
  Partial<
    Pick<
      BattleRobot,
      | 'heading'
      | 'turretHeading'
      | 'vx'
      | 'vy'
      | 'speed'
      | 'coolingCooldownRemaining'
      | 'runningAction'
      | 'actionStartId'
      | 'actionSwitchWindowStartTick'
      | 'actionSwitchCount'
      | 'lastActionKey'
      | 'lastRuleEvaluationTick'
      | 'selectedRuleId'
    >
  >;

export interface BattleRobot extends CombatantState {
  readonly heading: number;
  readonly turretHeading: number;
  readonly vx: number;
  readonly vy: number;
  /** Current commanded scalar speed in arena units per tick. */
  readonly speed: number;
  readonly coolingCooldownRemaining: number;
  readonly runningAction: RunningAction | null;
  /** Stable ID joining action events from selection through completion/failure. */
  readonly actionStartId: number | null;
  /** Start of the one-second switch-rate window. */
  readonly actionSwitchWindowStartTick: number;
  /** Distinct action key switches in the current one-second window. */
  readonly actionSwitchCount: number;
  readonly lastActionKey: string | null;
  /** Last tick at which this actor walked its rule list. */
  readonly lastRuleEvaluationTick: number | null;
  readonly selectedRuleId: string | null;
}

export interface BattleRuleEvaluation extends RuleEvaluation {
  readonly startable?: boolean;
  readonly availabilityReason?: BattleActionAvailabilityReason;
  readonly selection?: 'condition-failed' | 'preselection-skip' | 'selected' | 'continuation';
}

export interface BattleSelectionTrace {
  readonly tick: number;
  readonly actorId: number;
  readonly facts: RuleFacts;
  readonly evaluations: readonly BattleRuleEvaluation[];
  readonly selectedRuleId: string | null;
  readonly reason: 'selected' | 'no-match' | 'all-unavailable';
}

export type BattleActionEventType =
  | 'preselectionskip'
  | 'poststartfailure'
  | 'action-start'
  | 'action-continue'
  | 'action-interrupt'
  | 'action-complete'
  | 'action-held'
  | 'action-idle';

/** Analysis-visible event; unlike CombatEvent it describes rule execution. */
export interface BattleActionEvent {
  readonly type: BattleActionEventType;
  readonly phase: 'preselection' | 'post-start' | 'execution';
  readonly tick: number;
  readonly actorId: number;
  readonly ruleId?: string;
  readonly action?: ActionId;
  readonly actionStartId?: number;
  readonly previousActionStartId?: number;
  readonly reason?: string;
}

export type BattleActionAvailabilityReason =
  | 'available'
  | 'inactive'
  | 'target-missing'
  | 'target-inactive'
  | 'already-aimed'
  | 'range'
  | 'line-of-sight'
  | 'aim'
  | 'ammo-empty'
  | 'cooldown'
  | 'overheated'
  | 'heat-limit'
  | 'cooler-missing'
  | 'cooler-cooldown'
  | 'no-heat'
  | 'unknown-action';

export interface BattleActionAvailability {
  readonly startable: boolean;
  readonly reason: BattleActionAvailabilityReason;
  readonly targetId: number | null;
}

export interface BattleState extends CombatState {
  readonly combatants: readonly BattleRobot[];
  readonly actors: readonly BattleActorConfig[];
  readonly obstacles: readonly BattleObstacle[];
  readonly actionEvents: readonly BattleActionEvent[];
  readonly selectionTrace: readonly BattleSelectionTrace[];
  readonly nextActionStartId: number;
  readonly simulationVersion: typeof CURRENT_SIMULATION_VERSION;
  /** Content tuning version (weapons, enemy setup, and mission geometry). */
  readonly contentVersion?: string;
}

export interface BattleStateInput {
  readonly arena: ArenaBounds;
  readonly maxTicks: number;
  readonly combatants: readonly BattleRobotInput[];
  readonly actors: readonly BattleActorConfig[];
  readonly obstacles?: readonly BattleObstacleInput[];
  readonly tick?: number;
  readonly projectiles?: CombatState['projectiles'];
  readonly nextProjectileId?: number;
  readonly nextActionStartId?: number;
  readonly simulationVersion?: string;
  readonly contentVersion?: string;
}

function assertId(value: number, label: string): void {
  assertGameInteger(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

function assertTextId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value)) {
    throw new RangeError(`${label} is invalid`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  assertGameInteger(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

function assertHeading(value: number, label: string): void {
  assertGameInteger(value, label);
  if (value < 0 || value >= 256) throw new RangeError(`${label} must be a heading in [0, 255]`);
}

function normalizeObstacle(input: BattleObstacleInput, index: number): BattleObstacle {
  const rawId = input.id;
  const id = typeof rawId === 'number' ? `obstacle-${rawId}` : rawId;
  assertTextId(id, `obstacles[${index}].id`);

  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;
  if ('width' in input) {
    assertGameInteger(input.x, `obstacles[${index}].x`);
    assertGameInteger(input.y, `obstacles[${index}].y`);
    assertGameInteger(input.width, `obstacles[${index}].width`);
    assertGameInteger(input.height, `obstacles[${index}].height`);
    if (input.width <= 0 || input.height <= 0) throw new RangeError('obstacle dimensions must be positive');
    minX = input.x;
    maxX = addGameIntegers(input.x, input.width, `obstacles[${index}].maxX`);
    minY = input.y;
    maxY = addGameIntegers(input.y, input.height, `obstacles[${index}].maxY`);
  } else {
    for (const [label, value] of [
      ['minX', input.minX],
      ['maxX', input.maxX],
      ['minY', input.minY],
      ['maxY', input.maxY],
    ] as const) assertGameInteger(value, `obstacles[${index}].${label}`);
    ({ minX, maxX, minY, maxY } = input);
  }
  if (minX >= maxX || minY >= maxY) throw new RangeError('obstacle bounds must have positive area');
  return { id, minX, maxX, minY, maxY };
}

function validateObstacle(obstacle: BattleObstacle, arena: ArenaBounds): void {
  assertTextId(obstacle.id, 'obstacle.id');
  for (const [label, value] of [
    ['minX', obstacle.minX],
    ['maxX', obstacle.maxX],
    ['minY', obstacle.minY],
    ['maxY', obstacle.maxY],
  ] as const) assertGameInteger(value, `obstacle.${label}`);
  if (obstacle.minX >= obstacle.maxX || obstacle.minY >= obstacle.maxY) {
    throw new RangeError('obstacle bounds must have positive area');
  }
  if (
    obstacle.minX < arena.minX ||
    obstacle.maxX > arena.maxX ||
    obstacle.minY < arena.minY ||
    obstacle.maxY > arena.maxY
  ) {
    throw new RangeError('obstacle must be inside arena');
  }
}

function validateWeapon(weapon: BattleWeaponSpec): void {
  if (!weapon || typeof weapon !== 'object') throw new RangeError('actor weapon is required');
  for (const [label, value] of [
    ['range', weapon.range],
    ['aimTolerance', weapon.aimTolerance],
  ] as const) {
    if (value !== undefined) assertNonNegativeInteger(value, `weapon.${label}`);
  }
}

function validateActorConfig(actor: BattleActorConfig): void {
  assertId(actor.id, 'actor.id');
  if (!Array.isArray(actor.rules)) throw new RangeError(`actor ${actor.id} rules must be an array`);
  // The eager call here gives createBattleState a fail-fast contract and keeps
  // every actor's card order canonical before the first simulation tick.
  validateRuleSet(actor.rules);
  validateWeapon(actor.weapon);
  for (const [label, value] of [
    ['moveSpeed', actor.moveSpeed],
    ['turnSpeed', actor.turnSpeed],
    ['turretTurnSpeed', actor.turretTurnSpeed],
    ['sensorRange', actor.sensorRange],
    ['nearRange', actor.nearRange],
    ['aimTolerance', actor.aimTolerance],
    ['strafeSpeed', actor.strafeSpeed],
    ['exploreSpeed', actor.exploreSpeed],
    ['projectileWarningLookaheadTicks', actor.projectileWarningLookaheadTicks],
  ] as const) {
    if (value !== undefined) assertNonNegativeInteger(value, `actor.${label}`);
  }
  if (actor.cooler) {
    assertNonNegativeInteger(actor.cooler.amount, `actor ${actor.id} cooler amount`);
    if (actor.cooler.amount <= 0) throw new RangeError(`actor ${actor.id} cooler amount must be positive`);
    const cooldown = actor.cooler.cooldownTicks ?? DEFAULT_COOLING_COOLDOWN_TICKS;
    assertNonNegativeInteger(cooldown, `actor ${actor.id} cooler cooldown`);
  }
}

function normalizedWeapon(weapon: BattleWeaponSpec): BattleWeaponSpec {
  // Keep a fresh object in canonical state so callers cannot mutate a state by
  // retaining the object they used to create it.
  return { ...weapon };
}

function normalizedRobot(input: BattleRobotInput): BattleRobot {
  const heading = input.heading ?? 0;
  const turretHeading = input.turretHeading ?? heading;
  const vx = input.vx ?? 0;
  const vy = input.vy ?? 0;
  const speed = input.speed ?? 0;
  const coolingCooldownRemaining = input.coolingCooldownRemaining ?? 0;
  const actionSwitchWindowStartTick = input.actionSwitchWindowStartTick ?? 0;
  const actionSwitchCount = input.actionSwitchCount ?? 0;
  const lastActionKey = input.lastActionKey ?? null;
  const lastRuleEvaluationTick = input.lastRuleEvaluationTick ?? null;
  const selectedRuleId = input.selectedRuleId ?? null;
  const actionStartId = input.actionStartId ?? input.runningAction?.actionStartId ?? null;
  for (const [label, value] of [
    ['vx', vx],
    ['vy', vy],
    ['speed', speed],
    ['coolingCooldownRemaining', coolingCooldownRemaining],
    ['actionSwitchWindowStartTick', actionSwitchWindowStartTick],
    ['actionSwitchCount', actionSwitchCount],
  ] as const) assertGameInteger(value, `combatant ${input.id}.${label}`);
  assertHeading(heading, `combatant ${input.id}.heading`);
  assertHeading(turretHeading, `combatant ${input.id}.turretHeading`);
  if (speed < 0 || coolingCooldownRemaining < 0 || actionSwitchCount < 0) {
    throw new RangeError(`combatant ${input.id} motion/action values must be non-negative`);
  }
  return {
    ...input,
    heading,
    turretHeading,
    vx,
    vy,
    speed,
    coolingCooldownRemaining,
    runningAction: input.runningAction ? { ...input.runningAction } : null,
    actionStartId,
    actionSwitchWindowStartTick,
    actionSwitchCount,
    lastActionKey,
    lastRuleEvaluationTick,
    selectedRuleId,
  };
}

function validateBattleRobot(robot: BattleRobot, arena: ArenaBounds): void {
  for (const [label, value] of [
    ['vx', robot.vx],
    ['vy', robot.vy],
    ['speed', robot.speed],
    ['coolingCooldownRemaining', robot.coolingCooldownRemaining],
    ['actionSwitchWindowStartTick', robot.actionSwitchWindowStartTick],
    ['actionSwitchCount', robot.actionSwitchCount],
  ] as const) assertGameInteger(value, `combatant ${robot.id}.${label}`);
  assertHeading(robot.heading, `combatant ${robot.id}.heading`);
  assertHeading(robot.turretHeading, `combatant ${robot.id}.turretHeading`);
  if (robot.speed < 0 || robot.coolingCooldownRemaining < 0 || robot.actionSwitchCount < 0) {
    throw new RangeError(`combatant ${robot.id} motion/action values must be non-negative`);
  }
  if (robot.runningAction) {
    if (robot.actionStartId === null || robot.actionStartId < 0) {
      throw new RangeError(`combatant ${robot.id} running action must have an actionStartId`);
    }
    if (robot.runningAction.completesAtTick < robot.runningAction.startedTick) {
      throw new RangeError(`combatant ${robot.id} action completion is invalid`);
    }
    if (robot.runningAction.actionStartId !== undefined && robot.runningAction.actionStartId !== robot.actionStartId) {
      throw new RangeError(`combatant ${robot.id} action start IDs do not match`);
    }
    for (const [label, value] of [
      ['startedTick', robot.runningAction.startedTick],
      ['completesAtTick', robot.runningAction.completesAtTick],
      ['lastTick', robot.runningAction.lastTick],
    ] as const) assertNonNegativeInteger(value, `combatant ${robot.id} action ${label}`);
    if (robot.runningAction.lastTick < robot.runningAction.startedTick) {
      throw new RangeError(`combatant ${robot.id} action last tick is invalid`);
    }
    if (robot.runningAction.actionStartId !== undefined) {
      assertNonNegativeInteger(robot.runningAction.actionStartId, `combatant ${robot.id} actionStartId`);
    }
  } else if (robot.actionStartId !== null) {
    // A completed action may leave its ID in the event stream but not on the
    // robot.  The canonical live state uses null while idle.
    throw new RangeError(`combatant ${robot.id} idle actionStartId must be null`);
  }
  // Reuse combat's positional/health validation through a structural view.
  if (robot.x < arena.minX + robot.radius || robot.x > arena.maxX - robot.radius) {
    throw new RangeError(`combatant ${robot.id} is outside arena x bounds`);
  }
  if (robot.y < arena.minY + robot.radius || robot.y > arena.maxY - robot.radius) {
    throw new RangeError(`combatant ${robot.id} is outside arena y bounds`);
  }
}

function actorForId(state: BattleState, actorId: number): BattleActorConfig {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new RangeError(`actor ${actorId} does not exist`);
  return actor;
}

function robotForId(state: BattleState, actorId: number): BattleRobot {
  const robot = state.combatants.find((candidate) => candidate.id === actorId);
  if (!robot) throw new RangeError(`combatant ${actorId} does not exist`);
  return robot;
}

function targetForId(state: BattleState, actorId: number): BattleRobot | null {
  return state.combatants.find((candidate) => candidate.id !== actorId && candidate.active) ?? null;
}

function asMotionBody(robot: BattleRobot): MotionBody {
  return robot;
}

function segmentIntersectsObstacle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacle: BattleObstacle,
): boolean {
  // Liang-Barsky expressed with integer arithmetic.  `t` is represented as a
  // rational numerator/denominator, so no platform-specific floating point is
  // involved in the line-of-sight decision.
  const dx = BigInt(x2) - BigInt(x1);
  const dy = BigInt(y2) - BigInt(y1);
  const minX = BigInt(obstacle.minX);
  const maxX = BigInt(obstacle.maxX);
  const minY = BigInt(obstacle.minY);
  const maxY = BigInt(obstacle.maxY);
  if (x1 > obstacle.minX && x1 < obstacle.maxX && y1 > obstacle.minY && y1 < obstacle.maxY) return true;
  if (x2 > obstacle.minX && x2 < obstacle.maxX && y2 > obstacle.minY && y2 < obstacle.maxY) return true;

  let t0n = 0n;
  let t0d = 1n;
  let t1n = 1n;
  let t1d = 1n;
  const update = (p: bigint, q: bigint): boolean => {
    if (p === 0n) return q >= 0n;
    if (p < 0n) {
      // Entering edge: q/p (both signs are negative for a segment moving
      // toward the edge) raises the lower bound.
      const n = -q;
      const d = -p;
      if (n * t0d > t0n * d) {
        t0n = n;
        t0d = d;
      }
    } else {
      // Exiting edge: q/p lowers the upper bound.
      const n = q;
      const d = p;
      if (n * t1d < t1n * d) {
        t1n = n;
        t1d = d;
      }
    }
    return t0n * t1d <= t1n * t0d;
  };
  if (!update(-dx, BigInt(x1) - minX)) return false;
  if (!update(dx, maxX - BigInt(x1))) return false;
  if (!update(-dy, BigInt(y1) - minY)) return false;
  if (!update(dy, maxY - BigInt(y1))) return false;
  return true;
}

/** Returns true when a solid obstacle crosses the centre-to-centre sight line. */
export function hasLineOfSight(state: BattleState, observerId: number, targetId: number): boolean {
  const observer = robotForId(state, observerId);
  const target = robotForId(state, targetId);
  return !state.obstacles.some((obstacle) => segmentIntersectsObstacle(observer.x, observer.y, target.x, target.y, obstacle));
}

function projectileIsIncoming(robot: BattleRobot, projectile: CombatState['projectiles'][number], lookahead: number): boolean {
  if (!projectile.active || projectile.ownerId === robot.id) return false;
  const radius = projectile.radius + robot.radius;
  const radiusSquared = BigInt(radius) * BigInt(radius);
  // Test every integer tick in the bounded warning window.  This catches a
  // fast projectile crossing the robot between two sensor samples.
  const horizon = Math.min(lookahead, projectile.remainingTicks);
  for (let index = 0; index <= horizon; index += 1) {
    const x = BigInt(projectile.x) + BigInt(projectile.vx) * BigInt(index);
    const y = BigInt(projectile.y) + BigInt(projectile.vy) * BigInt(index);
    const dx = x - BigInt(robot.x);
    const dy = y - BigInt(robot.y);
    if (dx * dx + dy * dy <= radiusSquared) return true;
  }
  return false;
}

/** Returns a stable incoming-projectile warning for the actor's current tick. */
export function hasProjectileWarning(state: BattleState, actorId: number): boolean {
  const robot = robotForId(state, actorId);
  const actor = actorForId(state, actorId);
  const lookahead = actor.projectileWarningLookaheadTicks ?? DEFAULT_PROJECTILE_WARNING_LOOKAHEAD_TICKS;
  return state.projectiles.some((projectile) => projectileIsIncoming(robot, projectile, lookahead));
}

/** Computes all boolean facts consumed by a rule card at one snapshot. */
export function readBattleFacts(state: BattleState, actorId: number): RuleFacts {
  const robot = robotForId(state, actorId);
  const actor = actorForId(state, actorId);
  const target = targetForId(state, actorId);
  const sensorRange = actor.sensorRange ?? actor.weapon.range ?? DEFAULT_SENSOR_RANGE;
  const nearRange = actor.nearRange ?? Math.min(sensorRange, DEFAULT_NEAR_RANGE);
  const targetReading = target
    ? readSensor(asMotionBody(robot), asMotionBody(target), sensorRange, !hasLineOfSight(state, actorId, target.id))
    : null;
  const lineOfSight = target ? hasLineOfSight(state, actorId, target.id) : false;
  const boundaryRisk = forecastBoundaryRisk(asMotionBody(robot), state.arena, BATTLE_RULE_EVALUATION_INTERVAL_TICKS);
  const distanceSquared = target ? squaredDistance(robot, target) : null;
  const weaponRange = actor.weapon.range ?? sensorRange;
  const weaponRangeSquared = BigInt(weaponRange) * BigInt(weaponRange);
  return {
    tick: state.tick,
    enemyVisible: targetReading?.visible ?? false,
    enemyNear: distanceSquared !== null && distanceSquared <= BigInt(nearRange) * BigInt(nearRange),
    enemyInRange: distanceSquared !== null && distanceSquared <= weaponRangeSquared,
    projectileWarning: hasProjectileWarning(state, actorId),
    ammoAvailable: robot.ammo >= actor.weapon.ammoCost,
    heatHigh: robot.heat >= 70 || robot.overheatRemaining > 0,
    boundaryDanger: boundaryRisk.any,
    lineOfSight,
  };
}

function aimToleranceFor(actor: BattleActorConfig): number {
  return actor.weapon.aimTolerance ?? actor.aimTolerance ?? DEFAULT_AIM_TOLERANCE;
}

function targetBearing(state: BattleState, actorId: number): number | null {
  const robot = robotForId(state, actorId);
  const target = targetForId(state, actorId);
  return target ? headingToPoint(asMotionBody(robot), target) : null;
}

function actionIdOf(ruleOrAction: RuleCard | ActionId): ActionId {
  return typeof ruleOrAction === 'string' ? ruleOrAction : ruleOrAction.action;
}

export interface BattleActionAssessmentOptions {
  /** Evaluate timers after the current tick's decrement, before stepCombat. */
  readonly timersAfterTick?: boolean;
  /** Override the robot/target snapshot for final fire verification. */
  readonly state?: BattleState;
}

/**
 * Checks whether an action can start at this snapshot.  For fire this is the
 * shared final gate: range, LOS, aim, ammo, heat, cooldown, and overheat are
 * all checked together.  `timersAfterTick` is used by stepBattle because the
 * underlying combat executor decrements its timers before accepting commands.
 */
export function assessBattleAction(
  state: BattleState,
  actorId: number,
  ruleOrAction: RuleCard | ActionId,
  options: BattleActionAssessmentOptions = {},
): BattleActionAvailability {
  const sourceState = options.state ?? state;
  const robot = robotForId(sourceState, actorId);
  const actor = actorForId(sourceState, actorId);
  const target = targetForId(sourceState, actorId);
  const action = actionIdOf(ruleOrAction);
  if (!robot.active) return { startable: false, reason: 'inactive', targetId: target?.id ?? null };

  if (action === 'face-target' || action === 'fire-pulse' || action === 'retreat') {
    if (!target) return { startable: false, reason: 'target-missing', targetId: null };
  }
  if (action === 'face-target') {
    const bearing = targetBearing(sourceState, actorId);
    if (bearing === null) return { startable: false, reason: 'target-missing', targetId: null };
    const delta = Math.abs(((bearing - robot.turretHeading + 128) % 256 + 256) % 256 - 128);
    return delta <= aimToleranceFor(actor)
      ? { startable: false, reason: 'already-aimed', targetId: target?.id ?? null }
      : { startable: true, reason: 'available', targetId: target?.id ?? null };
  }
  if (action === 'fire-pulse') {
    if (!target) return { startable: false, reason: 'target-missing', targetId: null };
    const targetDistance = squaredDistance(robot, target);
    const range = actor.weapon.range ?? actor.sensorRange ?? DEFAULT_SENSOR_RANGE;
    if (targetDistance > BigInt(range) * BigInt(range)) {
      return { startable: false, reason: 'range', targetId: target.id };
    }
    if (!hasLineOfSight(sourceState, actorId, target.id)) {
      return { startable: false, reason: 'line-of-sight', targetId: target.id };
    }
    const bearing = headingToPoint(asMotionBody(robot), target);
    const delta = Math.abs(((bearing - robot.turretHeading + 128) % 256 + 256) % 256 - 128);
    if (delta > aimToleranceFor(actor)) return { startable: false, reason: 'aim', targetId: target.id };
    if (robot.ammo < actor.weapon.ammoCost) return { startable: false, reason: 'ammo-empty', targetId: target.id };
    const fireCooldown = options.timersAfterTick ? Math.max(0, robot.fireCooldownRemaining - 1) : robot.fireCooldownRemaining;
    const overheat = options.timersAfterTick ? Math.max(0, robot.overheatRemaining - 1) : robot.overheatRemaining;
    if (fireCooldown > 0) return { startable: false, reason: 'cooldown', targetId: target.id };
    if (overheat > 0) return { startable: false, reason: 'overheated', targetId: target.id };
    if (robot.heat + actor.weapon.heat > MAX_HEAT) {
      return { startable: false, reason: 'heat-limit', targetId: target.id };
    }
    return { startable: true, reason: 'available', targetId: target.id };
  }
  if (action === 'cool') {
    if (!actor.cooler) return { startable: false, reason: 'cooler-missing', targetId: target?.id ?? null };
    if (robot.heat <= 0) return { startable: false, reason: 'no-heat', targetId: target?.id ?? null };
    const cooldown = options.timersAfterTick ? Math.max(0, robot.coolingCooldownRemaining - 1) : robot.coolingCooldownRemaining;
    if (cooldown > 0) return { startable: false, reason: 'cooler-cooldown', targetId: target?.id ?? null };
    return { startable: true, reason: 'available', targetId: target?.id ?? null };
  }
  if (
    action === 'retreat' ||
    action === 'strafe' ||
    action === 'explore' ||
    action === 'stop'
  ) return { startable: true, reason: 'available', targetId: target?.id ?? null };
  return { startable: false, reason: 'unknown-action', targetId: target?.id ?? null };
}

export function canStartBattleAction(
  state: BattleState,
  actorId: number,
  ruleOrAction: RuleCard | ActionId,
  options: BattleActionAssessmentOptions = {},
): boolean {
  return assessBattleAction(state, actorId, ruleOrAction, options).startable;
}

/** Alias used by callers that prefer the verb used in the rule contract. */
export const isBattleActionStartable = canStartBattleAction;

export function validateBattleState(state: BattleState): void {
  assertGameInteger(state.tick, 'state.tick');
  assertGameInteger(state.maxTicks, 'state.maxTicks');
  if (state.tick < 0 || state.maxTicks < 1 || state.maxTicks > MAX_COMBAT_TICKS || state.tick > state.maxTicks) {
    throw new RangeError('state tick is outside the battle range');
  }
  validateBounds(state.arena);
  if (state.combatants.length !== 2) throw new RangeError('battle must contain exactly two combatants');
  const ids = new Set<number>();
  for (const robot of state.combatants) {
    if (ids.has(robot.id)) throw new RangeError('battle combatant IDs must be unique');
    ids.add(robot.id);
    validateBattleRobot(robot, state.arena);
  }
  if (state.actors.length !== state.combatants.length) throw new RangeError('one actor config per combatant is required');
  const actorIds = new Set<number>();
  for (const actor of state.actors) {
    validateActorConfig(actor);
    if (actorIds.has(actor.id) || !ids.has(actor.id)) throw new RangeError('actor IDs must match combatants exactly');
    actorIds.add(actor.id);
  }
  if (actorIds.size !== ids.size) throw new RangeError('actor IDs must match combatants exactly');
  const obstacleIds = new Set<string>();
  for (const obstacle of state.obstacles) {
    validateObstacle(obstacle, state.arena);
    if (obstacleIds.has(obstacle.id)) throw new RangeError('obstacle IDs must be unique');
    obstacleIds.add(obstacle.id);
  }
  assertNonNegativeInteger(state.nextActionStartId, 'nextActionStartId');
  if (state.actionEvents.length > MAX_BATTLE_ACTION_EVENTS) throw new RangeError('battle action log exceeds limit');
  if (state.selectionTrace.length > MAX_BATTLE_SELECTION_TRACE) throw new RangeError('battle selection trace exceeds limit');
  if (state.simulationVersion !== CURRENT_SIMULATION_VERSION) throw new RangeError('unsupported simulation version');
  if (state.contentVersion !== undefined) assertTextId(state.contentVersion, 'contentVersion');
}

/** Creates a canonical battle state while retaining CombatState's existing limits and types. */
export function createBattleState(input: BattleStateInput): BattleState {
  if (input.simulationVersion !== undefined && input.simulationVersion !== CURRENT_SIMULATION_VERSION) {
    throw new RangeError(`unsupported simulation version: ${input.simulationVersion}`);
  }
  if (!Array.isArray(input.actors) || input.actors.length !== input.combatants.length) {
    throw new RangeError('one actor config per combatant is required');
  }
  const actors = [...input.actors]
    .map((actor: BattleActorConfig): BattleActorConfig => ({
      ...actor,
      rules: actor.rules.map((rule: RuleCard): RuleCard => ({
        ...rule,
        conditions: rule.conditions.map((condition: RuleCard['conditions'][number]) => ({ ...condition })),
      })),
      weapon: normalizedWeapon(actor.weapon),
      cooler: actor.cooler ? { ...actor.cooler } : undefined,
    }))
    .sort((left, right) => left.id - right.id);
  actors.forEach(validateActorConfig);
  actors.forEach((actor) => validateRuleSet(actor.rules));
  const robots = [...input.combatants].map(normalizedRobot).sort((left, right) => left.id - right.id);
  const baseCombat = createCombatState({
    arena: input.arena,
    maxTicks: input.maxTicks,
    tick: input.tick,
    combatants: robots,
    projectiles: input.projectiles,
    nextProjectileId: input.nextProjectileId,
  });
  const obstacles = (input.obstacles ?? []).map(normalizeObstacle);
  const state: BattleState = {
    ...baseCombat,
    combatants: baseCombat.combatants.map((combatant) => robots.find((robot) => robot.id === combatant.id) as BattleRobot),
    actors,
    obstacles,
    actionEvents: [],
    selectionTrace: [],
    nextActionStartId: input.nextActionStartId ?? 0,
    simulationVersion: CURRENT_SIMULATION_VERSION,
    ...(input.contentVersion === undefined ? {} : { contentVersion: input.contentVersion }),
  };
  validateBattleState(state);
  return state;
}

/** Small helper for engines/tests that need a structural BattleState clone. */
export function withBattleCombatants(state: BattleState, combatants: readonly BattleRobot[]): BattleState {
  const next = { ...state, combatants: [...combatants] };
  validateBattleState(next);
  return next;
}

export { ACTION_DURATION_TICKS };

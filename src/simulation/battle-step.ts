import { addGameIntegers } from './fixed-point';
import { resolveCircleCollision } from './geometry';
import { setHeadingVelocity, stepBody, turnHeading, velocityForHeading } from './motion';
import { headingToPoint } from './sensor';
import {
  assessBattleAction,
  BATTLE_RULE_EVALUATION_INTERVAL_TICKS,
  BATTLE_TICKS_PER_SECOND,
  DEFAULT_MOVE_SPEED,
  DEFAULT_TURN_SPEED,
  MAX_BATTLE_ACTION_EVENTS,
  MAX_BATTLE_SELECTION_TRACE,
  readBattleFacts,
  validateBattleState,
  type BattleActionEvent,
  type BattleActionEventType,
  type BattleActionAvailability,
  type BattleActorConfig,
  type BattleRobot,
  type BattleRuleEvaluation,
  type BattleSelectionTrace,
  type BattleState,
} from './battle-state';
import type { CombatCommand } from './combat';
import {
  ACTION_DURATION_TICKS,
  evaluateRuleCard,
  MAX_ACTION_SWITCHES_PER_SECOND,
  type ActionId,
  type RuleCard,
  type RuleFacts,
  type RunningAction,
} from './rules';

interface SelectedRule {
  readonly rule: RuleCard | null;
  readonly facts: RuleFacts;
  readonly trace: BattleSelectionTrace;
}

interface StartedAction {
  readonly actorId: number;
  readonly rule: RuleCard;
  readonly actionStartId: number;
}

function actorForId(state: BattleState, actorId: number): BattleActorConfig {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new RangeError(`actor ${actorId} does not exist`);
  return actor;
}

function targetForId(state: BattleState, actorId: number): BattleRobot | null {
  return state.combatants.find((candidate) => candidate.id !== actorId && candidate.active) ?? null;
}

function appendActionEvent(events: BattleActionEvent[], event: BattleActionEvent): void {
  if (events.length >= MAX_BATTLE_ACTION_EVENTS) throw new RangeError('battle action log exceeds limit');
  events.push(event);
}

function appendSelectionTrace(trace: BattleSelectionTrace[], selection: BattleSelectionTrace): void {
  if (trace.length >= MAX_BATTLE_SELECTION_TRACE) throw new RangeError('battle selection trace exceeds limit');
  trace.push(selection);
}

function actionKey(rule: RuleCard): string {
  return `${rule.id}:${rule.action}`;
}

function normalizeHeadingDelta(from: number, to: number): number {
  return ((to - from + 128) % 256 + 256) % 256 - 128;
}

function targetBearing(state: BattleState, actorId: number): number | null {
  const robot = state.combatants.find((candidate) => candidate.id === actorId);
  const target = targetForId(state, actorId);
  if (!robot || !target) return null;
  return headingToPoint(robot, target);
}

function selectionForActor(
  state: BattleState,
  robot: BattleRobot,
  actor: BattleActorConfig,
  tick: number,
  actionEvents: BattleActionEvent[],
): SelectedRule {
  const facts = { ...readBattleFacts(state, robot.id), tick };
  const evaluations: BattleRuleEvaluation[] = [];
  let selectedRule: RuleCard | null = null;
  let hasMatched = false;
  let hasUnavailable = false;
  for (const rule of actor.rules) {
    const conditionEvaluation = evaluateRuleCard(rule, facts);
    if (!conditionEvaluation.matched) {
      evaluations.push({ ...conditionEvaluation, selection: 'condition-failed' });
      continue;
    }
    hasMatched = true;
    // A running action may continue even if its one-shot start gate would no
    // longer pass. This is the distinction between action continuation and a
    // fresh action start.
    if (robot.runningAction?.ruleId === rule.id) {
      evaluations.push({ ...conditionEvaluation, startable: true, selection: 'continuation' });
      selectedRule = rule;
      break;
    }
    const availability = assessBattleAction(state, robot.id, rule);
    if (!availability.startable) {
      hasUnavailable = true;
      evaluations.push({
        ...conditionEvaluation,
        startable: false,
        availabilityReason: availability.reason,
        selection: 'preselection-skip',
      });
      appendActionEvent(actionEvents, {
        type: 'preselectionskip',
        phase: 'preselection',
        tick,
        actorId: robot.id,
        ruleId: rule.id,
        action: rule.action,
        reason: availability.reason,
      });
      continue;
    }
    evaluations.push({ ...conditionEvaluation, startable: true, selection: 'selected' });
    selectedRule = rule;
    break;
  }

  const reason = selectedRule ? 'selected' : hasMatched && hasUnavailable ? 'all-unavailable' : 'no-match';
  return {
    rule: selectedRule,
    facts,
    trace: {
      tick,
      actorId: robot.id,
      facts,
      evaluations,
      selectedRuleId: selectedRule?.id ?? null,
      reason,
    },
  };
}

function canSwitch(robot: BattleRobot, rule: RuleCard, tick: number): { allowed: boolean; robot: BattleRobot } {
  let windowStartTick = robot.actionSwitchWindowStartTick;
  let switchCount = robot.actionSwitchCount;
  let lastActionKey = robot.lastActionKey;
  if (tick - windowStartTick >= BATTLE_TICKS_PER_SECOND) {
    windowStartTick = tick;
    switchCount = 0;
    lastActionKey = null;
  }
  const nextActionKey = actionKey(rule);
  if (lastActionKey !== null && lastActionKey !== nextActionKey) {
    if (switchCount >= MAX_ACTION_SWITCHES_PER_SECOND) {
      return {
        allowed: false,
        robot: {
          ...robot,
          actionSwitchWindowStartTick: windowStartTick,
          actionSwitchCount: switchCount,
          lastActionKey,
        },
      };
    }
    switchCount += 1;
  }
  return {
    allowed: true,
    robot: {
      ...robot,
      actionSwitchWindowStartTick: windowStartTick,
      actionSwitchCount: switchCount,
      lastActionKey: nextActionKey,
    },
  };
}

function startAction(
  robot: BattleRobot,
  rule: RuleCard,
  tick: number,
  actionStartId: number,
): BattleRobot {
  const duration = rule.durationTicks ?? ACTION_DURATION_TICKS[rule.action];
  const runningAction: RunningAction = {
    ruleId: rule.id,
    priority: rule.priority,
    action: rule.action,
    startedTick: tick,
    completesAtTick: addGameIntegers(tick, duration, 'action completion tick'),
    lastTick: tick,
    actionStartId,
  };
  return { ...robot, runningAction, actionStartId };
}

function withRunningTick(robot: BattleRobot, tick: number): BattleRobot {
  return robot.runningAction
    ? { ...robot, runningAction: { ...robot.runningAction, lastTick: tick } }
    : robot;
}

function startOrInterrupt(
  robot: BattleRobot,
  selected: RuleCard,
  tick: number,
  nextActionStartId: number,
  actionEvents: BattleActionEvent[],
): { robot: BattleRobot; nextActionStartId: number; started: StartedAction | null } {
  const guard = canSwitch(robot, selected, tick);
  if (!guard.allowed) {
    appendActionEvent(actionEvents, {
      type: 'action-held',
      phase: 'execution',
      tick,
      actorId: robot.id,
      ruleId: robot.runningAction?.ruleId ?? selected.id,
      action: robot.runningAction?.action ?? selected.action,
      actionStartId: robot.actionStartId ?? undefined,
      reason: 'switch-rate-limit',
    });
    return { robot: withRunningTick(guard.robot, tick), nextActionStartId, started: null };
  }
  const actionStartId = nextActionStartId;
  const startedRobot = startAction(guard.robot, selected, tick, actionStartId);
  appendActionEvent(actionEvents, {
    type: robot.runningAction ? 'action-interrupt' : 'action-start',
    phase: 'execution',
    tick,
    actorId: robot.id,
    ruleId: selected.id,
    action: selected.action,
    actionStartId,
    previousActionStartId: robot.actionStartId ?? undefined,
    reason: robot.runningAction ? 'higher-priority-interrupt' : 'new-selection',
  });
  return {
    robot: startedRobot,
    nextActionStartId: addGameIntegers(nextActionStartId, 1, 'next action start ID'),
    started: { actorId: robot.id, rule: selected, actionStartId },
  };
}

function prepareActionSelection(
  state: BattleState,
  tick: number,
  robots: BattleRobot[],
  actionEvents: BattleActionEvent[],
  selectionTrace: BattleSelectionTrace[],
  nextActionStartId: number,
): { robots: BattleRobot[]; starts: StartedAction[]; nextActionStartId: number } {
  const starts: StartedAction[] = [];
  let nextId = nextActionStartId;
  const actorConfigs = [...state.actors].sort((left, right) => left.id - right.id);
  for (const actor of actorConfigs) {
    const index = robots.findIndex((candidate) => candidate.id === actor.id);
    if (index < 0) continue;
    let robot = robots[index];
    if (robot.runningAction && tick >= robot.runningAction.completesAtTick) {
      appendActionEvent(actionEvents, {
        type: 'action-complete',
        phase: 'execution',
        tick,
        actorId: robot.id,
        ruleId: robot.runningAction.ruleId,
        action: robot.runningAction.action,
        actionStartId: robot.actionStartId ?? undefined,
        reason: 'duration-elapsed',
      });
      robot = { ...robot, runningAction: null, actionStartId: null };
    }

    const lastSelectionTick = robot.lastRuleEvaluationTick;
    const shouldEvaluate =
      lastSelectionTick === null || tick - lastSelectionTick >= BATTLE_RULE_EVALUATION_INTERVAL_TICKS;
    let selected: RuleCard | null = null;
    if (shouldEvaluate) {
      // Sensors are sampled against the same pre-movement snapshot for both
      // actors. Movement and final fire verification happen after this pass.
      const selection = selectionForActor({ ...state, combatants: robots }, robot, actor, tick, actionEvents);
      appendSelectionTrace(selectionTrace, selection.trace);
      selected = selection.rule;
      robot = { ...robot, lastRuleEvaluationTick: tick, selectedRuleId: selected?.id ?? null };
    }

    if (!selected) {
      robots[index] = withRunningTick(robot, tick);
      continue;
    }
    if (robot.runningAction && selected.id === robot.runningAction.ruleId) {
      appendActionEvent(actionEvents, {
        type: 'action-continue',
        phase: 'execution',
        tick,
        actorId: robot.id,
        ruleId: robot.runningAction.ruleId,
        action: robot.runningAction.action,
        actionStartId: robot.actionStartId ?? undefined,
        reason: 'same-rule',
      });
      robots[index] = withRunningTick(robot, tick);
      continue;
    }
    if (robot.runningAction && selected.priority >= robot.runningAction.priority) {
      appendActionEvent(actionEvents, {
        type: 'action-held',
        phase: 'execution',
        tick,
        actorId: robot.id,
        ruleId: robot.runningAction.ruleId,
        action: robot.runningAction.action,
        actionStartId: robot.actionStartId ?? undefined,
        reason: 'lower-priority-held',
      });
      robots[index] = withRunningTick(robot, tick);
      continue;
    }
    const started = startOrInterrupt(robot, selected, tick, nextId, actionEvents);
    robots[index] = started.robot;
    nextId = started.nextActionStartId;
    if (started.started) starts.push(started.started);
  }
  return { robots, starts, nextActionStartId: nextId };
}

function turnAndMove(
  robot: BattleRobot,
  actor: BattleActorConfig,
  state: BattleState,
  action: ActionId,
): BattleRobot {
  const target = targetForId(state, robot.id);
  const turnSpeed = actor.turnSpeed ?? DEFAULT_TURN_SPEED;
  const moveSpeed = actor.moveSpeed ?? DEFAULT_MOVE_SPEED;
  if (action === 'stop') return { ...robot, speed: 0, vx: 0, vy: 0 };

  if (action === 'face-target' && target) {
    const bearing = headingToPoint(robot, target);
    const heading = turnHeading(robot.heading, bearing, turnSpeed);
    const turretHeading = turnHeading(robot.turretHeading, bearing, actor.turretTurnSpeed ?? turnSpeed);
    return { ...robot, heading, turretHeading, speed: 0, vx: 0, vy: 0 };
  }

  if (action === 'retreat' && target) {
    const away = headingToPoint(target, robot);
    const heading = turnHeading(robot.heading, away, turnSpeed);
    return setHeadingVelocity(robot, heading, moveSpeed) as BattleRobot;
  }

  if (action === 'strafe') {
    const incoming = state.projectiles
      .filter((projectile) => projectile.active && projectile.ownerId !== robot.id)
      .sort((left, right) => {
        const distance = (candidate: typeof left) => {
          const dx = BigInt(candidate.x) - BigInt(robot.x);
          const dy = BigInt(candidate.y) - BigInt(robot.y);
          return dx * dx + dy * dy;
        };
        const leftDistance = distance(left);
        const rightDistance = distance(right);
        return leftDistance === rightDistance ? left.id - right.id : leftDistance < rightDistance ? -1 : 1;
      })[0];
    const targetDirection = target ? headingToPoint(robot, target) : robot.heading;
    // A projectile's left-normal is deterministic and gives a vertical move
    // for a horizontal incoming projectile. With no projectile, strafe around
    // the visible target so the action remains useful in an opening tick.
    const desired = incoming
      ? headingToPoint(robot, {
          x: addGameIntegers(robot.x, -incoming.vy, 'strafe x'),
          y: addGameIntegers(robot.y, incoming.vx, 'strafe y'),
        })
      : (targetDirection + 64) % 256;
    const heading = turnHeading(robot.heading, desired, turnSpeed);
    return setHeadingVelocity(robot, heading, actor.strafeSpeed ?? moveSpeed) as BattleRobot;
  }

  if (action === 'explore') {
    if (robot.speed === 0 && robot.vx === 0 && robot.vy === 0) {
      const speed = actor.exploreSpeed ?? Math.max(1, Math.floor(moveSpeed / 2));
      return setHeadingVelocity(robot, robot.heading, speed) as BattleRobot;
    }
    return robot;
  }

  return robot;
}

function advanceMotion(state: BattleState, robots: BattleRobot[]): BattleRobot[] {
  let moved = robots.map((robot) => {
    const actor = actorForId(state, robot.id);
    if (!robot.active || !robot.runningAction) {
      return stepBody({ ...robot, speed: 0, vx: 0, vy: 0 }, state.arena) as BattleRobot;
    }
    const commanded = turnAndMove(robot, actor, state, robot.runningAction.action);
    const stepped = stepBody(commanded, state.arena) as BattleRobot;
    // A boundary clamp removes the velocity component that would leave the
    // arena. When both components are gone, clear the scalar speed too so an
    // explore action can deliberately start moving again on its next tick.
    return stepped.vx === 0 && stepped.vy === 0 ? { ...stepped, speed: 0 } : stepped;
  });

  // Pair resolution is always by ascending IDs, independent of the input
  // array order. The action scheduler already canonicalizes IDs in state.
  for (let leftIndex = 0; leftIndex < moved.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < moved.length; rightIndex += 1) {
      const left = moved[leftIndex];
      const right = moved[rightIndex];
      const resolution = resolveCircleCollision(left, right);
      const resolvedById = new Map(resolution.bodies.map((body) => [body.id, body]));
      moved = moved.map((robot) => {
        const resolved = resolvedById.get(robot.id);
        if (!resolved) return robot;
        const speed = resolved.vx === 0 && resolved.vy === 0 ? 0 : robot.speed;
        return { ...robot, x: resolved.x, y: resolved.y, vx: resolved.vx, vy: resolved.vy, speed };
      });
    }
  }
  return moved;
}

function finalCommands(
  state: BattleState,
  robots: BattleRobot[],
  starts: readonly StartedAction[],
  actionEvents: BattleActionEvent[],
): { commands: CombatCommand[]; coolingIds: ReadonlySet<number> } {
  const provisional: BattleState = { ...state, combatants: robots };
  const commands: CombatCommand[] = [];
  const coolingIds = new Set<number>();
  for (const started of starts) {
    const robot = robots.find((candidate) => candidate.id === started.actorId);
    if (!robot) continue;
    const actor = actorForId(state, started.actorId);
    // Movement actions have already started and are intentionally allowed to
    // complete even when their resulting position changes the next sensor
    // snapshot. Fire and cooling are one-shot resource requests, so they each
    // receive a final gate immediately before the CombatState command.
    const availability: BattleActionAvailability | null =
      started.rule.action === 'fire-pulse' || started.rule.action === 'cool'
        ? assessBattleAction(provisional, started.actorId, started.rule, {
            // Fire timers are decremented inside stepCombat. The cooling timer
            // already lives in the pre-decremented BattleRobot snapshot.
            timersAfterTick: started.rule.action === 'fire-pulse',
            state: provisional,
          })
        : null;
    if (availability && !availability.startable) {
      // This is deliberately a separate event from the preselection skip. It
      // means a card passed its start gate, but movement/aim/target changes in
      // this tick invalidated the final fire/cooling request.
      appendActionEvent(actionEvents, {
        type: 'poststartfailure',
        phase: 'post-start',
        tick: state.tick + 1,
        actorId: started.actorId,
        ruleId: started.rule.id,
        action: started.rule.action,
        actionStartId: started.actionStartId,
        reason: availability.reason,
      });
      continue;
    }
    if (started.rule.action === 'fire-pulse') {
      commands.push({
        kind: 'fire',
        ownerId: started.actorId,
        heading: robot.turretHeading,
        weapon: actor.weapon,
      });
    } else if (started.rule.action === 'cool' && actor.cooler) {
      commands.push({ kind: 'cool', ownerId: started.actorId, amount: actor.cooler.amount });
      coolingIds.add(started.actorId);
    }
  }
  return { commands, coolingIds };
}

/** Advances a complete R01 battle by exactly one deterministic simulation tick. */
export function stepBattle(state: BattleState): BattleState {
  validateBattleState(state);
  if (state.outcome.status === 'finished') return state;
  const tick = addGameIntegers(state.tick, 1, 'battle tick');
  const actionEvents = [...state.actionEvents];
  const selectionTrace = [...state.selectionTrace];
  // The cooling timer belongs to battle state, so decrement it in the same
  // pre-action phase in which CombatState decrements fire/overheat timers.
  let robots = state.combatants.map((robot) => ({
    ...robot,
    coolingCooldownRemaining: Math.max(0, robot.coolingCooldownRemaining - 1),
  }));
  const selection = prepareActionSelection(
    state,
    tick,
    robots,
    actionEvents,
    selectionTrace,
    state.nextActionStartId,
  );
  robots = advanceMotion({ ...state, combatants: selection.robots }, selection.robots);
  const commands = finalCommands(state, robots, selection.starts, actionEvents);

  // Reuse the existing HP/projectile/heat engine. It still performs the
  // canonical timer decrement, fire accounting, projectile movement, hit
  // aggregation, and outcome decision. The BattleRobot fields survive its
  // structural spreads unchanged.
  const combatState = {
    ...state,
    combatants: robots,
  };
  const afterCombat = (commands.commands.length > 0 || robots.length > 0
    ? (awaitableStepCombat(combatState, commands.commands))
    : combatState) as BattleState;

  let resolvedRobots = afterCombat.combatants.map((combatant) => ({ ...combatant })) as BattleRobot[];
  for (const actor of state.actors) {
    if (!commands.coolingIds.has(actor.id) || !actor.cooler) continue;
    const index = resolvedRobots.findIndex((robot) => robot.id === actor.id);
    if (index < 0) continue;
    resolvedRobots[index] = {
      ...resolvedRobots[index],
      coolingCooldownRemaining: actor.cooler.cooldownTicks ?? 30,
    };
  }
  const nextState: BattleState = {
    ...afterCombat,
    tick,
    combatants: resolvedRobots,
    actionEvents,
    selectionTrace,
    nextActionStartId: selection.nextActionStartId,
    simulationVersion: state.simulationVersion,
  };
  validateBattleState(nextState);
  return nextState;
}

/** Runs up to `maxTicks` fixed steps without rendering or wall-clock input. */
export function runBattle(initial: BattleState, maxTicks: number): BattleState {
  if (!Number.isSafeInteger(maxTicks) || maxTicks < 0) throw new RangeError('maxTicks must be non-negative');
  let state = initial;
  for (let index = 0; index < maxTicks && state.outcome.status === 'running'; index += 1) state = stepBattle(state);
  return state;
}

// Kept as a local indirection to make the single combat call obvious to code
// review and avoid importing any UI or clock module into the simulation.
import { stepCombat } from './combat';
function awaitableStepCombat(state: BattleState, commands: readonly CombatCommand[]): BattleState {
  return stepCombat(state, commands) as BattleState;
}

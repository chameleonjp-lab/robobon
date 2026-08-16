import { battleEventText } from './battle-status';
import type { CombatEvent, CombatState } from './simulation/combat';

/** One immutable, render-only snapshot of a running battle. */
export interface ReplayFrame {
  readonly state: CombatState;
  readonly ruleId: string | null;
}

export interface ReplayWindow {
  readonly frames: readonly ReplayFrame[];
  readonly targetTick: number;
  readonly startTick: number;
  readonly fullWindow: boolean;
}

export interface TimelineEntry {
  readonly event: CombatEvent;
  readonly message: string;
  readonly replayAvailable: boolean;
}

const DEFAULT_REPLAY_WINDOW_TICKS = 180;
const DEFAULT_TIMELINE_LIMIT = 80;
const MAX_SNAPSHOT_EVENTS = 64;

/**
 * Copies only the state needed by the renderer. The simulation remains the
 * source of truth; a replay frame is never fed back into the simulation.
 */
export function compactReplayState(state: CombatState): CombatState {
  return {
    ...state,
    arena: { ...state.arena },
    combatants: state.combatants.map((combatant) => ({ ...combatant })),
    projectiles: state.projectiles.map((projectile) => ({ ...projectile })),
    events: state.events.slice(-MAX_SNAPSHOT_EVENTS).map((event) => ({ ...event })),
    outcome: { ...state.outcome },
  };
}

/**
 * Returns the recorded frames ending at the requested event. If the ring has
 * already discarded the event, null is returned so the UI cannot imply a
 * replay that it cannot actually show.
 */
export function selectReplayWindow(
  frames: readonly ReplayFrame[],
  targetTick: number,
  windowTicks = DEFAULT_REPLAY_WINDOW_TICKS,
): ReplayWindow | null {
  if (!Number.isSafeInteger(targetTick) || targetTick < 0) throw new RangeError('targetTick must be a non-negative safe integer');
  if (!Number.isSafeInteger(windowTicks) || windowTicks < 0) throw new RangeError('windowTicks must be a non-negative safe integer');
  if (frames.length === 0) return null;

  let targetIndex = -1;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].state.tick <= targetTick) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return null;

  const targetFrame = frames[targetIndex];
  const startTick = Math.max(0, targetFrame.state.tick - windowTicks);
  const firstFrame = frames.find((frame) => frame.state.tick >= startTick);
  if (!firstFrame) return null;
  const selected = frames.slice(
    frames.indexOf(firstFrame),
    targetIndex + 1,
  );
  if (selected.length === 0) return null;
  return {
    frames: selected,
    targetTick: targetFrame.state.tick,
    startTick: firstFrame.state.tick,
    fullWindow: targetFrame.state.tick >= windowTicks && firstFrame.state.tick <= startTick,
  };
}

/** Converts stored events into the bounded, selectable analysis timeline. */
export function timelineEntries(
  events: readonly CombatEvent[],
  frames: readonly ReplayFrame[],
  maxEntries = DEFAULT_TIMELINE_LIMIT,
): TimelineEntry[] {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive safe integer');
  return events
    .map((event) => ({ event, message: battleEventText(event) }))
    .filter((entry): entry is { readonly event: CombatEvent; readonly message: string } => entry.message !== null)
    .slice(-maxEntries)
    .map(({ event, message }) => ({
      event,
      message,
      replayAvailable: selectReplayWindow(frames, event.tick) !== null,
    }));
}

export { DEFAULT_REPLAY_WINDOW_TICKS, DEFAULT_TIMELINE_LIMIT, MAX_SNAPSHOT_EVENTS };

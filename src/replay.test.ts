import { describe, expect, it } from 'vitest';
import { createCombatState, type CombatEvent } from './simulation/combat';
import {
  compactReplayState,
  selectReplayWindow,
  timelineEntries,
  type ReplayFrame,
} from './replay';

function frame(tick: number, ruleId: string | null = null): ReplayFrame {
  return {
    state: createCombatState({
      arena: { minX: 0, maxX: 640, minY: 0, maxY: 360 },
      maxTicks: 1_200,
      tick,
      combatants: [
        {
          id: 1,
          x: 190,
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
        },
        {
          id: 2,
          x: 430,
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
        },
      ],
    }),
    ruleId,
  };
}

describe('P4-19 replay model', () => {
  it('selects the requested event and its preceding three-second window', () => {
    const frames = [0, 60, 120, 180, 240].map((tick) => frame(tick));
    const selected = selectReplayWindow(frames, 240);

    expect(selected).toMatchObject({ targetTick: 240, startTick: 60, fullWindow: true });
    expect(selected?.frames.map((item) => item.state.tick)).toEqual([60, 120, 180, 240]);
  });

  it('marks a truncated window when the in-memory ring starts after three seconds', () => {
    const selected = selectReplayWindow([frame(180), frame(240)], 240);
    expect(selected).toMatchObject({ targetTick: 240, startTick: 180, fullWindow: false });
    expect(selectReplayWindow([frame(0), frame(60)], 60)).toMatchObject({ fullWindow: false });
  });

  it('refuses to imply a replay for a discarded event', () => {
    expect(selectReplayWindow([frame(180), frame(240)], 60)).toBeNull();
  });

  it('copies snapshots and bounds copied event details', () => {
    const source = frame(120).state;
    const events: CombatEvent[] = Array.from({ length: 70 }, (_, index) => ({
      type: 'PROJECTILE_FIRED',
      tick: index,
      sourceId: 1,
    }));
    const copied = compactReplayState({ ...source, events });

    expect(copied).not.toBe(source);
    expect(copied.combatants[0]).not.toBe(source.combatants[0]);
    expect(copied.events).toHaveLength(64);
    expect(copied.events[0]?.tick).toBe(6);
  });

  it('filters non-display events and exposes replay availability', () => {
    const events: CombatEvent[] = [
      { type: 'PROJECTILE_EXPIRED', tick: 60, projectileId: 1 },
      { type: 'HIT_CONFIRMED', tick: 120, sourceId: 1, targetId: 2, value: 12 },
      { type: 'MATCH_END', tick: 180, reason: 'destruction' },
    ];
    const entries = timelineEntries(events, [frame(0), frame(60), frame(120), frame(180)], 10);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.event.type)).toEqual(['HIT_CONFIRMED', 'MATCH_END']);
    expect(entries.every((entry) => entry.replayAvailable)).toBe(true);
  });
});

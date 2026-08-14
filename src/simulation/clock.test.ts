import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './clock';

describe('fixed-step clock', () => {
  it('limits work per frame and carries only a small remainder', () => {
    const clock = new FixedStepClock({ fixedStepMs: 10, maxStepsPerFrame: 3 });
    const ticks: number[] = [];

    expect(clock.advance(25, (tick) => ticks.push(tick))).toEqual({
      steps: 2,
      droppedBacklog: false,
      accumulatorMs: 5,
      tick: 2,
    });
    expect(clock.advance(10, (tick) => ticks.push(tick))).toEqual({
      steps: 1,
      droppedBacklog: false,
      accumulatorMs: 5,
      tick: 3,
    });
    expect(clock.advance(100, (tick) => ticks.push(tick))).toEqual({
      steps: 3,
      droppedBacklog: true,
      accumulatorMs: 0,
      tick: 6,
    });
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not advance while paused and discards hidden-page elapsed time', () => {
    const clock = new FixedStepClock({ fixedStepMs: 10 });
    const ticks: number[] = [];
    clock.pause();
    expect(clock.advance(1_000, (tick) => ticks.push(tick)).steps).toBe(0);
    clock.resume();
    expect(clock.advance(10, (tick) => ticks.push(tick)).steps).toBe(1);
    expect(ticks).toEqual([1]);
  });

  it('rejects invalid elapsed time and configuration', () => {
    expect(() => new FixedStepClock({ fixedStepMs: 0 })).toThrow(RangeError);
    expect(() => new FixedStepClock({ maxStepsPerFrame: 0 })).toThrow(RangeError);
    const clock = new FixedStepClock();
    expect(() => clock.advance(Number.NaN, () => undefined)).toThrow(RangeError);
  });
});

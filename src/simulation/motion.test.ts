import { describe, expect, it } from 'vitest';
import {
  DIRECTION_TABLE,
  directionVector,
  setHeadingVelocity,
  shortestHeadingDelta,
  stepBody,
  turnHeading,
  velocityForHeading,
} from './motion';
import type { MotionBody } from './motion';

const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 } as const;
const body: MotionBody = {
  id: 1,
  x: 50,
  y: 50,
  vx: 0,
  vy: 0,
  radius: 10,
  active: true,
  heading: 0,
  speed: 10,
};

describe('deterministic motion', () => {
  it('uses the literal 256-direction table', () => {
    expect(DIRECTION_TABLE).toHaveLength(256);
    expect(directionVector(0)).toEqual({ x: 1_000, y: 0 });
    expect(directionVector(64)).toEqual({ x: 0, y: 1_000 });
    expect(directionVector(128)).toEqual({ x: -1_000, y: 0 });
    expect(directionVector(192)).toEqual({ x: 0, y: -1_000 });
  });

  it('computes integer velocity without runtime trigonometry', () => {
    expect(velocityForHeading(0, 100)).toEqual({ x: 100, y: 0 });
    expect(velocityForHeading(64, 100)).toEqual({ x: 0, y: 100 });
    expect(setHeadingVelocity(body, 128, 100)).toMatchObject({ heading: 128, vx: -100, vy: 0, speed: 100 });
  });

  it('turns by the shortest direction with a fixed tie rule', () => {
    expect(shortestHeadingDelta(0, 255)).toBe(-1);
    expect(turnHeading(0, 255, 2)).toBe(255);
    expect(shortestHeadingDelta(0, 128)).toBe(-128);
    expect(turnHeading(0, 128, 64)).toBe(192);
  });

  it('clamps at the arena edge and stops outward velocity', () => {
    const atEdge = stepBody({ ...body, x: 15, vx: -10 }, bounds);
    expect(atEdge).toMatchObject({ x: 10, vx: 0, y: 50, vy: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import { forecastBoundaryRisk, headingToPoint, readSensor } from './sensor';
import type { MotionBody } from './motion';

const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 } as const;
const observer: MotionBody = {
  id: 1,
  x: 20,
  y: 50,
  vx: 3,
  vy: 0,
  radius: 5,
  active: true,
  heading: 0,
  speed: 3,
};
const target: MotionBody = {
  id: 2,
  x: 80,
  y: 50,
  vx: 0,
  vy: 0,
  radius: 5,
  active: true,
  heading: 128,
  speed: 0,
};

describe('deterministic sensors', () => {
  it('chooses a bearing from the fixed direction table', () => {
    expect(headingToPoint(observer, target)).toBe(0);
    expect(headingToPoint(observer, { x: 20, y: 0 })).toBe(192);
    expect(headingToPoint({ ...observer, heading: 64 }, observer)).toBe(64);
  });

  it('reports exact range, visibility, and relative heading', () => {
    const reading = readSensor(observer, target, 60);
    expect(reading).toMatchObject({
      observerId: 1,
      targetId: 2,
      distanceSquared: 3_600n,
      withinRange: true,
      visible: true,
      bearing: 0,
      relativeHeading: 0,
    });
    expect(readSensor(observer, target, 60, true).visible).toBe(false);
    expect(readSensor(observer, { ...target, active: false }, 60).visible).toBe(false);
  });

  it('flags only a future boundary crossing', () => {
    expect(forecastBoundaryRisk(observer, bounds, 10)).toMatchObject({ any: false });
    expect(forecastBoundaryRisk({ ...observer, x: 90, vx: 3 }, bounds, 10)).toMatchObject({ xMax: true, any: true });
    expect(forecastBoundaryRisk({ ...observer, x: 10, vx: -1 }, bounds, 0)).toMatchObject({ any: false });
  });
});

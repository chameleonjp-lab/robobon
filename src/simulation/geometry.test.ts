import { describe, expect, it } from 'vitest';
import { clampBodyToArena, circlesTouchOrOverlap, resolveCircleCollision, squaredDistance } from './geometry';
import type { CircleBody } from './geometry';

const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 } as const;
const first: CircleBody = { id: 1, x: 50, y: 50, vx: 4, vy: 0, radius: 10, active: true };
const second: CircleBody = { id: 2, x: 65, y: 50, vx: -4, vy: 0, radius: 10, active: true };

describe('geometry and collision', () => {
  it('uses exact squared distance without square roots', () => {
    expect(squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25n);
    expect(circlesTouchOrOverlap(first, second)).toBe(true);
  });

  it('resolves a pair in ascending ID order regardless of input order', () => {
    const forward = resolveCircleCollision(first, second);
    const reversed = resolveCircleCollision(second, first);
    expect(forward.collided).toBe(true);
    expect(forward.axis).toBe('x');
    expect(forward.bodies).toEqual(reversed.bodies);
    expect(forward.bodies.map((body) => body.id)).toEqual([1, 2]);
    expect(forward.bodies.map((body) => body.x)).toEqual([47, 67]);
    expect(forward.bodies[0].vx).toBe(0);
    expect(forward.bodies[1].vx).toBe(0);
  });

  it('clamps a body to the inside edge defined by its radius', () => {
    expect(clampBodyToArena({ ...first, x: -20, y: 200, vx: -5, vy: 5 }, bounds)).toMatchObject({
      x: 10,
      y: 90,
      vx: 0,
      vy: 0,
    });
  });

  it('rejects an arena that cannot contain the body', () => {
    expect(() => clampBodyToArena({ ...first, radius: 60 }, bounds)).toThrow(RangeError);
    expect(() => clampBodyToArena({ ...first, radius: 10 }, { ...bounds, minX: 100 })).toThrow(RangeError);
  });
});

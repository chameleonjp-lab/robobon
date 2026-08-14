import { describe, expect, it } from 'vitest';
import {
  FIXED_POINT_SCALE,
  addGameIntegers,
  fromFixed,
  multiplyFixed,
  toFixed,
} from './fixed-point';

describe('fixed-point helpers', () => {
  it('uses a visible scale and rounds half away from zero', () => {
    expect(FIXED_POINT_SCALE).toBe(1_000);
    expect(toFixed(1.2345)).toBe(1_235);
    expect(toFixed(-1.2345)).toBe(-1_235);
    expect(fromFixed(1_235)).toBe(1.235);
  });

  it('checks overflow before values enter simulation state', () => {
    expect(() => toFixed(2_000_000.001)).toThrow(RangeError);
    expect(() => addGameIntegers(2_000_000_000, 1)).toThrow(RangeError);
    expect(() => multiplyFixed(2_000_000_000, 2_000_000_000)).toThrow(RangeError);
  });

  it('multiplies fixed values with integer rounding', () => {
    expect(multiplyFixed(toFixed(1.5), toFixed(2))).toBe(toFixed(3));
    expect(multiplyFixed(toFixed(-1.5), toFixed(0.0015))).toBe(-3);
  });
});

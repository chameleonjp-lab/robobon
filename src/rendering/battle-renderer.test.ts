import { describe, expect, it } from 'vitest';
import { EFFECT_WINDOWS, directionToTarget, isEffectVisible, robotSideForId, robotSilhouette } from './battle-renderer';

describe('P3-15 representative battle renderer contract', () => {
  it('keeps ally and enemy silhouettes distinct and deterministic', () => {
    const ally = robotSilhouette('ally');
    const enemy = robotSilhouette('enemy');

    expect(ally).not.toEqual(enemy);
    expect(ally).toEqual(robotSilhouette('ally'));
    expect(enemy).toEqual(robotSilhouette('enemy'));
    expect(ally.length).toBeGreaterThanOrEqual(5);
    expect(enemy.length).toBeGreaterThanOrEqual(5);
    expect(ally.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(enemy.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('uses non-color role markers as a stable side contract', () => {
    expect(robotSideForId(1)).toBe('ally');
    expect(robotSideForId(2)).toBe('enemy');
    expect(robotSideForId(99)).toBe('enemy');
  });

  it('points the body and turret at the opposing unit', () => {
    const right = directionToTarget({ id: 1, x: 100, y: 180 }, { id: 2, x: 200, y: 180 });
    const up = directionToTarget({ id: 2, x: 200, y: 180 }, { id: 1, x: 200, y: 80 });
    const samePosition = directionToTarget({ id: 1, x: 120, y: 120 }, { id: 2, x: 120, y: 120 });

    expect(right).toMatchObject({ x: 1, y: 0, angle: 0 });
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    expect(up.angle).toBeCloseTo(-Math.PI / 2);
    expect(samePosition).toMatchObject({ x: 1, y: 0, angle: 0 });
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(1);
  });

  it('keeps weapon effects inside fixed tick windows', () => {
    expect(isEffectVisible(10, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(true);
    expect(isEffectVisible(13, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(true);
    expect(isEffectVisible(14, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(false);
    expect(isEffectVisible(9, 10, EFFECT_WINDOWS.impact)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { EFFECT_WINDOWS, battleQualitySettings, robotAngles, isEffectVisible, robotSideForId, robotSilhouette } from './battle-renderer';

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

  it('renders the recorded body and turret headings independently', () => {
    expect(robotAngles({ id: 1, heading: 64, turretHeading: 128 })).toEqual({ body: Math.PI / 2, turret: Math.PI });
    expect(robotAngles({ id: 2, heading: 0, turretHeading: 64 })).toEqual({ body: 0, turret: Math.PI / 2 });
    expect(robotAngles({ id: 2 })).toEqual({ body: Math.PI, turret: Math.PI });
  });

  it('keeps weapon effects inside fixed tick windows', () => {
    expect(isEffectVisible(10, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(true);
    expect(isEffectVisible(13, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(true);
    expect(isEffectVisible(14, 10, EFFECT_WINDOWS.muzzleFlash)).toBe(false);
    expect(isEffectVisible(9, 10, EFFECT_WINDOWS.impact)).toBe(false);
  });

  it('reduces decoration without changing the quality-independent combat contract', () => {
    expect(battleQualitySettings('high')).toEqual({ scorchMarkLimit: 24, effects: 'full' });
    expect(battleQualitySettings('medium')).toEqual({ scorchMarkLimit: 12, effects: 'full' });
    expect(battleQualitySettings('low')).toEqual({ scorchMarkLimit: 0, effects: 'reduced' });
  });
});

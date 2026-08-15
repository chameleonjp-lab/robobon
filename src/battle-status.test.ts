import { describe, expect, it } from 'vitest';
import { battleEventText, formatBattleStatus, formatCombatantMetric } from './battle-status';
import type { CombatantState } from './simulation/combat';

function combatant(overrides: Partial<CombatantState> = {}): CombatantState {
  return {
    id: 1,
    x: 100,
    y: 180,
    radius: 16,
    maxHealth: 100,
    health: 72,
    heat: 45,
    ammo: 4,
    fireCooldownRemaining: 0,
    overheatRemaining: 0,
    damageDealt: 28,
    active: true,
    ...overrides,
  };
}

describe('P3-17 accessible battle status formatting', () => {
  it('turns important combat events into short spoken messages', () => {
    expect(battleEventText({ type: 'PROJECTILE_FIRED', tick: 1, sourceId: 1 })).toBe('機体1が発射しました');
    expect(battleEventText({ type: 'HIT_CONFIRMED', tick: 2, sourceId: 1, targetId: 2, value: 12 })).toBe('機体1の弾が機体2へ命中しました（12ダメージ）');
    expect(battleEventText({ type: 'HEAT_STARTED', tick: 3, sourceId: 1 })).toContain('過熱しました');
    expect(battleEventText({ type: 'ACTION_UNAVAILABLE', tick: 4, sourceId: 1, reason: 'ammo-empty' })).toBe('機体1は弾切れ');
    expect(battleEventText({ type: 'PROJECTILE_EXPIRED', tick: 5, projectileId: 3 })).toBeNull();
  });

  it('keeps the one-line status understandable without the Canvas', () => {
    const text = formatBattleStatus(42, 1_200, combatant(), combatant({ id: 2, health: 88 }));
    expect(text).toContain('自機');
    expect(text).toContain('熱');
    expect(text).toContain('弾');
    expect(text).toContain('敵');
  });

  it('labels overheat and stopped machines explicitly', () => {
    expect(formatCombatantMetric(combatant({ overheatRemaining: 10 }))).toMatchObject({ heat: '45（過熱中）' });
    expect(formatCombatantMetric(combatant({ active: false }))).toMatchObject({ active: '停止' });
  });
});

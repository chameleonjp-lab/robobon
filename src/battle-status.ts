import type { CombatEvent, CombatantState } from './simulation/combat';

const UNAVAILABLE_REASON_LABELS: Record<string, string> = {
  inactive: '停止中',
  'ammo-empty': '弾切れ',
  cooldown: '待ち時間中',
  overheated: '過熱中',
  'heat-limit': '熱が高すぎる',
};

function sourceLabel(id: number | undefined): string {
  return id === undefined ? '機体' : `機体${id}`;
}

export function battleEventText(event: CombatEvent): string | null {
  switch (event.type) {
    case 'PROJECTILE_FIRED':
      return `${sourceLabel(event.sourceId)}が発射しました`;
    case 'HIT_CONFIRMED':
      return `${sourceLabel(event.sourceId)}の弾が${sourceLabel(event.targetId)}へ命中しました（${event.value ?? 0}ダメージ）`;
    case 'HEAT_STARTED':
      return `${sourceLabel(event.sourceId)}が過熱しました。冷却が必要です`;
    case 'ACTION_UNAVAILABLE':
      return `${sourceLabel(event.sourceId)}は${UNAVAILABLE_REASON_LABELS[event.reason ?? ''] ?? '今は行動できません'}`;
    case 'COOLED':
      return `${sourceLabel(event.sourceId)}が${event.value ?? 0}冷却しました`;
    case 'MATCH_END':
      return `戦闘終了: ${event.reason ?? '結果が決まりました'}`;
    case 'PROJECTILE_EXPIRED':
      return null;
  }
}

export function formatBattleStatus(
  tick: number,
  maxTicks: number,
  player: CombatantState,
  opponent: CombatantState,
): string {
  const playerHeat = player.overheatRemaining > 0 ? `${player.heat}（過熱中）` : `${player.heat}`;
  return `刻み ${tick} / ${maxTicks}。自機 耐久 ${player.health} / ${player.maxHealth}、熱 ${playerHeat}、弾 ${player.ammo}。敵 耐久 ${opponent.health} / ${opponent.maxHealth}`;
}

export function formatCombatantMetric(combatant: CombatantState): {
  readonly health: string;
  readonly heat: string;
  readonly ammo: string;
  readonly active: string;
} {
  return {
    health: `${combatant.health} / ${combatant.maxHealth}`,
    heat: combatant.overheatRemaining > 0 ? `${combatant.heat}（過熱中）` : `${combatant.heat}`,
    ammo: `${combatant.ammo}`,
    active: combatant.active ? '稼働中' : '停止',
  };
}

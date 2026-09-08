import type { RuleCard } from './simulation/rules';

export const CONDITION_LABELS: Record<string, string> = {
  always: '常に',
  'enemy-visible': '敵を確認したら',
  'enemy-near': '敵が近ければ',
  'enemy-in-range': '敵が射程内なら',
  'projectile-warning': '弾が来たら',
  'ammo-available': '弾が残っていれば',
  'heat-high': '熱が高ければ',
  'boundary-danger': '壁が近ければ',
  'line-of-sight': '射線が通れば',
};

export const ACTION_LABELS: Record<string, string> = {
  'face-target': '敵へ向く',
  'fire-pulse': 'パルス砲を撃つ',
  retreat: '後退する',
  strafe: '横へ避ける',
  cool: '冷却する',
  explore: '探索する',
  stop: '停止する',
};

export function ruleConditionText(rule: RuleCard): string {
  if (rule.conditions.length === 0) return CONDITION_LABELS.always;
  return rule.conditions.map((condition) => condition.expected === false
    ? `「${CONDITION_LABELS[condition.id]}」ではない`
    : CONDITION_LABELS[condition.id]).join(' かつ ');
}

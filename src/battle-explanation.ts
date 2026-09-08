import { ACTION_LABELS } from './rule-labels';
import type { BattleActionEvent, BattleState } from './simulation/battle-state';

const REASONS: Record<string, string> = {
  available: '開始できます', inactive: '機体が停止しています',
  'target-missing': '対象の敵がいません', 'target-inactive': '敵が停止しています',
  'already-aimed': 'すでに敵へ向いています', range: '射程の外です',
  'line-of-sight': '射線がふさがっています', aim: '照準を合わせる必要があります',
  'ammo-empty': '弾が足りません', cooldown: '発射の待ち時間です',
  overheated: '過熱からの復帰待ちです', 'heat-limit': '熱が高すぎます',
  'cooler-missing': '冷却装置がありません', 'cooler-cooldown': '冷却装置の待ち時間です',
  'no-heat': '冷やす熱がありません', 'duration-elapsed': '継続時間が終わりました',
  'higher-priority-interrupt': '上位のカードに切り替えました',
  'lower-priority-held': '実行中の行動を続けます',
  'switch-rate-limit': '切替回数の上限のため行動を続けます',
  'same-rule': '同じ行動を続けます', 'new-selection': '行動を開始しました',
  'no-selection': '開始できる行動を待っています',
};

export function battleReasonText(reason: string | undefined): string {
  return reason ? REASONS[reason] ?? '行動の状態が変わりました' : '';
}

/** Uses the executor's recorded decision; the UI never selects cards again. */
export function battleDecisionText(state: BattleState, actorId: number): string {
  for (let index = state.selectionTrace.length - 1; index >= 0; index -= 1) {
    const trace = state.selectionTrace[index];
    if (trace.actorId !== actorId) continue;
    const skipped = trace.evaluations.find((evaluation) => evaluation.matched && evaluation.startable === false);
    if (skipped) {
      const rule = state.actors.find((actor) => actor.id === actorId)?.rules.find((item) => item.id === skipped.ruleId);
      return `${rule ? `${rule.priority + 1}枚目` : 'カード'}は見送り: ${battleReasonText(skipped.availabilityReason)}。`;
    }
    return trace.selectedRuleId ? '条件が合い、開始できるカードを確認しました。' : '開始できるカードを待っています。';
  }
  return 'これからカードを確認します。';
}

export function battleActionText(event: BattleActionEvent, state: BattleState): string {
  const rule = state.actors.find((actor) => actor.id === event.actorId)?.rules.find((item) => item.id === event.ruleId);
  const side = event.actorId === 1 ? '自機' : '敵';
  const action = event.action ? ACTION_LABELS[event.action] : '行動';
  const phase: Record<BattleActionEvent['type'], string> = {
    preselectionskip: '開始前に見送り', poststartfailure: '開始後の確認で不実行',
    'action-start': '開始', 'action-continue': '継続', 'action-interrupt': '中断',
    'action-complete': '完了', 'action-held': '継続', 'action-idle': '待機',
  };
  const reason = battleReasonText(event.reason);
  return `${side}${rule ? `・${rule.priority + 1}枚目` : ''}「${action}」${phase[event.type]}${reason ? `（${reason}）` : ''}`;
}

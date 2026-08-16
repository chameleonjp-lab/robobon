import type { CombatEvent } from './simulation/combat';

export type EvidenceKind = 'rule-choice' | 'hit' | 'blocked';

export interface AnalysisEvidence {
  readonly tick: number;
  readonly text: string;
  readonly kind: EvidenceKind;
}

export interface EvidenceGap {
  readonly id: EvidenceKind;
  readonly label: string;
}

export type EvidenceLevel = 'insufficient' | 'limited';

export interface EvidenceAssessment {
  readonly level: EvidenceLevel;
  readonly summary: string;
  readonly gaps: readonly EvidenceGap[];
  readonly observedKinds: number;
}

export interface ExperimentIdea {
  readonly id: 'repeat' | 'priority' | 'condition';
  readonly title: string;
  readonly detail: string;
}

const GAP_LABELS: Record<EvidenceKind, string> = {
  'rule-choice': '実行中の規則が選ばれた場面',
  hit: '命中または被弾の結果',
  blocked: '発射できなかった理由',
};

function hasPlayerEvent(events: readonly CombatEvent[], type: CombatEvent['type']): boolean {
  return events.some((event) => event.type === type && (event.sourceId === undefined || event.sourceId === 1));
}

/** Describes what was observed without turning correlation into a cause. */
export function assessEvidence(
  evidence: readonly AnalysisEvidence[],
  events: readonly CombatEvent[],
): EvidenceAssessment {
  const hasRuleChoice = evidence.some((item) => item.kind === 'rule-choice');
  const hasHit = events.some((event) => event.type === 'HIT_CONFIRMED');
  const hasBlocked = hasPlayerEvent(events, 'ACTION_UNAVAILABLE');
  const observedKinds = [hasRuleChoice, hasHit, hasBlocked].filter(Boolean).length;
  const gaps = (Object.keys(GAP_LABELS) as EvidenceKind[])
    .filter((kind) => !(
      kind === 'rule-choice' ? hasRuleChoice : kind === 'hit' ? hasHit : hasBlocked
    ))
    .map((id) => ({ id, label: GAP_LABELS[id] }));
  const level: EvidenceLevel = evidence.length >= 3 && observedKinds >= 2 ? 'limited' : 'insufficient';
  const summary = level === 'limited'
    ? `${evidence.length}件、${observedKinds}種類の観測を確認しました。ただし、これは原因の確定ではありません。`
    : `観測できた事実は${evidence.length}件です。原因を決めるには証拠が足りません。`;
  return { level, summary, gaps, observedKinds };
}

/** Returns bounded experiments; none of these changes the player's rules automatically. */
export function createExperimentIdeas(assessment: EvidenceAssessment): readonly ExperimentIdea[] {
  const ideas: ExperimentIdea[] = [
    {
      id: 'repeat',
      title: '作戦を変えずに再戦する',
      detail: '同じ出来事が近い刻みで再び起きるかを確かめ、偶然と繰り返す傾向を分けます。',
    },
    {
      id: 'priority',
      title: '規則の順番を1枚だけ変える',
      detail: '実行中の規則が変わるかを見て、優先順位の影響だけを比べます。',
    },
    {
      id: 'condition',
      title: '射程または敵確認の条件だけを変える',
      detail: '条件を一つだけ動かし、発射・命中・被弾の変化を時間線で比べます。',
    },
  ];
  if (assessment.gaps.some((gap) => gap.id === 'rule-choice')) {
    ideas[0] = ideas[1];
    ideas[1] = {
      id: 'repeat',
      title: '作戦を変えずに再戦する',
      detail: '同じ出来事が近い刻みで再び起きるかを確かめ、偶然と繰り返す傾向を分けます。',
    };
  }
  return ideas;
}

export function evidenceKindLabel(kind: EvidenceKind): string {
  return kind === 'rule-choice' ? '規則選択' : kind === 'hit' ? '命中結果' : '行動不能';
}

export interface FirstUseRecord {
  readonly anonymousId: string;
  readonly meaningfulInputSeconds: number | null;
  readonly introBattleEndSeconds: number | null;
  readonly explainedQuestion: boolean | null;
  readonly explainedNextAction: boolean | null;
  readonly selfInitiatedReplay: boolean | null;
  readonly note: string;
}

export interface FirstUseMetric {
  readonly id: 'meaningful-input' | 'intro-battle-end' | 'question' | 'next-action';
  readonly label: string;
  readonly count: number;
  readonly target: number;
  readonly passed: boolean;
}

export interface FirstUseSummary {
  readonly participantCount: number;
  readonly metrics: readonly FirstUseMetric[];
  readonly missingData: readonly string[];
  readonly passed: boolean;
}

export type FirstUseDecision = 'pass' | 'improve' | 'stop-or-redesign' | 'insufficient-data';

const REQUIRED_PARTICIPANTS = 5;
const TARGET_COUNT = 4;
const INPUT_LIMIT_SECONDS = 30;
const INTRO_BATTLE_LIMIT_SECONDS = 60;

function assertSeconds(value: number | null, label: string): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${label} must be null or a non-negative finite number`);
  }
}

function countBoolean(records: readonly FirstUseRecord[], field: 'explainedQuestion' | 'explainedNextAction'): number {
  return records.filter((record) => record[field] === true).length;
}

/** Converts five anonymous observations into a bounded acceptance summary. */
export function evaluateFirstUse(records: readonly FirstUseRecord[]): FirstUseSummary {
  const ids = new Set<string>();
  for (const record of records) {
    if (!record.anonymousId || ids.has(record.anonymousId)) throw new RangeError('anonymousId must be unique and non-empty');
    ids.add(record.anonymousId);
    assertSeconds(record.meaningfulInputSeconds, 'meaningfulInputSeconds');
    assertSeconds(record.introBattleEndSeconds, 'introBattleEndSeconds');
  }
  const metricDrafts: readonly Omit<FirstUseMetric, 'passed'>[] = [
    {
      id: 'meaningful-input',
      label: '意味のある入力を30秒以内に行えた',
      count: records.filter((record) => record.meaningfulInputSeconds !== null && record.meaningfulInputSeconds <= INPUT_LIMIT_SECONDS).length,
      target: TARGET_COUNT,
    },
    {
      id: 'intro-battle-end',
      label: '導入戦を60秒以内に終えた',
      count: records.filter((record) => record.introBattleEndSeconds !== null && record.introBattleEndSeconds <= INTRO_BATTLE_LIMIT_SECONDS).length,
      target: TARGET_COUNT,
    },
    {
      id: 'question',
      label: '任務の問いを自分の言葉で説明できた',
      count: countBoolean(records, 'explainedQuestion'),
      target: TARGET_COUNT,
    },
    {
      id: 'next-action',
      label: '次の操作を自分で説明できた',
      count: countBoolean(records, 'explainedNextAction'),
      target: TARGET_COUNT,
    },
  ];
  const metrics: FirstUseMetric[] = metricDrafts.map((metric) => ({
    ...metric,
    passed: metric.count >= metric.target,
  }));
  const missingData = metrics
    .filter((metric) => metric.count < metric.target)
    .map((metric) => `${metric.label}（${metric.count}/${metric.target}）`);
  return {
    participantCount: records.length,
    metrics,
    missingData,
    passed: records.length >= REQUIRED_PARTICIPANTS && metrics.every((metric) => metric.passed),
  };
}

export function decideFirstUse(summary: FirstUseSummary, improvementRounds: number): FirstUseDecision {
  if (!Number.isInteger(improvementRounds) || improvementRounds < 0) {
    throw new RangeError('improvementRounds must be a non-negative integer');
  }
  if (summary.participantCount < REQUIRED_PARTICIPANTS) return 'insufficient-data';
  if (summary.passed) return 'pass';
  return improvementRounds < 2 ? 'improve' : 'stop-or-redesign';
}

export { INPUT_LIMIT_SECONDS, INTRO_BATTLE_LIMIT_SECONDS, REQUIRED_PARTICIPANTS, TARGET_COUNT };

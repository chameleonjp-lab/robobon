export type MissionId = 'dock-approach' | 'heat-window' | 'signal-gap';

export type MissionStageId = 'edit' | 'battle' | 'analysis';

export interface MissionStage {
  readonly id: MissionStageId;
  readonly title: string;
  readonly instruction: string;
}

export interface MissionSpec {
  readonly id: MissionId;
  readonly number: number;
  readonly title: string;
  readonly question: string;
  readonly objective: string;
  readonly focus: string;
  readonly battleTicks: number;
  readonly stages: readonly MissionStage[];
}

const COMMON_STAGES: readonly MissionStage[] = [
  {
    id: 'edit',
    title: '作戦を組む',
    instruction: '規則を1枚だけ確認し、なぜその順番にするかを決めます。',
  },
  {
    id: 'battle',
    title: '自動戦闘を見る',
    instruction: '実行中の規則、耐久、熱、弾数を同じ画面で見ます。',
  },
  {
    id: 'analysis',
    title: '事実から直す',
    instruction: '見えた事実と不足を分け、次の変更を1か所に絞ります。',
  },
];

export const INTRO_MISSIONS: readonly MissionSpec[] = [
  {
    id: 'dock-approach',
    number: 1,
    title: '接近を観測する',
    question: '敵が射程へ入る前に、撃てる距離を保てるか？',
    objective: '敵との距離、規則の選択、発射結果を時間線で確認します。',
    focus: '距離と発射の順番',
    battleTicks: 20 * 60,
    stages: COMMON_STAGES,
  },
  {
    id: 'heat-window',
    number: 2,
    title: '熱の窓を守る',
    question: '撃つ機会と冷却する順番を両立できるか？',
    objective: '熱が高い時の行動不能と、冷却規則の位置を比べます。',
    focus: '熱と行動不能',
    battleTicks: 20 * 60,
    stages: COMMON_STAGES,
  },
  {
    id: 'signal-gap',
    number: 3,
    title: '空いた時間を読む',
    question: '発射できない時間を見つけ、条件を一つだけ変えられるか？',
    objective: '命中結果と発射できなかった時間を分けて、次の実験を決めます。',
    focus: '命中結果と不足情報',
    battleTicks: 20 * 60,
    stages: COMMON_STAGES,
  },
];

export function missionById(id: MissionId): MissionSpec {
  const mission = INTRO_MISSIONS.find((candidate) => candidate.id === id);
  if (!mission) throw new RangeError(`未知の任務です: ${id}`);
  return mission;
}

export function missionStage(mission: MissionSpec, stageId: MissionStageId): MissionStage {
  const stage = mission.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new RangeError(`任務 ${mission.id} に段階 ${stageId} がありません`);
  return stage;
}


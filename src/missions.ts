import type {
  BattleObstacleInput,
  BattleWeaponSpec,
  CoolerSpec,
} from './simulation/battle-state';
import type { ArenaBounds } from './simulation/geometry';
import type { RuleCard } from './simulation/rules';

/** Content values are versioned separately from the calculation engine. */
export const MISSION_CONTENT_VERSION = 'r02-1' as const;

export type MissionId = 'dock-approach' | 'heat-window' | 'signal-gap';

export type MissionStageId = 'edit' | 'battle' | 'analysis';

export interface MissionStage {
  readonly id: MissionStageId;
  readonly title: string;
  readonly instruction: string;
}

export interface MissionCombatantSpec {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxHealth: number;
  readonly health: number;
  readonly ammo: number;
  readonly heading: number;
  readonly turretHeading: number;
}

/** Actor tuning is content data; the scheduler and fire gate stay shared. */
export interface MissionActorSpec {
  readonly weapon: BattleWeaponSpec;
  readonly cooler?: CoolerSpec;
  readonly sensorRange: number;
  readonly nearRange: number;
  readonly moveSpeed: number;
  readonly strafeSpeed: number;
  readonly exploreSpeed: number;
  readonly turnSpeed: number;
  readonly turretTurnSpeed: number;
  readonly projectileWarningLookaheadTicks: number;
}

export interface MissionBattleSpec {
  readonly contentVersion: typeof MISSION_CONTENT_VERSION;
  readonly arena: ArenaBounds;
  readonly obstacles: readonly BattleObstacleInput[];
  readonly player: MissionCombatantSpec;
  readonly enemy: MissionCombatantSpec;
  readonly playerActor: MissionActorSpec;
  readonly enemyActor: MissionActorSpec;
  readonly enemyRules: readonly RuleCard[];
  readonly scenarioSummary: string;
  readonly improvementPaths: readonly string[];
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
  readonly battle: MissionBattleSpec;
}

export const INTRO_ARENA: ArenaBounds = { minX: 0, maxX: 640, minY: 0, maxY: 360 } as const;

/** All R02 weapons live here so the UI, simulation setup, and docs share values. */
export const BATTLE_WEAPONS = {
  playerPulse: {
    id: 'pulse',
    ammoCost: 1,
    damage: 16,
    heat: 10,
    cooldownTicks: 30,
    projectileSpeed: 8,
    projectileRadius: 4,
    lifetimeTicks: 120,
    range: 250,
    aimTolerance: 8,
  },
  enemyPulse: {
    id: 'enemy-pulse',
    ammoCost: 1,
    damage: 26,
    heat: 10,
    cooldownTicks: 45,
    projectileSpeed: 8,
    projectileRadius: 4,
    lifetimeTicks: 120,
    range: 190,
    aimTolerance: 8,
  },
  heatPulse: {
    id: 'heat-pulse',
    ammoCost: 1,
    damage: 14,
    heat: 50,
    cooldownTicks: 30,
    projectileSpeed: 8,
    projectileRadius: 4,
    lifetimeTicks: 120,
    range: 250,
    aimTolerance: 8,
  },
} as const satisfies Record<string, BattleWeaponSpec>;

const COMMON_PLAYER_ACTOR: MissionActorSpec = {
  weapon: BATTLE_WEAPONS.playerPulse,
  cooler: { id: 'radiator', amount: 25, cooldownTicks: 90 },
  sensorRange: 360,
  nearRange: 120,
  moveSpeed: 2,
  strafeSpeed: 3,
  exploreSpeed: 1,
  turnSpeed: 4,
  turretTurnSpeed: 8,
  projectileWarningLookaheadTicks: 30,
};

const COMMON_ENEMY_ACTOR: MissionActorSpec = {
  weapon: BATTLE_WEAPONS.enemyPulse,
  sensorRange: 360,
  nearRange: 120,
  moveSpeed: 1,
  strafeSpeed: 2,
  exploreSpeed: 1,
  turnSpeed: 4,
  turretTurnSpeed: 8,
  projectileWarningLookaheadTicks: 30,
};

const ENEMY_APPROACH_RULES: readonly RuleCard[] = [
  { id: 'enemy-face', priority: 0, conditions: [{ id: 'enemy-visible' }], action: 'face-target' },
  { id: 'enemy-fire', priority: 1, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'enemy-advance', priority: 2, conditions: [], action: 'explore' },
];

const ENEMY_HOLD_RULES: readonly RuleCard[] = [
  { id: 'enemy-face', priority: 0, conditions: [{ id: 'enemy-visible' }], action: 'face-target' },
  { id: 'enemy-fire', priority: 1, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'enemy-hold', priority: 2, conditions: [], action: 'stop' },
];

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

const DOCK_BATTLE: MissionBattleSpec = {
  contentVersion: MISSION_CONTENT_VERSION,
  arena: INTRO_ARENA,
  // This cover is visible in the first scene but sits below the opening firing lane.
  // The dedicated signal mission exercises a true line-of-sight interruption.
  obstacles: [{ id: 'dock-crate', x: 300, y: 250, width: 56, height: 78 }],
  player: { x: 170, y: 180, radius: 16, maxHealth: 100, health: 100, ammo: 8, heading: 0, turretHeading: 0 },
  enemy: { x: 400, y: 180, radius: 16, maxHealth: 100, health: 100, ammo: 8, heading: 128, turretHeading: 128 },
  playerActor: { ...COMMON_PLAYER_ACTOR, nearRange: 180, moveSpeed: 3 },
  enemyActor: COMMON_ENEMY_ACTOR,
  enemyRules: ENEMY_APPROACH_RULES,
  scenarioSummary: '敵機は射程外から近づきます。貨物架は射線外にあり、距離の変化を観察できます。',
  improvementPaths: ['敵が近いカードを探索より上へ移して後退する', '弾の警告カードを探索より上へ移して横へ避ける'],
};

const HEAT_BATTLE: MissionBattleSpec = {
  contentVersion: MISSION_CONTENT_VERSION,
  arena: INTRO_ARENA,
  obstacles: [{ id: 'heat-stack', x: 72, y: 250, width: 96, height: 42 }],
  player: { x: 210, y: 180, radius: 16, maxHealth: 100, health: 100, ammo: 6, heading: 0, turretHeading: 0 },
  enemy: { x: 400, y: 180, radius: 16, maxHealth: 100, health: 100, ammo: 8, heading: 128, turretHeading: 128 },
  playerActor: { ...COMMON_PLAYER_ACTOR, weapon: BATTLE_WEAPONS.heatPulse },
  enemyActor: { ...COMMON_ENEMY_ACTOR, weapon: { ...BATTLE_WEAPONS.enemyPulse, damage: 15 } },
  enemyRules: ENEMY_HOLD_RULES,
  scenarioSummary: 'パルス砲は一度に熱50を生みます。2発目で過熱するため、冷却の順番を観察します。',
  improvementPaths: ['熱が高いカードを射撃より上へ置く', '射撃の前に冷却を優先し、発射不能の時間を短くする'],
};

const SIGNAL_BATTLE: MissionBattleSpec = {
  contentVersion: MISSION_CONTENT_VERSION,
  arena: INTRO_ARENA,
  obstacles: [{ id: 'signal-wall', x: 300, y: 126, width: 40, height: 108 }],
  player: { x: 190, y: 96, radius: 16, maxHealth: 100, health: 100, ammo: 8, heading: 0, turretHeading: 0 },
  enemy: { x: 450, y: 264, radius: 16, maxHealth: 100, health: 100, ammo: 8, heading: 128, turretHeading: 128 },
  playerActor: COMMON_PLAYER_ACTOR,
  enemyActor: { ...COMMON_ENEMY_ACTOR, weapon: { ...BATTLE_WEAPONS.enemyPulse, range: 220 } },
  enemyRules: ENEMY_APPROACH_RULES,
  scenarioSummary: '中央の壁が射線をふさぎます。移動で射線が通る時間を作れるかを観察します。',
  improvementPaths: ['射線が通らないときに横へ避ける', '敵が近いときに後退して壁の端へ回る'],
};

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
    battle: DOCK_BATTLE,
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
    battle: HEAT_BATTLE,
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
    battle: SIGNAL_BATTLE,
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

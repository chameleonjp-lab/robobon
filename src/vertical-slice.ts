import { FixedStepClock } from './simulation/clock';
import {
  createCombatState,
  stepCombat,
  type CombatCommand,
  type CombatState,
  type CombatantState,
  type WeaponSpec,
} from './simulation/combat';
import { headingToPoint } from './simulation/sensor';
import { selectRule, type RuleCard, type RuleFacts, type RuleSelection, validateRuleSet } from './simulation/rules';
import { squaredDistance } from './simulation/geometry';
import { drawBattleScene, type BattleQuality, type BattleRenderOptions } from './rendering/battle-renderer';
import { BattleAudio, soundForEvent } from './audio/battle-audio';
import { battleEventText, formatBattleStatus, formatCombatantMetric } from './battle-status';
import {
  assessEvidence,
  collectAnalysisEvidence,
  createExperimentIdeas,
  evidenceKindLabel,
  type AnalysisEvidence,
} from './analysis';
import {
  compactReplayState,
  selectReplayWindow,
  timelineEntries,
  type ReplayFrame,
} from './replay';
import {
  MAX_PROGRAM_BYTES,
  MAX_PROGRAM_NAME_LENGTH,
  MAX_PROGRAM_SLOTS,
  copyProgram,
  createProgramDocument,
  createProgramStore,
  parseProgramJson,
  serializeProgram,
  updateProgramRules,
  type ProgramDocument,
  type ProgramStore,
} from './storage';
import {
  INTRO_MISSIONS,
  missionById,
  missionStage,
  type MissionId,
  type MissionSpec,
  type MissionStageId,
} from './missions';

type SlicePhase = 'home' | 'edit' | 'battle' | 'analysis';

const ARENA = { minX: 0, maxX: 640, minY: 0, maxY: 360 } as const;
const RULE_EVALUATION_TICKS = 6;
const MAX_BATTLE_TICKS = 20 * 60;
const MAX_VERTICAL_SLICE_RULES = 8;
const MAX_RULE_UNDO_STEPS = 20;
const MIN_DURATION_TICKS = 6;
const MAX_DURATION_TICKS = 60 * 10;
/** One frame per simulation tick for the 20-second vertical slice. */
const MAX_REPLAY_FRAMES = 1_201;
const PLAYER_ID = 1;
const ENEMY_ID = 2;
const DEFAULT_BATTLE_SPEED = 1 as const;
const MAX_PLAYER_NAME_LENGTH = 32;
const EXPERIMENT_FIELD_URL = 'https://chameleonjp-lab.github.io/chameleonjp_lab/';
const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';
const GAME_SLUG = 'robobon';
const CLIENT_VERSION = 'robobon-vertical-slice-2026-08-31';

export type BattleSpeed = 1 | 2;

/** Limits wall-clock catch-up before applying the selected simulation speed. */
function scaleBattleElapsed(elapsedMs: number, speed: BattleSpeed): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('elapsedMs must be a non-negative finite number');
  return Math.min(100, elapsedMs) * speed;
}

const PLAYER_WEAPON: WeaponSpec = {
  id: 'pulse',
  ammoCost: 1,
  damage: 12,
  heat: 8,
  cooldownTicks: 30,
  projectileSpeed: 8,
  projectileRadius: 4,
  lifetimeTicks: 120,
};

const ENEMY_WEAPON: WeaponSpec = {
  ...PLAYER_WEAPON,
  id: 'enemy-pulse',
  damage: 15,
};

const CONDITION_LABELS: Record<string, string> = {
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

const ACTION_LABELS: Record<string, string> = {
  'face-target': '敵へ向く',
  'fire-pulse': 'パルス砲を撃つ',
  retreat: '後退する',
  strafe: '横へ避ける',
  cool: '冷却する',
  explore: '探索する',
  stop: '停止する',
};

const DEFAULT_RULES: readonly RuleCard[] = [
  { id: 'rule-cool', priority: 0, conditions: [{ id: 'heat-high' }], action: 'cool' },
  { id: 'rule-fire', priority: 1, conditions: [{ id: 'enemy-in-range' }], action: 'fire-pulse' },
  { id: 'rule-fallback', priority: 2, conditions: [], action: 'explore' },
];

type Evidence = AnalysisEvidence;

type OpenAnalysis = (
  state: CombatState,
  evidence: readonly Evidence[],
  replayFrames: readonly ReplayFrame[],
  retired?: boolean,
) => void;

interface SliceElements {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly storage: ProgramStore;
  selectedMission: MissionId;
  playerName: string;
  selectedRuleIndex: number | null;
  program: ProgramDocument;
  storageStatus?: string;
  storageStatusElement?: HTMLElement;
  saveTimer?: number;
}

interface RuleEditHistory {
  readonly rules: readonly RuleCard[];
  readonly undo: readonly RuleCard[][];
}

type DurationParseResult =
  | { readonly valid: true; readonly durationTicks: number | undefined }
  | { readonly valid: false; readonly message: string };

type PreBattleIssueSeverity = 'error' | 'warning';

interface PreBattleIssue {
  readonly severity: PreBattleIssueSeverity;
  readonly code: string;
  readonly message: string;
}

interface PreBattleCheck {
  readonly canStart: boolean;
  readonly issues: readonly PreBattleIssue[];
}

interface BattleMetricElements {
  readonly health: HTMLElement;
  readonly heat: HTMLElement;
  readonly ammo: HTMLElement;
  readonly active: HTMLElement;
}

interface BattleStatusElements {
  readonly root: HTMLElement;
  readonly status: HTMLParagraphElement;
  readonly announcement: HTMLParagraphElement;
  readonly eventLog: HTMLOListElement;
  readonly player: BattleMetricElements;
  readonly opponent: BattleMetricElements;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function button(label: string, className = 'slice-button'): HTMLButtonElement {
  const element = make('button', className);
  element.type = 'button';
  element.textContent = label;
  return element;
}

interface RankingRow {
  readonly rank_no: number;
  readonly display_name: string;
  readonly best_score: number;
}

function normalizeRankingRows(value: unknown): RankingRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const rank = Number(record.rank_no);
    const score = Number(record.best_score);
    const name = typeof record.display_name === 'string' ? record.display_name.trim() : '';
    if (!Number.isSafeInteger(rank) || rank < 1 || !Number.isSafeInteger(score) || name.length === 0) return [];
    return [{
      rank_no: rank,
      display_name: name.slice(0, MAX_PLAYER_NAME_LENGTH),
      best_score: score,
    }];
  }).slice(0, 10);
}

function rankingRowText(row: RankingRow): string {
  return `${row.rank_no}位　${row.display_name}　${row.best_score}点`;
}

function submissionWasAccepted(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0];
  return first !== null && typeof first === 'object' && (first as Record<string, unknown>).accepted === true;
}

function isValidPlayerName(value: string): boolean {
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_PLAYER_NAME_LENGTH;
}

function scrollToScreenTop(): void {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  if (typeof document !== 'undefined') {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}

function applyScreenMode(elements: SliceElements, phase: SlicePhase): void {
  elements.root.dataset.screen = phase;
  document.body.classList.toggle('robobon-battle-active', phase === 'battle');
  if (phase === 'battle' || phase === 'analysis' || phase === 'home') scrollToScreenTop();
}

function optionList<T extends string>(select: HTMLSelectElement, values: readonly T[], labels: Record<string, string>): void {
  for (const value of values) {
    const option = make('option');
    option.value = value;
    option.textContent = labels[value] ?? value;
    select.append(option);
  }
}

function cloneRules(rules: readonly RuleCard[]): RuleCard[] {
  return rules.map((rule, priority) => ({
    ...rule,
    priority,
    conditions: rule.conditions.map((condition) => ({ ...condition })),
  }));
}

function sameRules(left: readonly RuleCard[], right: readonly RuleCard[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createRuleEditHistory(rules: readonly RuleCard[]): RuleEditHistory {
  return { rules: cloneRules(rules), undo: [] };
}

function commitRuleEdit(history: RuleEditHistory, nextRules: readonly RuleCard[]): RuleEditHistory {
  const next = cloneRules(nextRules);
  if (sameRules(history.rules, next)) return history;
  return {
    rules: next,
    undo: [...history.undo, cloneRules(history.rules)].slice(-MAX_RULE_UNDO_STEPS),
  };
}

function undoRuleEdit(history: RuleEditHistory): RuleEditHistory {
  const previous = history.undo.at(-1);
  if (!previous) return history;
  return {
    rules: cloneRules(previous),
    undo: history.undo.slice(0, -1).map((rules) => cloneRules(rules)),
  };
}

function moveRuleCard(rules: readonly RuleCard[], index: number, direction: -1 | 1): RuleCard[] {
  const next = cloneRules(rules);
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return cloneRules(next);
}

function updateRuleCondition(rules: readonly RuleCard[], index: number, value: string): RuleCard[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= rules.length) return null;
  if (value !== 'always' && !Object.hasOwn(CONDITION_LABELS, value)) return null;
  const next = cloneRules(rules);
  next[index] = {
    ...next[index],
    conditions: value === 'always' ? [] : [{ id: value as RuleCard['conditions'][number]['id'] }],
  };
  return next;
}

function updateRuleAction(rules: readonly RuleCard[], index: number, value: string): RuleCard[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= rules.length) return null;
  if (!Object.hasOwn(ACTION_LABELS, value)) return null;
  const next = cloneRules(rules);
  next[index] = { ...next[index], action: value as RuleCard['action'] };
  return next;
}

function parseRuleDurationSeconds(rawValue: string): DurationParseResult {
  const raw = rawValue.trim();
  if (raw === '') return { valid: true, durationTicks: undefined };
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return { valid: false, message: '数字を入力してください。' };
  const tenths = Math.round(seconds * 10);
  if (Math.abs(seconds * 10 - tenths) > 1e-9) {
    return { valid: false, message: '0.1秒単位で入力してください。' };
  }
  const durationTicks = tenths * 6;
  if (!Number.isSafeInteger(durationTicks) || durationTicks < MIN_DURATION_TICKS || durationTicks > MAX_DURATION_TICKS) {
    return { valid: false, message: '0.1〜10.0秒の範囲で入力してください。' };
  }
  return { valid: true, durationTicks };
}

function durationSecondsLabel(durationTicks: number | undefined): string {
  return durationTicks === undefined ? '' : (durationTicks / 60).toFixed(1);
}

function inspectPreBattleRules(rules: readonly RuleCard[]): PreBattleCheck {
  const issues: PreBattleIssue[] = [];
  if (!Array.isArray(rules) || rules.length === 0) {
    return {
      canStart: false,
      issues: [{ severity: 'error', code: 'no-rules', message: '規則が1枚もありません。1枚以上追加してください。' }],
    };
  }
  if (rules.length > MAX_VERTICAL_SLICE_RULES) {
    issues.push({ severity: 'error', code: 'too-many-rules', message: `規則は${MAX_VERTICAL_SLICE_RULES}枚までです。` });
  }
  try {
    validateRuleSet(rules);
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'invalid-rule-set',
      message: error instanceof Error ? `この作戦は実行できません: ${error.message}` : 'この作戦は実行できません。入力を確認してください。',
    });
    return { canStart: false, issues };
  }

  if (!rules.some((rule) => rule.conditions.length === 0)) {
    issues.push({ severity: 'warning', code: 'no-fallback', message: 'どの条件にも当てはまらない時の行動がありません。何もしない刻みが発生します。' });
  }
  if (!rules.some((rule) => rule.action === 'fire-pulse')) {
    issues.push({ severity: 'warning', code: 'no-fire', message: '発射する規則がありません。攻撃せずに戦闘が終わる可能性があります。' });
  }
  return { canStart: !issues.some((issue) => issue.severity === 'error'), issues };
}

function renderPreBattleCheck(check: PreBattleCheck): HTMLElement {
  const panel = make('div', 'preflight-panel');
  panel.setAttribute('aria-labelledby', 'preflight-title');
  const title = make('h3');
  title.id = 'preflight-title';
  title.textContent = '開始前検査';
  const status = make('p', check.canStart ? 'preflight-status preflight-status--ready' : 'preflight-status preflight-status--blocked');
  status.textContent = check.canStart ? '開始できます。' : '開始できません。修正が必要です。';
  panel.append(title, status);
  if (check.issues.length > 0) {
    const list = make('ul', 'preflight-list');
    for (const issue of check.issues) {
      const item = make('li', `preflight-issue preflight-issue--${issue.severity}`);
      item.textContent = `${issue.severity === 'error' ? '実行不能' : '注意'}: ${issue.message}`;
      if (issue.severity === 'error') item.setAttribute('role', 'alert');
      list.append(item);
    }
    panel.append(list);
  }
  return panel;
}

function nextRuleId(rules: readonly RuleCard[]): string {
  const used = new Set(rules.map((rule) => rule.id));
  for (let index = 1; index <= MAX_VERTICAL_SLICE_RULES; index += 1) {
    const candidate = `rule-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `rule-${rules.length + 1}`;
}

/** Adds one editable card without allowing the UI to exceed the MVP cap. */
function addRuleCard(rules: readonly RuleCard[]): RuleCard[] {
  const next = cloneRules(rules);
  if (next.length >= MAX_VERTICAL_SLICE_RULES) return next;
  next.push({ id: nextRuleId(next), priority: next.length, conditions: [], action: 'stop' });
  return next;
}

function makeCombatant(id: number, x: number): CombatantState {
  return {
    id,
    x,
    y: 180,
    radius: 16,
    maxHealth: 100,
    health: 100,
    heat: 0,
    ammo: 6,
    fireCooldownRemaining: 0,
    overheatRemaining: 0,
    damageDealt: 0,
    active: true,
  };
}

function initialCombatState(maxTicks = MAX_BATTLE_TICKS): CombatState {
  return createCombatState({
    arena: ARENA,
    maxTicks,
    combatants: [makeCombatant(PLAYER_ID, 190), makeCombatant(ENEMY_ID, 430)],
  });
}

function findCombatant(state: CombatState, id: number): CombatantState {
  const combatant = state.combatants.find((candidate) => candidate.id === id);
  if (!combatant) throw new Error(`機体 ${id} が見つかりません`);
  return combatant;
}

function makeBattleMetric(parent: HTMLElement, label: string): HTMLElement {
  const row = make('div', 'battle-metric');
  const caption = make('dt');
  caption.textContent = label;
  const value = make('dd');
  value.textContent = '—';
  row.append(caption, value);
  parent.append(row);
  return value;
}

function makeBattleStateCard(title: string, headingId: string): { readonly card: HTMLElement; readonly metrics: BattleMetricElements } {
  const card = make('article', 'battle-state-card');
  const heading = make('h3');
  heading.id = headingId;
  heading.textContent = title;
  const metricsList = make('dl', 'battle-metric-list');
  const metrics: BattleMetricElements = {
    active: makeBattleMetric(metricsList, '稼働状態'),
    health: makeBattleMetric(metricsList, '耐久'),
    heat: makeBattleMetric(metricsList, '熱'),
    ammo: makeBattleMetric(metricsList, '弾数'),
  };
  card.append(heading, metricsList);
  return { card, metrics };
}

function createBattleStatusPanel(): BattleStatusElements {
  const root = make('section', 'battle-semantic');
  const title = make('h2');
  title.id = 'battle-status-title';
  title.textContent = '戦闘の状態';
  root.setAttribute('aria-labelledby', title.id);

  const status = make('p', 'battle-status');
  status.setAttribute('aria-live', 'off');
  status.textContent = '戦闘状態を読み込んでいます。';

  const stateGrid = make('div', 'battle-state-grid');
  const playerCard = makeBattleStateCard('自機（味方）', 'battle-player-title');
  const opponentCard = makeBattleStateCard('敵機', 'battle-opponent-title');
  stateGrid.append(playerCard.card, opponentCard.card);

  const eventSection = make('section', 'battle-events');
  eventSection.setAttribute('aria-labelledby', 'battle-events-title');
  const eventTitle = make('h3');
  eventTitle.id = 'battle-events-title';
  eventTitle.textContent = '直近の出来事';
  const eventLog = make('ol', 'battle-event-list');
  eventLog.setAttribute('aria-live', 'off');
  eventLog.textContent = 'まだ記録はありません。';
  eventSection.append(eventTitle, eventLog);

  const announcement = make('p', 'battle-announcement');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.textContent = '重要な出来事はここに表示します。';

  root.append(title, status, stateGrid, eventSection, announcement);
  return {
    root,
    status,
    announcement,
    eventLog,
    player: playerCard.metrics,
    opponent: opponentCard.metrics,
  };
}

function updateBattleStatus(panel: BattleStatusElements, state: CombatState): void {
  const player = findCombatant(state, PLAYER_ID);
  const opponent = findCombatant(state, ENEMY_ID);
  const playerMetrics = formatCombatantMetric(player);
  const opponentMetrics = formatCombatantMetric(opponent);
  panel.status.textContent = formatBattleStatus(state.tick, state.maxTicks, player, opponent);
  panel.player.active.textContent = playerMetrics.active;
  panel.player.health.textContent = playerMetrics.health;
  panel.player.heat.textContent = playerMetrics.heat;
  panel.player.ammo.textContent = playerMetrics.ammo;
  panel.opponent.active.textContent = opponentMetrics.active;
  panel.opponent.health.textContent = opponentMetrics.health;
  panel.opponent.heat.textContent = opponentMetrics.heat;
  panel.opponent.ammo.textContent = opponentMetrics.ammo;
}

function updateBattleEventLog(panel: BattleStatusElements, state: CombatState): string | null {
  const messages = state.events
    .slice(-8)
    .map((event) => battleEventText(event))
    .filter((message): message is string => message !== null);
  const visibleMessages = [...new Set(messages)].slice(-3);
  panel.eventLog.replaceChildren();
  if (visibleMessages.length === 0) {
    panel.eventLog.textContent = 'まだ記録はありません。';
    return null;
  }
  for (const message of visibleMessages) {
    const item = make('li');
    item.textContent = message;
    panel.eventLog.append(item);
  }
  return visibleMessages.at(-1) ?? null;
}

/** Converts the current combat state into the small, visible rule vocabulary. */
function factsFromCombat(state: CombatState): RuleFacts {
  const player = findCombatant(state, PLAYER_ID);
  const enemy = findCombatant(state, ENEMY_ID);
  const distanceSquared = squaredDistance(player, enemy);
  const enemyNear = distanceSquared <= 120n * 120n;
  const enemyInRange = distanceSquared <= 250n * 250n;
  const projectileWarning = state.projectiles.some(
    (projectile) => projectile.ownerId === ENEMY_ID && squaredDistance(projectile, player) <= 90n * 90n,
  );
  return {
    tick: state.tick,
    enemyVisible: player.active && enemy.active && distanceSquared <= 360n * 360n,
    enemyNear,
    enemyInRange,
    projectileWarning,
    ammoAvailable: player.ammo > 0,
    heatHigh: player.heat >= 70,
    boundaryDanger: player.x < 50 || player.x > 590 || player.y < 50 || player.y > 310,
    lineOfSight: true,
  };
}

function commandForSelection(selection: RuleSelection, state: CombatState): CombatCommand | null {
  const rule = selection.rule;
  if (!rule) return null;
  const player = findCombatant(state, PLAYER_ID);
  const enemy = findCombatant(state, ENEMY_ID);
  if (rule.action === 'fire-pulse') {
    return { kind: 'fire', ownerId: PLAYER_ID, heading: headingToPoint({ ...player, heading: 0 }, enemy), weapon: PLAYER_WEAPON };
  }
  if (rule.action === 'cool') return { kind: 'cool', ownerId: PLAYER_ID, amount: 25 };
  return null;
}

function enemyCommand(state: CombatState): CombatCommand | null {
  if (state.tick % 45 !== 0) return null;
  const enemy = findCombatant(state, ENEMY_ID);
  const player = findCombatant(state, PLAYER_ID);
  if (!enemy.active || !player.active) return null;
  return { kind: 'fire', ownerId: ENEMY_ID, heading: headingToPoint({ ...enemy, heading: 128 }, player), weapon: ENEMY_WEAPON };
}

function drawBattle(
  context: CanvasRenderingContext2D,
  state: CombatState,
  activeRuleId: string | null,
  options: BattleRenderOptions = {},
): void {
  drawBattleScene(context, state, activeRuleId, options);
}

const FLOW_STEPS: readonly { id: SlicePhase; label: string }[] = [
  { id: 'edit', label: '作戦を組む' },
  { id: 'battle', label: '自動戦闘を見る' },
  { id: 'analysis', label: '結果から直す' },
];

function renderFlowSteps(current: SlicePhase): HTMLElement {
  const nav = make('nav', 'flow-nav');
  nav.setAttribute('aria-label', 'ゲームの進み方');
  const list = make('ol', 'flow-nav__list');
  FLOW_STEPS.forEach((step, index) => {
    const item = make('li', `flow-nav__item${step.id === current ? ' flow-nav__item--current' : ''}`);
    if (step.id === current) item.setAttribute('aria-current', 'step');
    const number = make('span', 'flow-nav__number');
    number.textContent = `${index + 1}`;
    const label = make('span');
    label.textContent = step.label;
    item.append(number, label);
    list.append(item);
  });
  nav.append(list);
  return nav;
}

function renderHeader(content: HTMLElement, phase: Exclude<SlicePhase, 'home' | 'battle'>, elements: SliceElements): void {
  const heading = make('header', 'screen-header');
  const identity = make('div', 'screen-header__identity');
  const eyebrow = make('p', 'eyebrow');
  eyebrow.textContent = 'ロボボン';
  const title = make('h1');
  title.textContent = phase === 'edit' ? '1. 作戦を組む' : '戦闘結果';
  const description = make('p', 'screen-header__description');
  description.textContent = phase === 'edit'
    ? `${elements.playerName}さん、条件に合う最初のカードが実行されます。`
    : `${elements.playerName}さんの戦闘記録です。見えた事実から次を決めます。`;
  identity.append(eyebrow, title, description);
  const home = button('ホーム', 'header-home-button');
  home.addEventListener('click', () => mountHome(elements));
  heading.append(identity, home);
  content.append(heading, renderFlowSteps(phase));
}

function renderMissionPanel(
  mission: MissionSpec,
  stageId: MissionStageId,
  selectable: boolean,
  onChange?: (missionId: MissionId) => void,
): HTMLElement {
  const panel = make('section', 'mission-panel');
  const panelTitleId = `mission-panel-title-${mission.id}-${stageId}`;
  panel.setAttribute('aria-labelledby', panelTitleId);
  const title = make('h2');
  title.id = panelTitleId;
  title.textContent = `任務${mission.number}「${mission.title}」`;
  const question = make('p', 'mission-question');
  question.textContent = mission.question;
  const objective = make('p', 'slice-note');
  objective.textContent = `${mission.focus}を見る。${mission.objective}`;

  if (selectable && onChange) {
    const field = make('label', 'mission-select-field');
    const caption = make('span');
    caption.textContent = '任務を選ぶ';
    const select = make('select', 'mission-select');
    select.setAttribute('aria-label', '任務を選ぶ');
    for (const candidate of INTRO_MISSIONS) {
      const option = make('option');
      option.value = candidate.id;
      option.textContent = `任務${candidate.number}: ${candidate.title}`;
      option.selected = candidate.id === mission.id;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value as MissionId));
    field.append(caption, select);
    panel.append(field);
  }

  const current = make('p', 'mission-now');
  current.innerHTML = '<strong>今すること</strong>';
  current.append(document.createTextNode(` ${missionStage(mission, stageId).instruction}`));
  panel.append(title, question, objective, current);
  return panel;
}

function resultLabel(state: CombatState, retired: boolean): string {
  if (retired) return 'リタイア';
  if (state.outcome.winnerId === PLAYER_ID) return '自機の勝ち';
  if (state.outcome.winnerId === ENEMY_ID) return '敵機の勝ち';
  return '引き分け';
}

function resultReasonLabel(state: CombatState, retired: boolean): string {
  if (retired) return '戦闘を途中で終了しました。次の作戦を試せます。';
  if (state.outcome.reason === 'destruction') return 'どちらかの耐久が0になりました。';
  if (state.outcome.reason === 'time-limit') return '制限時間に達したため、耐久・熱・ダメージで決まりました。';
  return '同じ刻みに両方の耐久が0になりました。';
}

function buildHomeShareText(): string {
  return `ロボボンを試しました。条件と行動を組み、ロボットの自動戦闘を見て、結果から作戦を直すゲームです。${location.href}`;
}

function buildResultShareText(
  playerName: string,
  mission: MissionSpec,
  state: CombatState,
  retired: boolean,
): string {
  const player = findCombatant(state, PLAYER_ID);
  return `ロボボン 任務${mission.number}「${mission.title}」\n${playerName}の結果: ${resultLabel(state, retired)}\nスコア（自機が与えたダメージ）: ${player.damageDealt}点\n戦闘時間: ${(state.tick / 60).toFixed(1)}秒 / 自機の残り耐久: ${player.health}\n${location.href}`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = make('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('共有文をコピーできませんでした');
}

async function shareText(text: string, status: HTMLElement): Promise<void> {
  const shareNavigator = navigator as Navigator & {
    share?: (data: { readonly title: string; readonly text: string }) => Promise<void>;
  };
  try {
    if (shareNavigator.share) {
      await shareNavigator.share({ title: 'ロボボン', text });
      status.textContent = '共有画面を開きました。';
      return;
    }
    await copyText(text);
    status.textContent = '共有文をコピーしました。貼り付けて共有できます。';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      status.textContent = '共有を取り消しました。';
      return;
    }
    status.textContent = '共有できませんでした。もう一度お試しください。';
  }
}

async function callRankingRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error('ranking request failed');
  return data as T;
}

function renderRankingRows(list: HTMLOListElement, rows: readonly RankingRow[]): void {
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = make('li');
    empty.textContent = 'まだランキング記録がありません。';
    list.append(empty);
    return;
  }
  for (const row of rows) {
    const item = make('li');
    item.textContent = rankingRowText(row);
    list.append(item);
  }
}

async function submitAndLoadRanking(
  displayName: string,
  score: number,
  status: HTMLElement,
  list: HTMLOListElement,
): Promise<void> {
  let submissionAccepted = false;
  if (isValidPlayerName(displayName) && Number.isSafeInteger(score) && score >= 0) {
    status.textContent = 'ランキング送信中…';
    try {
      const submission = await callRankingRpc<unknown>('submit_score', {
        p_display_name: displayName,
        p_game_slug: GAME_SLUG,
        p_score: score,
        p_client_version: CLIENT_VERSION,
      });
      submissionAccepted = submissionWasAccepted(submission);
    } catch {
      // The ranking list is still useful when score submission is unavailable.
    }
  }

  try {
    const ranking = await callRankingRpc<unknown>('get_best_score_ranking', {
      p_game_slug: GAME_SLUG,
      p_limit: 10,
    });
    const rows = normalizeRankingRows(ranking);
    renderRankingRows(list, rows);
    status.textContent = submissionAccepted
      ? 'ランキングを更新しました。'
      : '今回の結果をランキングへ送信できませんでした。結果はこの画面で確認できます。';
  } catch {
    status.textContent = submissionAccepted
      ? '記録は送信しましたが、ランキングを表示できませんでした。'
      : 'ランキングを表示できませんでした。結果はこの画面で確認できます。';
    renderRankingRows(list, []);
  }
}

function makeExperimentFieldLink(): HTMLAnchorElement {
  const link = make('a', 'field-link');
  link.href = EXPERIMENT_FIELD_URL;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'カメレオンJPの実験場';
  return link;
}

function mountHome(elements: SliceElements): void {
  applyScreenMode(elements, 'home');
  elements.content.replaceChildren();

  const screen = make('section', 'screen home-screen');
  screen.setAttribute('aria-labelledby', 'home-title');

  const hero = make('header', 'home-hero');
  const eyebrow = make('p', 'eyebrow');
  eyebrow.textContent = '自動戦闘の作戦ゲーム';
  const title = make('h1');
  title.id = 'home-title';
  title.textContent = 'ロボボン';
  const lead = make('p', 'home-lead');
  lead.textContent = '条件と行動を組み、ロボットの自動戦闘を見て、結果から作戦を直します。';
  const endSummary = make('p', 'home-hero__end');
  endSummary.textContent = '1戦は、相手を倒す・制限時間になる・リタイアする、のいずれかで終了します。';
  hero.append(eyebrow, title, lead, endSummary);

  const explanation = make('section', 'home-explanation');
  explanation.setAttribute('aria-labelledby', 'home-explanation-title');
  const explanationTitle = make('h2');
  explanationTitle.id = 'home-explanation-title';
  explanationTitle.textContent = '最初にすること';
  const steps = make('ol', 'home-steps');
  for (const [number, text] of [
    ['1', '名前を入力して、任務を選ぶ'],
    ['2', '条件と行動のカードを上から確認する'],
    ['3', '自動戦闘を見て、1枚だけ直して再戦する'],
  ] as const) {
    const item = make('li');
    const badge = make('span', 'home-step__number');
    badge.textContent = number;
    const label = make('span');
    label.textContent = text;
    item.append(badge, label);
    steps.append(item);
  }
  const endCondition = make('p', 'home-end-condition');
  endCondition.innerHTML = '<strong>遊びの一巡</strong> 戦闘後は結果を確認し、カードを1枚だけ変えて再戦します。';
  explanation.append(explanationTitle, steps, endCondition);

  const missionSection = make('section', 'home-missions');
  missionSection.setAttribute('aria-labelledby', 'home-missions-title');
  const missionTitle = make('h2');
  missionTitle.id = 'home-missions-title';
  missionTitle.textContent = '最初の任務を選ぶ';
  const missionNote = make('p', 'home-section-note');
  missionNote.textContent = '選んだ任務は枠と「選択中」の表示で確認できます。';
  const missionChoices = make('div', 'mission-choices');
  missionChoices.setAttribute('role', 'group');
  missionChoices.setAttribute('aria-label', '任務の選択');
  const choiceButtons: HTMLButtonElement[] = [];
  const selectionStatus = make('p', 'selection-status');
  selectionStatus.setAttribute('role', 'status');

  const updateMissionChoice = (): void => {
    const mission = missionById(elements.selectedMission);
    choiceButtons.forEach((choice) => {
      const selected = choice.dataset.missionId === mission.id;
      choice.classList.toggle('mission-choice--selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
    selectionStatus.textContent = `選択中: 任務${mission.number}「${mission.title}」`;
  };

  for (const mission of INTRO_MISSIONS) {
    const choice = make('button', 'mission-choice');
    choice.type = 'button';
    choice.dataset.missionId = mission.id;
    choice.setAttribute('aria-pressed', 'false');
    const number = make('span', 'mission-choice__number');
    number.textContent = `任務${mission.number}`;
    const name = make('strong');
    name.textContent = mission.title;
    const question = make('span', 'mission-choice__question');
    question.textContent = mission.question;
    choice.append(number, name, question);
    choice.addEventListener('click', () => {
      elements.selectedMission = mission.id;
      updateMissionChoice();
    });
    choiceButtons.push(choice);
    missionChoices.append(choice);
  }
  updateMissionChoice();
  missionSection.append(missionTitle, missionNote, missionChoices, selectionStatus);

  const startSection = make('section', 'home-start');
  startSection.setAttribute('aria-labelledby', 'home-start-title');
  const startTitle = make('h2');
  startTitle.id = 'home-start-title';
  startTitle.textContent = 'プレイヤー名';
  const form = make('form', 'home-start__form');
  const nameField = make('label', 'player-name-field');
  const nameCaption = make('span');
  nameCaption.textContent = '名前を入力してください';
  const nameInput = make('input', 'player-name-input');
  nameInput.type = 'text';
  nameInput.name = 'playerName';
  nameInput.autocomplete = 'name';
  nameInput.maxLength = MAX_PLAYER_NAME_LENGTH;
  nameInput.placeholder = '名前を入力してください';
  nameInput.value = elements.playerName;
  nameInput.required = true;
  nameInput.setAttribute('aria-describedby', 'player-name-help');
  const nameHelp = make('span', 'field-help');
  nameHelp.id = 'player-name-help';
  nameHelp.textContent = '名前を入力するまで開始できません。';
  nameField.append(nameCaption, nameInput, nameHelp);
  const start = button('作戦を組み始める', 'slice-button slice-button--primary home-start-button');
  start.type = 'submit';
  start.disabled = !isValidPlayerName(nameInput.value);
  const nameStatus = make('p', 'selection-status');
  nameStatus.setAttribute('role', 'status');
  nameStatus.textContent = start.disabled ? '名前を入力してください。' : '開始できます。';

  const updateName = (): void => {
    elements.playerName = nameInput.value.trim();
    const valid = isValidPlayerName(nameInput.value);
    start.disabled = !valid;
    nameInput.setAttribute('aria-invalid', String(!valid));
    nameStatus.textContent = valid ? '開始できます。' : '名前を入力してください。';
  };
  nameInput.addEventListener('input', updateName);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    updateName();
    if (!isValidPlayerName(elements.playerName)) {
      nameInput.focus();
      return;
    }
    openEditorScreen(elements, DEFAULT_RULES);
  });
  form.append(nameField, start, nameStatus);
  startSection.append(startTitle, form);

  const homeActions = make('div', 'home-actions');
  const shareStatus = make('p', 'share-status');
  shareStatus.setAttribute('role', 'status');
  const share = button('友達に共有', 'slice-button slice-button--secondary');
  share.addEventListener('click', () => { void shareText(buildHomeShareText(), shareStatus); });
  const lab = makeExperimentFieldLink();
  homeActions.append(share, lab, shareStatus);

  screen.append(hero, missionSection, startSection, explanation, homeActions);
  elements.content.append(screen);
}

function storageError(error: unknown): string {
  return error instanceof Error ? error.message : '端末保存に失敗しました';
}

function setStorageStatus(elements: SliceElements, message: string): void {
  elements.storageStatus = message;
  elements.storageStatusElement?.replaceChildren(document.createTextNode(message));
}

async function saveCurrentProgram(elements: SliceElements): Promise<boolean> {
  try {
    await elements.storage.save(elements.program);
    const count = (await elements.storage.list()).length;
    setStorageStatus(elements, `端末へ保存しました（${count}/${MAX_PROGRAM_SLOTS}件）。端末保存は消えることがあります。`);
    return true;
  } catch (error) {
    setStorageStatus(elements, `端末へ保存できません: ${storageError(error)} 書き出しを使ってください。`);
    return false;
  }
}

function scheduleProgramSave(elements: SliceElements): void {
  if (elements.saveTimer !== undefined) window.clearTimeout(elements.saveTimer);
  elements.saveTimer = window.setTimeout(() => {
    elements.saveTimer = undefined;
    void saveCurrentProgram(elements);
  }, 500);
}

function cancelPendingProgramSave(elements: SliceElements): void {
  if (elements.saveTimer === undefined) return;
  window.clearTimeout(elements.saveTimer);
  elements.saveTimer = undefined;
}

async function flushPendingProgramSave(elements: SliceElements): Promise<boolean> {
  if (elements.saveTimer === undefined) return true;
  cancelPendingProgramSave(elements);
  return saveCurrentProgram(elements);
}

async function refreshProgramOptions(elements: SliceElements, select: HTMLSelectElement): Promise<void> {
  try {
    const programs = await elements.storage.list();
    const currentId = elements.program.id;
    select.replaceChildren();
    const empty = make('option');
    empty.value = '';
    empty.textContent = programs.length === 0 ? '保存済み作戦はありません' : '保存済み作戦を選ぶ';
    select.append(empty);
    for (const program of programs) {
      const option = make('option');
      option.value = program.id;
      option.textContent = `${program.name}（${new Date(program.updatedAt).toLocaleString('ja-JP')}）`;
      select.append(option);
    }
    select.value = programs.some((program) => program.id === currentId) ? currentId : '';
  } catch (error) {
    setStorageStatus(elements, `保存済み作戦を確認できません: ${storageError(error)}`);
  }
}

function mountProgramStoragePanel(
  elements: SliceElements,
  openEditor: (program: ProgramDocument) => void,
): HTMLElement {
  const panel = make('section', 'storage-panel');
  panel.setAttribute('aria-labelledby', 'storage-panel-title');
  const title = make('h3');
  title.id = 'storage-panel-title';
  title.textContent = '作戦の保存';
  const note = make('p', 'slice-note');
  note.textContent = elements.storage.mode === 'indexeddb'
    ? '端末のIndexedDBへ自動保存します。保存は端末・ブラウザに依存するため、重要な作戦は書き出してください。'
    : 'この環境では端末保存の代替を使います。重要な作戦は書き出してください。';

  const nameField = make('label', 'storage-name-field');
  const nameCaption = make('span');
  nameCaption.textContent = '作戦名';
  const nameInput = make('input', 'storage-name-input');
  nameInput.type = 'text';
  nameInput.maxLength = MAX_PROGRAM_NAME_LENGTH;
  nameInput.value = elements.program.name;
  nameInput.setAttribute('aria-label', '作戦名');
  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (name.length === 0 || name.length > MAX_PROGRAM_NAME_LENGTH) {
      nameInput.value = elements.program.name;
      setStorageStatus(elements, `作戦名は1〜${MAX_PROGRAM_NAME_LENGTH}文字で入力してください。`);
      return;
    }
    elements.program = { ...elements.program, name, updatedAt: new Date().toISOString() };
    setStorageStatus(elements, '作戦名を変更しました。');
    scheduleProgramSave(elements);
  });
  nameField.append(nameCaption, nameInput);

  const status = make('p', 'storage-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = elements.storageStatus ?? 'まだ端末へ保存していません。';
  elements.storageStatusElement = status;

  const actions = make('div', 'slice-actions storage-actions');
  const save = button('端末へ保存', 'slice-button slice-button--secondary');
  save.addEventListener('click', () => { void saveCurrentProgram(elements); });
  const duplicate = button('複製して編集', 'slice-button slice-button--secondary');
  duplicate.addEventListener('click', () => {
    const copied = copyProgram(elements.program);
    void elements.storage.save(copied).then(() => {
      elements.program = copied;
      setStorageStatus(elements, '作戦を複製しました。');
      openEditor(copied);
    }).catch((error: unknown) => {
      setStorageStatus(elements, `複製を保存できません: ${storageError(error)}`);
    });
  });
  const exportButton = button('JSONを書き出す', 'slice-button slice-button--quiet');
  exportButton.addEventListener('click', () => {
    try {
      const text = serializeProgram(elements.program);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = make('a');
      anchor.href = url;
      anchor.download = `${elements.program.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'robobon-program'}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStorageStatus(elements, 'JSONを書き出しました。iPhoneの「ファイル」に保存できます。');
    } catch (error) {
      setStorageStatus(elements, `書き出せません: ${storageError(error)}`);
    }
  });
  const deleteButton = button('端末保存を削除', 'slice-button slice-button--quiet');
  deleteButton.addEventListener('click', () => {
    cancelPendingProgramSave(elements);
    void elements.storage.delete(elements.program.id).then(() => {
      setStorageStatus(elements, '端末に保存したこの作戦を削除しました。編集中の作戦は残っています。');
      void refreshProgramOptions(elements, savedSelect);
    }).catch((error: unknown) => {
      setStorageStatus(elements, `端末保存を削除できません: ${storageError(error)}`);
    });
  });
  actions.append(save, duplicate, exportButton, deleteButton);

  const importField = make('label', 'storage-file-field');
  const importCaption = make('span');
  importCaption.textContent = 'JSONを読み込む';
  const importInput = make('input', 'storage-file-input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json,text/json';
  importInput.setAttribute('aria-label', '作戦JSONファイル');
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    if (file.size > MAX_PROGRAM_BYTES) {
      setStorageStatus(elements, '読み込めません: ファイルが256KBを超えています。');
      return;
    }
    void file.text().then((text) => {
      const parsed = parseProgramJson(text);
      if (!parsed.ok) {
        setStorageStatus(elements, `読み込めません: ${parsed.error}`);
        return;
      }
      return flushPendingProgramSave(elements).then((saved) => {
        if (!saved) return;
        return elements.storage.save(parsed.program).then(() => {
          elements.program = parsed.program;
          setStorageStatus(elements, parsed.migrated ? '旧形式を検査して新形式へ移行し、保存しました。' : 'JSONを検査して保存しました。');
          openEditor(parsed.program);
        });
      });
    }).catch((error: unknown) => {
      setStorageStatus(elements, `読み込めません: ${storageError(error)} 現在の保存は変更していません。`);
    });
  });
  importField.append(importCaption, importInput);

  const savedField = make('label', 'storage-file-field');
  const savedCaption = make('span');
  savedCaption.textContent = '保存済み作戦を読み込む';
  const savedSelect = make('select', 'storage-select');
  savedSelect.setAttribute('aria-label', '保存済み作戦');
  savedSelect.addEventListener('change', () => {
    const id = savedSelect.value;
    if (!id) return;
    void flushPendingProgramSave(elements).then((saved) => {
      if (!saved) return null;
      return elements.storage.get(id);
    }).then((program) => {
      if (!program) {
        setStorageStatus(elements, '選んだ作戦は見つかりません。');
        return;
      }
      elements.program = program;
      setStorageStatus(elements, '保存済み作戦を読み込みました。');
      openEditor(program);
    }).catch((error: unknown) => {
      setStorageStatus(elements, `読み込めません: ${storageError(error)} 現在の作戦は残っています。`);
    });
  });
  savedField.append(savedCaption, savedSelect);
  void refreshProgramOptions(elements, savedSelect);

  panel.append(title, note, nameField, actions, importField, savedField, status);
  return panel;
}

function mountEditor(
  elements: SliceElements,
  rules: RuleCard[],
  openBattle: (nextRules: RuleCard[]) => void,
  history = createRuleEditHistory(rules),
): void {
  applyScreenMode(elements, 'edit');
  elements.content.replaceChildren();
  renderHeader(elements.content, 'edit', elements);

  const currentRules = cloneRules(history.rules);
  const mission = missionById(elements.selectedMission);
  elements.program = updateProgramRules(elements.program, currentRules);
  const preflight = inspectPreBattleRules(currentRules);

  const section = make('section', 'screen editor-screen');
  section.setAttribute('aria-labelledby', 'slice-editor-title');
  const missionPanel = renderMissionPanel(mission, 'edit', false);
  const title = make('h2');
  title.id = 'slice-editor-title';
  title.textContent = '命令カード';
  const note = make('p', 'slice-note');
  note.textContent = `上から順に条件を確認し、最初に当てはまる行動を実行します。まずは1枚だけ変えて結果を比べます。`;
  const capacity = make('p', 'slice-capacity');
  capacity.setAttribute('aria-live', 'polite');
  capacity.textContent = `規則 ${currentRules.length} / ${MAX_VERTICAL_SLICE_RULES}`;
  const historyNote = make('p', 'slice-note');
  historyNote.setAttribute('aria-live', 'polite');
  historyNote.textContent = `変更履歴 ${history.undo.length}件。並べ替えはボタンで行います。`;
  const list = make('div', 'rule-list');
  const selectedRuleStatus = make('p', 'selection-status');
  selectedRuleStatus.setAttribute('role', 'status');
  selectedRuleStatus.textContent = elements.selectedRuleIndex === null
    ? 'カードをタップすると選択中として表示します。'
    : `${elements.selectedRuleIndex + 1}枚目を選択中です。`;

  const renderEdit = (nextRules: readonly RuleCard[]): void => {
    const nextHistory = commitRuleEdit(history, nextRules);
    elements.program = updateProgramRules(elements.program, nextHistory.rules);
    scheduleProgramSave(elements);
    mountEditor(elements, cloneRules(nextHistory.rules), openBattle, nextHistory);
  };

  currentRules.forEach((rule, index) => {
    const card = make('article', `rule-card${elements.selectedRuleIndex === index ? ' rule-card--selected' : ''}`);
    const cardTitleId = `rule-card-title-${rule.id}`;
    const cardDescriptionId = `rule-card-description-${rule.id}`;
    card.dataset.ruleId = rule.id;
    card.setAttribute('aria-labelledby', cardTitleId);
    card.setAttribute('aria-describedby', cardDescriptionId);
    const cardTop = make('div', 'rule-card__top');
    const number = make('span', 'rule-card__number');
    number.textContent = `優先 ${index + 1}`;
    const id = make('span', 'rule-card__id');
    id.id = cardTitleId;
    id.textContent = rule.id;
    const selected = make('span', 'rule-card__selected');
    selected.textContent = elements.selectedRuleIndex === index ? '選択中' : '';
    cardTop.append(number, id);
    cardTop.append(selected);

    const summary = make('p', 'rule-card__summary');
    summary.id = cardDescriptionId;
    summary.textContent = `${CONDITION_LABELS[rule.conditions[0]?.id ?? 'always']} → ${ACTION_LABELS[rule.action]}`;

    const controls = make('div', 'rule-card__controls');
    const conditionField = make('label', 'rule-field');
    const conditionCaption = make('span');
    conditionCaption.textContent = '条件';
    const condition = make('select', 'rule-select');
    condition.setAttribute('aria-label', `${index + 1}枚目の条件`);
    optionList(condition, Object.keys(CONDITION_LABELS), CONDITION_LABELS);
    condition.value = rule.conditions[0]?.id ?? 'always';
    condition.addEventListener('change', () => {
      elements.selectedRuleIndex = index;
      const next = updateRuleCondition(currentRules, index, condition.value);
      if (next) renderEdit(next);
    });
    conditionField.append(conditionCaption, condition);

    const actionField = make('label', 'rule-field');
    const actionCaption = make('span');
    actionCaption.textContent = 'すること';
    const action = make('select', 'rule-select');
    action.setAttribute('aria-label', `${index + 1}枚目の行動`);
    optionList(action, Object.keys(ACTION_LABELS), ACTION_LABELS);
    action.value = rule.action;
    action.addEventListener('change', () => {
      elements.selectedRuleIndex = index;
      const next = updateRuleAction(currentRules, index, action.value);
      if (next) renderEdit(next);
    });
    actionField.append(actionCaption, action);
    controls.append(conditionField, actionField);

    const details = make('details', 'rule-card__details');
    const detailsSummary = make('summary');
    detailsSummary.textContent = 'このカードの詳細設定';
    const durationField = make('label', 'rule-number-field');
    const durationCaption = make('span');
    durationCaption.textContent = '継続時間（秒）';
    const duration = make('input', 'rule-number');
    duration.type = 'number';
    duration.inputMode = 'decimal';
    duration.min = '0.1';
    duration.max = '10.0';
    duration.step = '0.1';
    duration.placeholder = '標準';
    duration.value = durationSecondsLabel(rule.durationTicks);
    const durationHelp = make('span', 'rule-input-help');
    durationHelp.textContent = '空欄は行動ごとの標準時間';
    const durationError = make('span', 'rule-input-error');
    durationError.id = `rule-duration-error-${rule.id}`;
    duration.setAttribute('aria-label', `${index + 1}枚目の継続時間（秒）`);
    duration.setAttribute('aria-describedby', durationError.id);
    duration.addEventListener('change', () => {
      const result = parseRuleDurationSeconds(duration.value);
      if (!result.valid) {
        duration.setCustomValidity(result.message);
        duration.setAttribute('aria-invalid', 'true');
        durationError.textContent = result.message;
        return;
      }
      duration.setCustomValidity('');
      duration.removeAttribute('aria-invalid');
      durationError.textContent = '';
      const next = cloneRules(currentRules);
      const { durationTicks: _previousDuration, ...withoutDuration } = next[index];
      next[index] = result.durationTicks === undefined
        ? withoutDuration
        : { ...withoutDuration, durationTicks: result.durationTicks };
      elements.selectedRuleIndex = index;
      renderEdit(next);
    });

    const reorder = make('div', 'rule-card__buttons');
    const up = button('上へ', 'slice-button slice-button--small');
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      elements.selectedRuleIndex = Math.max(0, index - 1);
      renderEdit(moveRuleCard(currentRules, index, -1));
    });
    const down = button('下へ', 'slice-button slice-button--small');
    down.disabled = index === currentRules.length - 1;
    down.addEventListener('click', () => {
      elements.selectedRuleIndex = Math.min(currentRules.length - 1, index + 1);
      renderEdit(moveRuleCard(currentRules, index, 1));
    });
    const remove = button('削除', 'slice-button slice-button--small slice-button--quiet');
    remove.disabled = currentRules.length <= 1;
    remove.addEventListener('click', () => {
      const next = currentRules.filter((_, itemIndex) => itemIndex !== index);
      elements.selectedRuleIndex = next.length === 0 ? null : Math.min(index, next.length - 1);
      renderEdit(next);
    });
    reorder.append(up, down, remove);
    details.append(detailsSummary, durationField, reorder);
    card.append(cardTop, summary, controls, details);
    card.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('select, input, button, summary')) return;
      elements.selectedRuleIndex = index;
      list.querySelectorAll<HTMLElement>('.rule-card').forEach((candidate, candidateIndex) => {
        const isSelected = candidateIndex === index;
        candidate.classList.toggle('rule-card--selected', isSelected);
        candidate.querySelector<HTMLElement>('.rule-card__selected')!.textContent = isSelected ? '選択中' : '';
      });
      selectedRuleStatus.textContent = `${index + 1}枚目を選択中です。`;
    });
    list.append(card);
  });

  const preflightPanel = renderPreBattleCheck(preflight);

  const actions = make('div', 'slice-actions');
  const add = button('規則を追加', 'slice-button slice-button--secondary');
  add.disabled = currentRules.length >= MAX_VERTICAL_SLICE_RULES;
  add.setAttribute('aria-describedby', 'rule-capacity-note');
  add.addEventListener('click', () => renderEdit(addRuleCard(currentRules)));
  const undo = button('元に戻す', 'slice-button slice-button--quiet');
  undo.disabled = history.undo.length === 0;
  undo.setAttribute('aria-label', '直前の作戦編集を元に戻す');
  undo.addEventListener('click', () => {
    const previous = undoRuleEdit(history);
    mountEditor(elements, cloneRules(previous.rules), openBattle, previous);
  });
  const start = button('この作戦で開始', 'slice-button slice-button--primary');
  start.textContent = '出撃する';
  start.disabled = !preflight.canStart || !isValidPlayerName(elements.playerName);
  start.setAttribute('aria-describedby', 'preflight-title');
  start.addEventListener('click', () => openBattle(cloneRules(currentRules)));
  const capacityNote = make('p', 'slice-note');
  capacityNote.id = 'rule-capacity-note';
  capacityNote.textContent = currentRules.length >= MAX_VERTICAL_SLICE_RULES
    ? `上限の${MAX_VERTICAL_SLICE_RULES}枚です。削除してから追加できます。`
    : 'カードをタップすると選択中の枠が付きます。細かな設定はカード内にあります。';
  actions.append(add, undo, start);
  const storageDetails = make('details', 'advanced-settings');
  const storageSummary = make('summary');
  storageSummary.textContent = '保存・読み込み（必要なときだけ）';
  const storagePanel = mountProgramStoragePanel(elements, (program) => {
    mountEditor(elements, cloneRules(program.rules), openBattle, createRuleEditHistory(program.rules));
  });
  storageDetails.append(storageSummary, storagePanel);
  section.append(missionPanel, title, note, capacity, historyNote, selectedRuleStatus, list, preflightPanel, capacityNote, actions, storageDetails);
  elements.content.append(section);
}

function mountBattle(elements: SliceElements, rules: RuleCard[], openAnalysis: OpenAnalysis): void {
  applyScreenMode(elements, 'battle');
  elements.content.replaceChildren();
  const mission = missionById(elements.selectedMission);
  const screen = make('section', 'screen battle-screen');
  screen.setAttribute('aria-labelledby', 'battle-screen-title');

  const header = make('header', 'battle-header');
  const identity = make('div', 'battle-header__identity');
  const eyebrow = make('p', 'eyebrow');
  eyebrow.textContent = `任務${mission.number}「${mission.title}」`;
  const title = make('h1');
  title.id = 'battle-screen-title';
  title.textContent = '自動戦闘';
  const player = make('p', 'battle-player-name');
  player.textContent = `${elements.playerName}さんの作戦`;
  identity.append(eyebrow, title, player);
  const pause = button('一時停止', 'slice-button slice-button--secondary battle-pause-button');
  pause.setAttribute('aria-pressed', 'false');
  pause.setAttribute('aria-label', '戦闘を一時停止');
  header.append(identity, pause);

  const nowDoing = make('section', 'now-doing');
  nowDoing.setAttribute('aria-labelledby', 'battle-now-title');
  const nowTitle = make('strong');
  nowTitle.id = 'battle-now-title';
  nowTitle.textContent = '今すること';
  const nowText = make('span');
  nowText.textContent = '画面を見て、光った行動と数値の変化を確認します。';
  nowDoing.append(nowTitle, nowText);

  const arena = make('div', 'battle-arena');
  const canvas = make('canvas', 'battle-canvas');
  canvas.width = ARENA.maxX;
  canvas.height = ARENA.maxY;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('戦闘Canvasを作成できません');
  const legend = make('p', 'battle-legend');
  legend.textContent = '丸い印 A1 = 自機　ひし形 E1 = 敵機　光る枠 = 現在の行動';
  arena.append(canvas, legend);

  const activeRule = make('p', 'battle-active-rule');
  activeRule.setAttribute('role', 'status');
  activeRule.setAttribute('aria-live', 'polite');
  activeRule.setAttribute('aria-atomic', 'true');
  activeRule.textContent = '実行前: 規則を確認します。';
  const battleStatus = createBattleStatusPanel();
  const controls = make('div', 'battle-controls');
  const speedControl = make('label', 'battle-control');
  const speedCaption = make('span', 'battle-control__caption');
  speedCaption.textContent = '速度';
  const speed = make('select', 'battle-select');
  speed.setAttribute('aria-label', '戦闘速度');
  for (const [value, label] of [['1', '1倍速'], ['2', '2倍速']] as const) {
    const option = make('option');
    option.value = value;
    option.textContent = label;
    speed.append(option);
  }
  speed.value = `${DEFAULT_BATTLE_SPEED}`;
  speedControl.append(speedCaption, speed);

  const qualityControl = make('label', 'battle-control');
  const qualityCaption = make('span', 'battle-control__caption');
  qualityCaption.textContent = '画質（停止中）';
  const quality = make('select', 'battle-select');
  quality.setAttribute('aria-label', '戦闘画質');
  for (const [value, label] of [['high', '高'], ['medium', '中'], ['low', '低']] as const) {
    const option = make('option');
    option.value = value;
    option.textContent = label;
    quality.append(option);
  }
  quality.value = 'high';
  quality.setAttribute('aria-describedby', 'battle-quality-note');
  qualityControl.append(qualityCaption, quality);

  const reducedControl = make('label', 'battle-control battle-control--check');
  const reducedMotion = make('input');
  reducedMotion.type = 'checkbox';
  reducedMotion.checked = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const reducedCaption = make('span');
  reducedCaption.textContent = '演出を減らす';
  reducedControl.append(reducedMotion, reducedCaption);
  const sound = button('音を開始', 'slice-button slice-button--quiet');
  sound.setAttribute('aria-pressed', 'false');
  const soundControl = make('div', 'battle-control battle-control--button');
  soundControl.append(sound);
  const qualityNote = make('p', 'battle-quality-note');
  qualityNote.id = 'battle-quality-note';
  qualityNote.textContent = '画質と演出は停止中に変更できます。勝敗と数値は変わりません。';
  controls.append(speedControl, soundControl);

  const pauseLayer = make('div', 'pause-layer');
  pauseLayer.hidden = true;
  const pauseDialog = make('section', 'pause-dialog');
  pauseDialog.setAttribute('role', 'dialog');
  pauseDialog.setAttribute('aria-modal', 'true');
  pauseDialog.setAttribute('aria-labelledby', 'pause-title');
  const pauseTitle = make('h2');
  pauseTitle.id = 'pause-title';
  pauseTitle.textContent = '一時停止';
  const pauseNote = make('p', 'slice-note');
  pauseNote.textContent = '時間は進んでいません。次の操作を選んでください。';
  const pauseMenu = make('div', 'pause-menu');
  const resume = button('再開', 'slice-button slice-button--primary');
  const howTo = button('遊び方', 'slice-button slice-button--secondary');
  const retire = button('リタイア', 'slice-button slice-button--quiet');
  pauseMenu.append(resume, howTo, retire);

  const helpPanel = make('div', 'pause-subpanel');
  helpPanel.hidden = true;
  const helpTitle = make('h3');
  helpTitle.textContent = '遊び方';
  const helpList = make('ol', 'pause-help-list');
  for (const text of [
    '作戦画面で「条件」と「すること」のカードを上から確認します。',
    '戦闘中はロボットを直接操作せず、光ったカードと耐久・熱・弾を見ます。',
    '結果画面で事実を確認し、カードを1枚だけ変えて再戦します。',
  ]) {
    const item = make('li');
    item.textContent = text;
    helpList.append(item);
  }
  const helpClose = button('一時停止へ戻る', 'slice-button slice-button--secondary');
  helpPanel.append(helpTitle, helpList, helpClose);

  const retirePanel = make('div', 'pause-subpanel');
  retirePanel.hidden = true;
  const retireTitle = make('h3');
  retireTitle.textContent = '戦闘を終わりますか？';
  const retireNote = make('p', 'slice-note');
  retireNote.textContent = 'ここまでの記録を結果画面に残します。';
  const retireActions = make('div', 'pause-menu');
  const retireConfirm = button('リタイアする', 'slice-button slice-button--danger');
  const retireCancel = button('続ける', 'slice-button slice-button--secondary');
  retireActions.append(retireConfirm, retireCancel);
  retirePanel.append(retireTitle, retireNote, retireActions);

  const settings = make('details', 'pause-settings');
  const settingsSummary = make('summary');
  settingsSummary.textContent = '表示設定';
  settings.append(settingsSummary, qualityControl, reducedControl, qualityNote);
  pauseDialog.append(pauseTitle, pauseNote, pauseMenu, helpPanel, retirePanel, settings);
  pauseLayer.append(pauseDialog);

  screen.append(header, nowDoing, arena, activeRule, battleStatus.root, controls, pauseLayer);
  elements.content.append(screen);

  let state = initialCombatState(mission.battleTicks);
  const replayFrames: ReplayFrame[] = [{ state: compactReplayState(state), ruleId: null }];
  const audio = new BattleAudio();
  let selection: RuleSelection | null = null;
  let evidence: Evidence[] = [];
  let paused = false;
  let pausedByBackground = false;
  let animationFrame = 0;
  let previousTime = performance.now();
  const clock = new FixedStepClock();

  const readQuality = (): BattleQuality => {
    const value = quality.value;
    return value === 'medium' || value === 'low' ? value : 'high';
  };

  const readSpeed = (): BattleSpeed => (speed.value === '2' ? 2 : 1);

  const renderOptions = (): BattleRenderOptions => ({
    quality: readQuality(),
    effects: reducedMotion.checked ? 'reduced' : undefined,
  });

  const updatePauseControls = (): void => {
    pause.textContent = paused ? '停止中' : '一時停止';
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', '戦闘を一時停止');
    quality.disabled = !paused;
  };

  const stopAnimation = (): void => {
    if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const pauseForBackground = (): void => {
    if (state.outcome.status === 'finished') return;
    paused = true;
    pausedByBackground = true;
    clock.pause();
    stopAnimation();
    audio.disable();
    sound.textContent = '音を開始';
    sound.setAttribute('aria-pressed', 'false');
    updatePauseControls();
    battleStatus.announcement.textContent = '背後へ移動したため停止しました。戻ったら「再開」を押してください。時間は進みません。';
  };

  const showPauseMenu = (mode: 'menu' | 'help' | 'retire' = 'menu'): void => {
    pauseLayer.hidden = false;
    pauseMenu.hidden = mode !== 'menu';
    helpPanel.hidden = mode !== 'help';
    retirePanel.hidden = mode !== 'retire';
    if (mode === 'menu') resume.focus();
    if (mode === 'help') helpClose.focus();
    if (mode === 'retire') retireCancel.focus();
  };

  const closePauseMenu = (): void => {
    pauseLayer.hidden = true;
    pause.focus();
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      pauseForBackground();
      return;
    }
    if (pausedByBackground) {
      battleStatus.announcement.textContent = '画面に戻りました。時間は進んでいません。「再開」を押すと続きます。';
      showPauseMenu();
    }
  };

  const onPageHide = (): void => {
    pauseForBackground();
  };

  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) pauseForBackground();
  };

  const cleanupLifecycle = (): void => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };

  updateBattleStatus(battleStatus, state);
  updateBattleEventLog(battleStatus, state);

  const recordEvents = (before: CombatState, after: CombatState): void => {
    const newEvents = after.events.slice(before.events.length);
    for (const event of newEvents) {
      const soundType = soundForEvent(event.type);
      if (soundType) audio.play(soundType);
    }
    evidence.push(...collectAnalysisEvidence(
      newEvents,
      selection?.rule?.id ?? null,
      Math.max(0, 3 - evidence.length),
    ));
    if (newEvents.length > 0) {
      updateBattleEventLog(battleStatus, after);
      const message = newEvents
        .map((event) => battleEventText(event))
        .filter((eventText): eventText is string => eventText !== null)
        .at(-1) ?? null;
      if (message) {
        battleStatus.announcement.textContent = message;
        nowText.textContent = `${message}。次に耐久・熱・弾の数字を確認します。`;
      }
    }
  };

  sound.addEventListener('click', () => {
    if (audio.isEnabled) {
      audio.disable();
      sound.textContent = '音を開始';
      sound.setAttribute('aria-pressed', 'false');
      battleStatus.announcement.textContent = '音を止めました。画面の表示はそのまま確認できます。';
      return;
    }
    void audio.enable().then((enabled) => {
      if (document.visibilityState === 'hidden' || pausedByBackground) {
        audio.disable();
        sound.textContent = '音を開始';
        sound.setAttribute('aria-pressed', 'false');
        return;
      }
      if (enabled) {
        sound.textContent = '音を止める';
        sound.setAttribute('aria-pressed', 'true');
        battleStatus.announcement.textContent = '音を開始しました。発射・命中・過熱だけを短く鳴らします。';
      } else {
        sound.textContent = '音を開始';
        sound.setAttribute('aria-pressed', 'false');
        battleStatus.announcement.textContent = 'このブラウザでは音を開始できません。画面表示で確認してください。';
      }
    });
  });

  const simulate = (): void => {
    const before = state;
    if (state.tick % RULE_EVALUATION_TICKS === 0 || selection === null) {
      selection = selectRule(rules, factsFromCombat(state));
      const nextRuleText = selection.rule
        ? `実行中: ${selection.rule.priority + 1}枚目「${ACTION_LABELS[selection.rule.action]}」`
        : '実行中: 該当する規則なし';
      if (activeRule.textContent !== nextRuleText) activeRule.textContent = nextRuleText;
      if (selection.rule) {
        const actionInstruction: Record<string, string> = {
          'face-target': '敵の方向へ向く動きを確認します。',
          'fire-pulse': '敵の耐久が下がるか、弾数が減るかを確認します。',
          retreat: '自機が敵から離れる動きを確認します。',
          strafe: '自機が横へ避ける動きを確認します。',
          cool: '自機の熱が下がるかを確認します。',
          explore: '自機が探索する動きを確認します。',
          stop: '自機が停止し、次の条件を待つことを確認します。',
        };
        nowText.textContent = `${selection.rule.priority + 1}枚目「${ACTION_LABELS[selection.rule.action]}」が選ばれました。${actionInstruction[selection.rule.action]}`;
      } else {
        nowText.textContent = '当てはまるカードがありません。実行中の変化と数値を確認します。';
      }
    }
    const commands: CombatCommand[] = [];
    const playerCommand = selection ? commandForSelection(selection, state) : null;
    if (playerCommand) commands.push(playerCommand);
    const enemy = enemyCommand(state);
    if (enemy) commands.push(enemy);
    state = stepCombat(state, commands);
    replayFrames.push({ state: compactReplayState(state), ruleId: selection?.rule?.id ?? null });
    if (replayFrames.length > MAX_REPLAY_FRAMES) replayFrames.shift();
    recordEvents(before, state);
    updateBattleStatus(battleStatus, state);
    if (state.outcome.status === 'finished') {
      stopAnimation();
      cleanupLifecycle();
      audio.dispose();
      openAnalysis(state, evidence, replayFrames);
    }
  };

  const frame = (now: number): void => {
    if (paused || state.outcome.status === 'finished') return;
    const elapsed = Math.max(0, now - previousTime);
    previousTime = now;
    clock.advance(scaleBattleElapsed(elapsed, readSpeed()), simulate);
    drawBattle(context, state, selection?.rule?.id ?? null, renderOptions());
    if (state.outcome.status === 'running') animationFrame = requestAnimationFrame(frame);
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  speed.addEventListener('change', () => {
    battleStatus.announcement.textContent = speed.value === '2'
      ? '速度を2倍にしました。1回の描画で進む刻み数の上限は変わりません。'
      : '速度を1倍に戻しました。';
  });
  quality.addEventListener('change', () => {
    if (!paused) return;
    drawBattle(context, state, selection?.rule?.id ?? null, renderOptions());
    battleStatus.announcement.textContent = `画質を${quality.value === 'low' ? '低' : quality.value === 'medium' ? '中' : '高'}に変更しました。勝敗と重要情報は変わりません。`;
  });
  reducedMotion.addEventListener('change', () => {
    drawBattle(context, state, selection?.rule?.id ?? null, renderOptions());
    battleStatus.announcement.textContent = reducedMotion.checked ? '演出を減らしました。重要な表示は残ります。' : '演出を標準へ戻しました。';
  });

  pause.addEventListener('click', () => {
    if (!paused) {
      paused = true;
      pausedByBackground = false;
      clock.pause();
      stopAnimation();
      updatePauseControls();
      battleStatus.announcement.textContent = '停止中。再開すると同じ刻みから続きます。';
    }
    showPauseMenu();
  });
  resume.addEventListener('click', () => {
    paused = false;
    pausedByBackground = false;
    clock.resume();
    previousTime = performance.now();
    updatePauseControls();
    closePauseMenu();
    battleStatus.announcement.textContent = '戦闘を再開しました。';
    nowText.textContent = '戦闘を再開しました。光った行動と数値の変化を確認します。';
    animationFrame = requestAnimationFrame(frame);
  });
  howTo.addEventListener('click', () => showPauseMenu('help'));
  helpClose.addEventListener('click', () => showPauseMenu());
  retire.addEventListener('click', () => showPauseMenu('retire'));
  retireCancel.addEventListener('click', () => showPauseMenu());
  retireConfirm.addEventListener('click', () => {
    stopAnimation();
    cleanupLifecycle();
    audio.dispose();
    closePauseMenu();
    openAnalysis(state, evidence, replayFrames, true);
  });
  updatePauseControls();
  drawBattle(context, state, null, renderOptions());
  animationFrame = requestAnimationFrame(frame);
}

function mountAnalysis(
  elements: SliceElements,
  rules: RuleCard[],
  state: CombatState,
  evidence: readonly Evidence[],
  replayFrames: readonly ReplayFrame[],
  retired = false,
): void {
  applyScreenMode(elements, 'analysis');
  elements.content.replaceChildren();
  renderHeader(elements.content, 'analysis', elements);
  const mission = missionById(elements.selectedMission);
  const player = findCombatant(state, PLAYER_ID);
  const opponent = findCombatant(state, ENEMY_ID);
  const section = make('section', 'screen result-screen');
  section.setAttribute('aria-labelledby', 'result-title');

  const hero = make('section', 'result-hero');
  const resultContext = make('p', 'eyebrow');
  resultContext.textContent = `任務${mission.number}「${mission.title}」 / ${elements.playerName}さん`;
  const title = make('h2');
  title.id = 'result-title';
  title.textContent = resultLabel(state, retired);
  const outcome = make('p', 'result-hero__outcome');
  outcome.textContent = resultReasonLabel(state, retired);
  hero.append(resultContext, title, outcome);

  const stats = make('dl', 'result-stats');
  const addStat = (label: string, value: string): void => {
    const item = make('div', 'result-stat');
    const caption = make('dt');
    caption.textContent = label;
    const number = make('dd');
    number.textContent = value;
    item.append(caption, number);
    stats.append(item);
  };
  addStat('戦闘時間', `${(state.tick / 60).toFixed(1)}秒`);
  addStat('自機の残り耐久', `${player.health} / ${player.maxHealth}`);
  addStat('敵機の残り耐久', `${opponent.health} / ${opponent.maxHealth}`);
  addStat('自機が与えたダメージ', `${player.damageDealt}`);

  const next = make('section', 'result-next');
  next.setAttribute('aria-labelledby', 'result-next-title');
  const nextTitle = make('h3');
  nextTitle.id = 'result-next-title';
  nextTitle.textContent = '次にすること';
  const nextText = make('p');
  nextText.textContent = '事実を1つ選び、命令カードを1枚だけ変えて再戦します。';
  next.append(nextTitle, nextText);

  const reason = make('p', 'slice-note');
  reason.textContent = '数字と出来事を見比べてから、次の変更を決めてください。';
  const heading = make('h3');
  heading.textContent = '観測できた事実';
  const list = make('ol', 'evidence-list');
  if (evidence.length === 0) {
    const empty = make('li');
    empty.textContent = 'この試作では、記録できる事実がまだありません。';
    list.append(empty);
  } else {
    for (const item of evidence) {
      const entry = make('li');
      entry.textContent = `${(item.tick / 60).toFixed(1)}秒 / ${evidenceKindLabel(item.kind)}: ${item.text}`;
      list.append(entry);
    }
  }

  const assessment = assessEvidence(evidence, state.events);
  const assessmentPanel = make('section', 'analysis-evidence');
  const assessmentHeading = make('h3');
  assessmentHeading.textContent = '証拠の確認';
  const assessmentStatus = make('p', `analysis-evidence__status analysis-evidence__status--${assessment.level}`);
  assessmentStatus.textContent = assessment.summary;
  const gapHeading = make('h4');
  gapHeading.textContent = 'まだ分からないこと';
  const gapList = make('ul', 'analysis-gap-list');
  if (assessment.gaps.length === 0) {
    const gap = make('li');
    gap.textContent = '今回の記録に含まれる主要な出来事は確認できました。原因はまだ断定しません。';
    gapList.append(gap);
  } else {
    for (const gap of assessment.gaps) {
      const item = make('li');
      item.textContent = gap.label;
      gapList.append(item);
    }
  }
  assessmentPanel.append(assessmentHeading, assessmentStatus, gapHeading, gapList);

  const experimentsPanel = make('section', 'analysis-experiments');
  const experimentsHeading = make('h3');
  experimentsHeading.textContent = '次に試す実験案';
  const experimentsNote = make('p', 'slice-note');
  experimentsNote.textContent = '案は提案だけです。規則を自動で書き換えず、1回の再戦で1か所だけ変えます。';
  const experimentsList = make('ol', 'analysis-experiment-list');
  for (const idea of createExperimentIdeas(assessment)) {
    const item = make('li', 'analysis-experiment');
    const itemTitle = make('strong');
    itemTitle.textContent = idea.title;
    const itemDetail = make('span');
    itemDetail.textContent = idea.detail;
    item.append(itemTitle, itemDetail);
    experimentsList.append(item);
  }
  experimentsPanel.append(experimentsHeading, experimentsNote, experimentsList);

  const timelinePanel = make('section', 'analysis-timeline');
  const timelineHeading = make('h3');
  timelineHeading.id = 'analysis-timeline-title';
  timelineHeading.textContent = '出来事の時間線';
  timelinePanel.setAttribute('aria-labelledby', timelineHeading.id);
  const timelineNote = make('p', 'slice-note');
  timelineNote.textContent = '出来事を選ぶと、その場面の3秒前から短く再生します。記録は直近80件まで表示します。';
  const timelineList = make('ol', 'battle-timeline');
  const entries = timelineEntries(state.events, replayFrames);
  if (entries.length === 0) {
    const empty = make('li');
    empty.textContent = '再生できる出来事はまだありません。';
    timelineList.append(empty);
  }

  const replayPanel = make('section', 'battle-replay');
  const replayHeading = make('h3');
  replayHeading.id = 'battle-replay-title';
  replayHeading.textContent = '選択した場面を再生';
  replayPanel.setAttribute('aria-labelledby', replayHeading.id);
  const replayCanvas = make('canvas', 'battle-replay-canvas');
  replayCanvas.width = ARENA.maxX;
  replayCanvas.height = ARENA.maxY;
  replayCanvas.setAttribute('role', 'img');
  replayCanvas.setAttribute('aria-label', '選択した出来事の3秒前からの戦闘再生');
  const replayContext = replayCanvas.getContext('2d');
  const replayStatus = make('p', 'battle-replay-status');
  replayStatus.setAttribute('role', 'status');
  replayStatus.setAttribute('aria-live', 'polite');
  replayStatus.textContent = '時間線の項目を選ぶと、ここで再生します。';
  replayPanel.append(replayHeading, replayCanvas, replayStatus);

  let replayAnimationFrame = 0;
  const stopReplay = (): void => {
    if (replayAnimationFrame !== 0) cancelAnimationFrame(replayAnimationFrame);
    replayAnimationFrame = 0;
  };
  const playReplay = (targetTick: number): void => {
    stopReplay();
    const replayWindow = replayContext ? selectReplayWindow(replayFrames, targetTick) : null;
    if (!replayWindow || !replayContext) {
      replayStatus.textContent = 'この出来事の再生データは保持されていません。';
      return;
    }
    const renderFrame = (frame: ReplayFrame): void => {
      drawBattle(replayContext, frame.state, frame.ruleId, { quality: 'low', effects: 'reduced' });
    };
    const lastFrame = replayWindow.frames.at(-1);
    if (!lastFrame) return;
    const rangeLabel = replayWindow.fullWindow ? '3秒前' : '記録開始時点';
    replayStatus.textContent = `${rangeLabel}（${(replayWindow.startTick / 60).toFixed(1)}秒）から再生中…`;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderFrame(lastFrame);
      replayStatus.textContent = `演出を減らす設定のため、${(replayWindow.targetTick / 60).toFixed(1)}秒の場面を表示しました。`;
      return;
    }
    let index = 0;
    const advance = (): void => {
      const frame = replayWindow.frames[index];
      if (frame) renderFrame(frame);
      if (index >= replayWindow.frames.length - 1) {
        replayAnimationFrame = 0;
        replayStatus.textContent = `${(replayWindow.targetTick / 60).toFixed(1)}秒の出来事を表示しました。`;
        return;
      }
      index += 1;
      replayAnimationFrame = requestAnimationFrame(advance);
    };
    if (typeof requestAnimationFrame !== 'function') {
      renderFrame(lastFrame);
      replayStatus.textContent = `${(replayWindow.targetTick / 60).toFixed(1)}秒の場面を表示しました。`;
      return;
    }
    replayAnimationFrame = requestAnimationFrame(advance);
  };

  for (const entry of entries) {
    const item = make('li', 'battle-timeline__entry');
    const replayButton = button(`${(entry.event.tick / 60).toFixed(1)}秒  ${entry.message}`, 'battle-timeline__button');
    replayButton.disabled = !entry.replayAvailable;
    replayButton.setAttribute('aria-label', entry.replayAvailable
      ? `${(entry.event.tick / 60).toFixed(1)}秒、${entry.message}。3秒前から再生`
      : `${(entry.event.tick / 60).toFixed(1)}秒、${entry.message}（再生データなし）`);
    replayButton.addEventListener('click', () => playReplay(entry.event.tick));
    item.append(replayButton);
    timelineList.append(item);
  }
  timelinePanel.append(timelineHeading, timelineNote, timelineList);

  const details = make('details', 'result-details');
  const detailsSummary = make('summary');
  detailsSummary.textContent = '詳しく見る：観測事実と時間線';
  const detailContent = make('div', 'result-details__content');
  detailContent.append(reason, heading, list, assessmentPanel, experimentsPanel, timelinePanel, replayPanel);
  details.append(detailsSummary, detailContent);

  const actions = make('div', 'slice-actions result-actions');
  const retry = button('同じ作戦で再戦', 'slice-button slice-button--primary');
  retry.addEventListener('click', () => {
    stopReplay();
    openBattleScreen(elements, rules);
  });
  const edit = button('規則を直して再戦', 'slice-button slice-button--secondary');
  edit.addEventListener('click', () => {
    stopReplay();
    openEditorScreen(elements, rules);
  });
  const home = button('ホームへ', 'slice-button slice-button--quiet');
  home.addEventListener('click', () => {
    stopReplay();
    mountHome(elements);
  });
  actions.append(retry, edit, home);

  const sharePanel = make('section', 'result-share');
  sharePanel.setAttribute('aria-labelledby', 'result-share-title');
  const shareTitle = make('h3');
  shareTitle.id = 'result-share-title';
  shareTitle.textContent = '結果を共有する';
  const shareMessage = buildResultShareText(elements.playerName, mission, state, retired);
  const shareLabel = make('label', 'result-share-label');
  shareLabel.htmlFor = 'robobon-result-share-text';
  shareLabel.textContent = '共有文（必要なら選択してコピーできます）';
  const shareTextArea = make('textarea', 'result-share-text');
  shareTextArea.id = shareLabel.htmlFor;
  shareTextArea.rows = 5;
  shareTextArea.readOnly = true;
  shareTextArea.value = shareMessage;
  shareTextArea.setAttribute('aria-label', '結果の共有文');
  const share = button('結果を共有', 'slice-button slice-button--secondary');
  const shareStatus = make('p', 'share-status');
  shareStatus.setAttribute('role', 'status');
  share.addEventListener('click', () => {
    void shareText(shareMessage, shareStatus);
  });
  const lab = makeExperimentFieldLink();
  const labNote = make('p', 'slice-note');
  labNote.textContent = 'もっと試す・作る場所';
  const rankingPanel = make('section', 'online-ranking-panel');
  rankingPanel.setAttribute('aria-labelledby', 'robobon-ranking-title');
  const rankingTitle = make('h4');
  rankingTitle.id = 'robobon-ranking-title';
  rankingTitle.textContent = '上位10名';
  const rankingList = make('ol', 'online-ranking-list');
  const rankingStatus = make('p', 'ranking-status');
  rankingStatus.setAttribute('role', 'status');
  rankingStatus.setAttribute('aria-live', 'polite');
  rankingStatus.textContent = 'ランキングを確認中…';
  rankingPanel.append(rankingTitle, rankingList, rankingStatus);
  sharePanel.append(shareTitle, shareLabel, shareTextArea, share, labNote, lab, rankingPanel, shareStatus);

  section.append(hero, stats, next, actions, sharePanel, details);
  elements.content.append(section);
  void submitAndLoadRanking(elements.playerName, player.damageDealt, rankingStatus, rankingList);
  scrollToScreenTop();
}

function openBattleScreen(elements: SliceElements, rules: readonly RuleCard[]): void {
  const stableRules = cloneRules(rules);
  mountBattle(elements, stableRules, (state, evidence, replayFrames, retired) => {
    mountAnalysis(elements, stableRules, state, evidence, replayFrames, retired);
  });
}

function openEditorScreen(elements: SliceElements, rules: readonly RuleCard[]): void {
  const stableRules = cloneRules(rules);
  elements.selectedRuleIndex = null;
  scrollToScreenTop();
  mountEditor(elements, stableRules, (nextRules) => openBattleScreen(elements, nextRules));
}

function mountVerticalSlice(root: HTMLElement): void {
  const section = make('section', 'vertical-slice');
  section.setAttribute('aria-labelledby', 'home-title');
  const content = make('div', 'vertical-slice__content');
  const elements: SliceElements = {
    root: section,
    content,
    storage: createProgramStore(),
    selectedMission: 'dock-approach',
    playerName: '',
    selectedRuleIndex: null,
    program: createProgramDocument(DEFAULT_RULES),
  };
  section.append(content);
  root.append(section);
  mountHome(elements);
}

export {
  DEFAULT_RULES,
  MAX_PLAYER_NAME_LENGTH,
  MAX_VERTICAL_SLICE_RULES,
  addRuleCard,
  buildResultShareText,
  commitRuleEdit,
  createRuleEditHistory,
  durationSecondsLabel,
  factsFromCombat,
  isValidPlayerName,
  mountVerticalSlice,
  moveRuleCard,
  normalizeRankingRows,
  parseRuleDurationSeconds,
  inspectPreBattleRules,
  renderPreBattleCheck,
  scaleBattleElapsed,
  submissionWasAccepted,
  updateRuleAction,
  updateRuleCondition,
  undoRuleEdit,
};

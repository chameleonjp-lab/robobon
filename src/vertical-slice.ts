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
import { drawBattleScene } from './rendering/battle-renderer';
import { BattleAudio, soundForEvent } from './audio/battle-audio';
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

type SlicePhase = 'edit' | 'battle' | 'analysis';

const ARENA = { minX: 0, maxX: 640, minY: 0, maxY: 360 } as const;
const RULE_EVALUATION_TICKS = 6;
const MAX_BATTLE_TICKS = 20 * 60;
const MAX_VERTICAL_SLICE_RULES = 8;
const MAX_RULE_UNDO_STEPS = 20;
const MIN_DURATION_TICKS = 6;
const MAX_DURATION_TICKS = 60 * 10;
const PLAYER_ID = 1;
const ENEMY_ID = 2;

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

interface Evidence {
  readonly tick: number;
  readonly text: string;
}

interface SliceElements {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly storage: ProgramStore;
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

function initialCombatState(): CombatState {
  return createCombatState({
    arena: ARENA,
    maxTicks: MAX_BATTLE_TICKS,
    combatants: [makeCombatant(PLAYER_ID, 190), makeCombatant(ENEMY_ID, 430)],
  });
}

function findCombatant(state: CombatState, id: number): CombatantState {
  const combatant = state.combatants.find((candidate) => candidate.id === id);
  if (!combatant) throw new Error(`機体 ${id} が見つかりません`);
  return combatant;
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

function drawBattle(context: CanvasRenderingContext2D, state: CombatState, activeRuleId: string | null): void {
  drawBattleScene(context, state, activeRuleId);
}

function renderHeader(content: HTMLElement, phase: SlicePhase): void {
  const heading = make('header', 'slice-heading');
  const eyebrow = make('p', 'eyebrow');
  eyebrow.textContent = 'P1-09 / P2-10 / GRAY VERTICAL SLICE';
  const title = make('h1');
  title.textContent = 'ロボボン';
  const description = make('p', 'slice-description');
  description.textContent = phase === 'edit'
    ? '規則を上から並べ、開始するとロボットが自動で戦います。'
    : phase === 'battle'
      ? '戦闘中は、現在選ばれている規則と理由を確認できます。'
      : '観測した事実から、規則を1か所だけ直して再戦します。';
  heading.append(eyebrow, title, description);
  content.append(heading);
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
  elements.content.replaceChildren();
  renderHeader(elements.content, 'edit');

  const currentRules = cloneRules(history.rules);
  elements.program = updateProgramRules(elements.program, currentRules);
  const preflight = inspectPreBattleRules(currentRules);

  const section = make('section', 'slice-panel');
  section.setAttribute('aria-labelledby', 'slice-editor-title');
  const title = make('h2');
  title.id = 'slice-editor-title';
  title.textContent = '作戦編集';
  const note = make('p', 'slice-note');
  note.textContent = `上にある規則から先に確認します。最大${MAX_VERTICAL_SLICE_RULES}枚です。まずは1枚だけ動かして、結果の違いを見ます。`;
  const capacity = make('p', 'slice-capacity');
  capacity.setAttribute('aria-live', 'polite');
  capacity.textContent = `規則 ${currentRules.length} / ${MAX_VERTICAL_SLICE_RULES}`;
  const historyNote = make('p', 'slice-note');
  historyNote.setAttribute('aria-live', 'polite');
  historyNote.textContent = `変更履歴 ${history.undo.length}件。ドラッグ操作は使わず、確定した順番を保持します。`;
  const list = make('div', 'rule-list');

  const renderEdit = (nextRules: readonly RuleCard[]): void => {
    const nextHistory = commitRuleEdit(history, nextRules);
    elements.program = updateProgramRules(elements.program, nextHistory.rules);
    scheduleProgramSave(elements);
    mountEditor(elements, cloneRules(nextHistory.rules), openBattle, nextHistory);
  };

  currentRules.forEach((rule, index) => {
    const card = make('article', 'rule-card');
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
    cardTop.append(number, id);

    const summary = make('p', 'rule-card__summary');
    summary.id = cardDescriptionId;
    summary.textContent = `条件: ${CONDITION_LABELS[rule.conditions[0]?.id ?? 'always']} / 行動: ${ACTION_LABELS[rule.action]}`;

    const controls = make('div', 'rule-card__controls');
    const condition = make('select', 'rule-select');
    condition.setAttribute('aria-label', `${index + 1}枚目の条件`);
    optionList(condition, Object.keys(CONDITION_LABELS), CONDITION_LABELS);
    condition.value = rule.conditions[0]?.id ?? 'always';
    condition.addEventListener('change', () => {
      const next = updateRuleCondition(currentRules, index, condition.value);
      if (next) renderEdit(next);
    });

    const action = make('select', 'rule-select');
    action.setAttribute('aria-label', `${index + 1}枚目の行動`);
    optionList(action, Object.keys(ACTION_LABELS), ACTION_LABELS);
    action.value = rule.action;
    action.addEventListener('change', () => {
      const next = updateRuleAction(currentRules, index, action.value);
      if (next) renderEdit(next);
    });

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
      renderEdit(next);
    });

    const up = button('上へ', 'slice-button slice-button--small');
    up.disabled = index === 0;
    up.addEventListener('click', () => renderEdit(moveRuleCard(currentRules, index, -1)));
    const down = button('下へ', 'slice-button slice-button--small');
    down.disabled = index === currentRules.length - 1;
    down.addEventListener('click', () => renderEdit(moveRuleCard(currentRules, index, 1)));
    const remove = button('削除', 'slice-button slice-button--small slice-button--quiet');
    remove.disabled = currentRules.length <= 1;
    remove.addEventListener('click', () => {
      const next = currentRules.filter((_, itemIndex) => itemIndex !== index);
      renderEdit(next);
    });

    controls.append(condition, action, durationField, up, down, remove);
    card.append(cardTop, summary, controls);
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
  start.disabled = !preflight.canStart;
  start.setAttribute('aria-describedby', 'preflight-title');
  start.addEventListener('click', () => openBattle(cloneRules(currentRules)));
  const capacityNote = make('p', 'slice-note');
  capacityNote.id = 'rule-capacity-note';
  capacityNote.textContent = currentRules.length >= MAX_VERTICAL_SLICE_RULES
    ? `上限の${MAX_VERTICAL_SLICE_RULES}枚です。削除してから追加できます。`
    : 'カードはタップで選び、上下ボタンで優先順位を変えます。';
  actions.append(add, undo, start);
  const storagePanel = mountProgramStoragePanel(elements, (program) => {
    mountEditor(elements, cloneRules(program.rules), openBattle, createRuleEditHistory(program.rules));
  });
  section.append(title, note, capacity, historyNote, storagePanel, list, preflightPanel, capacityNote, actions);
  elements.content.append(section);
}

function mountBattle(elements: SliceElements, rules: RuleCard[], openAnalysis: (state: CombatState, evidence: readonly Evidence[]) => void): void {
  elements.content.replaceChildren();
  renderHeader(elements.content, 'battle');
  const section = make('section', 'slice-panel slice-panel--battle');
  const canvas = make('canvas', 'battle-canvas');
  canvas.width = ARENA.maxX;
  canvas.height = ARENA.maxY;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'ロボット2機の自動戦闘');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('戦闘Canvasを作成できません');
  const activeRule = make('p', 'battle-active-rule');
  activeRule.setAttribute('aria-live', 'polite');
  const status = make('p', 'slice-note');
  status.textContent = '開始中。規則を上から確認しています。音はオフです。';
  const controls = make('div', 'slice-actions');
  const pause = button('停止', 'slice-button slice-button--secondary');
  const sound = button('音を開始', 'slice-button slice-button--quiet');
  sound.setAttribute('aria-pressed', 'false');
  const edit = button('記録して編集へ戻る', 'slice-button slice-button--quiet');
  controls.append(pause, sound, edit);
  section.append(canvas, activeRule, status, controls);
  elements.content.append(section);

  let state = initialCombatState();
  const audio = new BattleAudio();
  let selection: RuleSelection | null = null;
  let evidence: Evidence[] = [];
  let paused = false;
  let animationFrame = 0;
  let previousTime = performance.now();
  const clock = new FixedStepClock();

  const recordEvents = (before: CombatState, after: CombatState): void => {
    const newEvents = after.events.slice(before.events.length);
    for (const event of newEvents) {
      const soundType = soundForEvent(event.type);
      if (soundType) audio.play(soundType);
      if (evidence.length >= 2) continue;
      if (event.type === 'PROJECTILE_FIRED' && event.sourceId === PLAYER_ID) {
        evidence.push({ tick: event.tick, text: `${selection?.rule?.id ?? '規則なし'}が発射を選びました` });
      } else if (event.type === 'HIT_CONFIRMED') {
        evidence.push({ tick: event.tick, text: `弾が機体${event.targetId}へ命中しました` });
      } else if (event.type === 'ACTION_UNAVAILABLE' && event.sourceId === PLAYER_ID) {
        evidence.push({ tick: event.tick, text: `発射できませんでした（${event.reason ?? '理由不明'}）` });
      }
    }
  };

  sound.addEventListener('click', () => {
    if (audio.isEnabled) {
      audio.disable();
      sound.textContent = '音を開始';
      sound.setAttribute('aria-pressed', 'false');
      status.textContent = '音を止めました。画面の表示はそのまま確認できます。';
      return;
    }
    void audio.enable().then((enabled) => {
      if (enabled) {
        sound.textContent = '音を止める';
        sound.setAttribute('aria-pressed', 'true');
        status.textContent = '音を開始しました。発射・命中・過熱だけを短く鳴らします。';
      } else {
        sound.textContent = '音を開始';
        sound.setAttribute('aria-pressed', 'false');
        status.textContent = 'このブラウザでは音を開始できません。画面表示で確認してください。';
      }
    });
  });

  const simulate = (): void => {
    const before = state;
    if (state.tick % RULE_EVALUATION_TICKS === 0 || selection === null) {
      selection = selectRule(rules, factsFromCombat(state));
      activeRule.textContent = selection.rule
        ? `実行中: ${selection.rule.id} / ${ACTION_LABELS[selection.rule.action]}`
        : '実行中: 該当する規則なし';
    }
    const commands: CombatCommand[] = [];
    const playerCommand = selection ? commandForSelection(selection, state) : null;
    if (playerCommand) commands.push(playerCommand);
    const enemy = enemyCommand(state);
    if (enemy) commands.push(enemy);
    state = stepCombat(state, commands);
    recordEvents(before, state);
    const player = findCombatant(state, PLAYER_ID);
    const opponent = findCombatant(state, ENEMY_ID);
    status.textContent = `刻み ${state.tick} / ${MAX_BATTLE_TICKS}　自機 耐久${player.health} 熱${player.heat} 弾${player.ammo}　敵 耐久${opponent.health}`;
    if (state.outcome.status === 'finished') {
      cancelAnimationFrame(animationFrame);
      audio.dispose();
      openAnalysis(state, evidence);
    }
  };

  const frame = (now: number): void => {
    if (paused || state.outcome.status === 'finished') return;
    const elapsed = Math.min(100, Math.max(0, now - previousTime));
    previousTime = now;
    clock.advance(elapsed, simulate);
    drawBattle(context, state, selection?.rule?.id ?? null);
    if (state.outcome.status === 'running') animationFrame = requestAnimationFrame(frame);
  };

  pause.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
      clock.pause();
      pause.textContent = '再開';
      status.textContent = '停止中。再開すると同じ刻みから続きます。';
    } else {
      clock.resume();
      previousTime = performance.now();
      pause.textContent = '停止';
      animationFrame = requestAnimationFrame(frame);
    }
  });
  edit.addEventListener('click', () => {
    cancelAnimationFrame(animationFrame);
    audio.dispose();
    paused = true;
    elements.content.replaceChildren();
    mountEditor(elements, cloneRules(rules), (nextRules) => mountBattle(elements, nextRules, openAnalysis));
  });
  drawBattle(context, state, null);
  animationFrame = requestAnimationFrame(frame);
}

function mountAnalysis(elements: SliceElements, rules: RuleCard[], state: CombatState, evidence: readonly Evidence[]): void {
  elements.content.replaceChildren();
  renderHeader(elements.content, 'analysis');
  const section = make('section', 'slice-panel');
  const title = make('h2');
  title.textContent = '戦闘結果';
  const outcome = make('p', 'analysis-outcome');
  outcome.textContent = state.outcome.winnerId === null ? '引き分け' : state.outcome.winnerId === PLAYER_ID ? '自機の勝ち' : '敵の勝ち';
  const reason = make('p', 'slice-note');
  reason.textContent = state.outcome.reason === 'destruction' ? '耐久が0になりました。' : state.outcome.reason === 'time-limit' ? '時間切れの比較で決まりました。' : '同じ刻みに両方の耐久が0になりました。';
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
      entry.textContent = `${(item.tick / 60).toFixed(1)}秒: ${item.text}`;
      list.append(entry);
    }
  }
  const actions = make('div', 'slice-actions');
  const retry = button('規則を直して再戦', 'slice-button slice-button--primary');
  retry.addEventListener('click', () => mountEditor(elements, cloneRules(rules), (nextRules) => mountBattle(elements, nextRules, (nextState, nextEvidence) => mountAnalysis(elements, nextRules, nextState, nextEvidence))));
  const edit = button('作戦編集へ戻る', 'slice-button slice-button--secondary');
  edit.addEventListener('click', () => mountEditor(elements, cloneRules(rules), (nextRules) => mountBattle(elements, nextRules, (nextState, nextEvidence) => mountAnalysis(elements, nextRules, nextState, nextEvidence))));
  actions.append(retry, edit);
  section.append(title, outcome, reason, heading, list, actions);
  elements.content.append(section);
}

function mountVerticalSlice(root: HTMLElement): void {
  const section = make('section', 'vertical-slice');
  section.setAttribute('aria-labelledby', 'vertical-slice-title');
  const content = make('div', 'vertical-slice__content');
  const elements: SliceElements = {
    root: section,
    content,
    storage: createProgramStore(),
    program: createProgramDocument(DEFAULT_RULES),
  };
  const startEditor = (rules: RuleCard[]): void => {
    mountEditor(elements, rules, (nextRules) => mountBattle(elements, nextRules, (state, evidence) => mountAnalysis(elements, nextRules, state, evidence)));
  };
  startEditor(cloneRules(DEFAULT_RULES));
  section.append(content);
  root.append(section);
}

export {
  DEFAULT_RULES,
  MAX_VERTICAL_SLICE_RULES,
  addRuleCard,
  commitRuleEdit,
  createRuleEditHistory,
  durationSecondsLabel,
  factsFromCombat,
  mountVerticalSlice,
  moveRuleCard,
  parseRuleDurationSeconds,
  inspectPreBattleRules,
  renderPreBattleCheck,
  updateRuleAction,
  updateRuleCondition,
  undoRuleEdit,
};

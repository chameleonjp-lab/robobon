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
import { selectRule, type RuleCard, type RuleFacts, type RuleSelection } from './simulation/rules';
import { squaredDistance } from './simulation/geometry';

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
}

interface RuleEditHistory {
  readonly rules: readonly RuleCard[];
  readonly undo: readonly RuleCard[][];
}

type DurationParseResult =
  | { readonly valid: true; readonly durationTicks: number | undefined }
  | { readonly valid: false; readonly message: string };

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
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b1118';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgb(159 196 214 / 18%)';
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.strokeStyle = '#8bb4c7';
  context.strokeRect(1, 1, width - 2, height - 2);

  for (const projectile of state.projectiles) {
    context.fillStyle = projectile.ownerId === PLAYER_ID ? '#d9ffff' : '#ffd3a8';
    context.beginPath();
    context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    context.fill();
  }

  for (const combatant of state.combatants) {
    context.save();
    context.globalAlpha = combatant.active ? 1 : 0.28;
    context.fillStyle = combatant.id === PLAYER_ID ? '#36c6d2' : '#f39461';
    context.beginPath();
    context.arc(combatant.x, combatant.y, combatant.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#f8fafc';
    context.lineWidth = activeRuleId && combatant.id === PLAYER_ID ? 3 : 1;
    context.stroke();
    context.fillStyle = '#0b1118';
    context.fillRect(combatant.x - 5, combatant.y - 3, 10, 6);
    context.restore();
  }
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

function mountEditor(
  elements: SliceElements,
  rules: RuleCard[],
  openBattle: (nextRules: RuleCard[]) => void,
  history = createRuleEditHistory(rules),
): void {
  elements.content.replaceChildren();
  renderHeader(elements.content, 'edit');

  const currentRules = cloneRules(history.rules);

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
  start.addEventListener('click', () => openBattle(cloneRules(currentRules)));
  const capacityNote = make('p', 'slice-note');
  capacityNote.id = 'rule-capacity-note';
  capacityNote.textContent = currentRules.length >= MAX_VERTICAL_SLICE_RULES
    ? `上限の${MAX_VERTICAL_SLICE_RULES}枚です。削除してから追加できます。`
    : 'カードはタップで選び、上下ボタンで優先順位を変えます。';
  actions.append(add, undo, start);
  section.append(title, note, capacity, historyNote, list, capacityNote, actions);
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
  status.textContent = '開始中。規則を上から確認しています。';
  const controls = make('div', 'slice-actions');
  const pause = button('停止', 'slice-button slice-button--secondary');
  const edit = button('記録して編集へ戻る', 'slice-button slice-button--quiet');
  controls.append(pause, edit);
  section.append(canvas, activeRule, status, controls);
  elements.content.append(section);

  let state = initialCombatState();
  let selection: RuleSelection | null = null;
  let evidence: Evidence[] = [];
  let paused = false;
  let animationFrame = 0;
  let previousTime = performance.now();
  const clock = new FixedStepClock();

  const recordEvents = (before: CombatState, after: CombatState): void => {
    const newEvents = after.events.slice(before.events.length);
    for (const event of newEvents) {
      if (evidence.length >= 2) break;
      if (event.type === 'PROJECTILE_FIRED' && event.sourceId === PLAYER_ID) {
        evidence.push({ tick: event.tick, text: `${selection?.rule?.id ?? '規則なし'}が発射を選びました` });
      } else if (event.type === 'HIT_CONFIRMED') {
        evidence.push({ tick: event.tick, text: `弾が機体${event.targetId}へ命中しました` });
      } else if (event.type === 'ACTION_UNAVAILABLE' && event.sourceId === PLAYER_ID) {
        evidence.push({ tick: event.tick, text: `発射できませんでした（${event.reason ?? '理由不明'}）` });
      }
    }
  };

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
  const elements: SliceElements = { root: section, content };
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
  updateRuleAction,
  updateRuleCondition,
  undoRuleEdit,
};

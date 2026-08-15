import { MAX_HEAT, type CombatEvent, type CombatState, type CombatantState, type ProjectileState } from '../simulation/combat';

/** The first representative arena uses a fixed, full-scene camera. */
export const BATTLE_RENDER_SIZE = { width: 640, height: 360 } as const;

export type RobotSide = 'ally' | 'enemy';

export interface RenderPoint {
  readonly x: number;
  readonly y: number;
}

export interface DirectionToTarget extends RenderPoint {
  readonly angle: number;
}

export type BattleEffectMode = 'full' | 'reduced';
export type BattleQuality = 'high' | 'medium' | 'low';

export interface BattleRenderOptions {
  readonly effects?: BattleEffectMode;
  readonly quality?: BattleQuality;
}

export interface BattleQualitySettings {
  readonly scorchMarkLimit: number;
  readonly effects: BattleEffectMode;
}

export const BATTLE_QUALITY_SETTINGS: Record<BattleQuality, BattleQualitySettings> = {
  high: { scorchMarkLimit: 24, effects: 'full' },
  medium: { scorchMarkLimit: 12, effects: 'full' },
  low: { scorchMarkLimit: 0, effects: 'reduced' },
};

export function battleQualitySettings(quality: BattleQuality): BattleQualitySettings {
  return { ...BATTLE_QUALITY_SETTINGS[quality] };
}

export const EFFECT_WINDOWS = {
  muzzleFlash: 3,
  impact: 8,
  smoke: 9,
} as const;

const COLORS = {
  background: '#0B1118',
  backgroundLight: '#1B2B35',
  grid: 'rgb(159 196 214 / 15%)',
  border: '#8BB4C7',
  panel: '#20323A',
  panelLine: '#597C87',
  panelRepair: '#B7C4A8',
  text: '#F2F6F8',
  ally: '#46D9E8',
  allyLight: '#D9FFFF',
  enemy: '#FF9A5C',
  enemyLight: '#FFF0DD',
  mechanic: '#15212A',
  mechanicLine: '#6C8794',
  rule: '#C4A7FF',
  warning: '#FFB84D',
  shadow: 'rgb(0 0 0 / 34%)',
} as const;

const ROBOT_SILHOUETTES: Record<RobotSide, readonly RenderPoint[]> = {
  ally: [
    { x: -20, y: -12 },
    { x: 11, y: -12 },
    { x: 20, y: -4 },
    { x: 17, y: 13 },
    { x: -17, y: 13 },
  ],
  enemy: [
    { x: 21, y: 0 },
    { x: 8, y: -15 },
    { x: -16, y: -11 },
    { x: -20, y: 0 },
    { x: -14, y: 12 },
    { x: 9, y: 14 },
  ],
};

/** Returns a fresh copy so render helpers cannot mutate the design contract. */
export function robotSilhouette(side: RobotSide): RenderPoint[] {
  return ROBOT_SILHOUETTES[side].map((point) => ({ ...point }));
}

export function robotSideForId(id: number): RobotSide {
  return id === 1 ? 'ally' : 'enemy';
}

/**
 * The combat state intentionally stores no presentation heading. The representative
 * renderer derives a stable direction from the opposing unit, matching the visible
 * intent of the fire command without changing the deterministic simulation state.
 */
export function directionToTarget(
  from: Pick<CombatantState, 'id' | 'x' | 'y'>,
  target: Pick<CombatantState, 'id' | 'x' | 'y'>,
): DirectionToTarget {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    const x = from.id < target.id ? 1 : -1;
    return { x, y: 0, angle: x > 0 ? 0 : Math.PI };
  }
  return { x: dx / length, y: dy / length, angle: Math.atan2(dy, dx) };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function isEffectVisible(currentTick: number, eventTick: number, maxAge: number): boolean {
  const age = currentTick - eventTick;
  return age >= 0 && age <= maxAge;
}

function pathFromPoints(context: CanvasRenderingContext2D, points: readonly RenderPoint[]): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function drawDockPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.fillStyle = COLORS.panel;
  context.fillRect(x, y, width, height);
  context.strokeStyle = COLORS.panelLine;
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.strokeStyle = 'rgb(183 196 168 / 50%)';
  context.beginPath();
  context.moveTo(x + 10, y + 10);
  context.lineTo(x + width - 10, y + 10);
  context.stroke();
  context.fillStyle = COLORS.panelRepair;
  context.fillRect(x + 13, y + height - 13, Math.min(width - 26, 34), 3);
}

function drawArena(context: CanvasRenderingContext2D): void {
  const gradient = context.createLinearGradient(0, 0, BATTLE_RENDER_SIZE.width, BATTLE_RENDER_SIZE.height);
  gradient.addColorStop(0, COLORS.backgroundLight);
  gradient.addColorStop(1, COLORS.background);
  context.fillStyle = gradient;
  context.fillRect(0, 0, BATTLE_RENDER_SIZE.width, BATTLE_RENDER_SIZE.height);

  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  for (let x = 0; x <= BATTLE_RENDER_SIZE.width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, BATTLE_RENDER_SIZE.height);
    context.stroke();
  }
  for (let y = 0; y <= BATTLE_RENDER_SIZE.height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(BATTLE_RENDER_SIZE.width, y);
    context.stroke();
  }

  // Reused scrap is deliberately static: the arena reads as a test dock, not a war zone.
  drawDockPanel(context, 42, 42, 126, 70);
  drawDockPanel(context, 472, 248, 126, 70);
  context.strokeStyle = 'rgb(255 184 77 / 75%)';
  context.lineWidth = 2;
  context.setLineDash([7, 6]);
  context.strokeRect(253, 132, 134, 96);
  context.setLineDash([]);
  context.fillStyle = 'rgb(255 184 77 / 80%)';
  context.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillText('TEST ZONE', 264, 149);

  context.strokeStyle = COLORS.border;
  context.lineWidth = 2;
  context.strokeRect(1, 1, BATTLE_RENDER_SIZE.width - 2, BATTLE_RENDER_SIZE.height - 2);
}

function drawFloorMarker(context: CanvasRenderingContext2D, side: RobotSide, x: number, y: number, active: boolean): void {
  context.save();
  context.translate(x, y);
  context.lineWidth = active ? 3 : 2;
  context.strokeStyle = active ? COLORS.rule : side === 'ally' ? COLORS.ally : COLORS.enemy;
  context.fillStyle = side === 'ally' ? 'rgb(70 217 232 / 12%)' : 'rgb(255 154 92 / 12%)';
  context.beginPath();
  if (side === 'ally') {
    context.arc(0, 0, 24, 0, Math.PI * 2);
  } else {
    context.moveTo(0, -24);
    context.lineTo(24, 0);
    context.lineTo(0, 24);
    context.lineTo(-24, 0);
    context.closePath();
    context.setLineDash([5, 4]);
  }
  context.fill();
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function drawHealthBar(context: CanvasRenderingContext2D, combatant: CombatantState, side: RobotSide): void {
  const width = 42;
  const ratio = clampUnit(combatant.health / combatant.maxHealth);
  context.fillStyle = 'rgb(11 17 24 / 88%)';
  context.fillRect(combatant.x - width / 2, combatant.y - 34, width, 5);
  context.fillStyle = side === 'ally' ? COLORS.ally : COLORS.enemy;
  context.fillRect(combatant.x - width / 2, combatant.y - 34, width * ratio, 5);
  context.strokeStyle = COLORS.text;
  context.lineWidth = 1;
  context.strokeRect(combatant.x - width / 2, combatant.y - 34, width, 5);

  const heatRatio = clampUnit(combatant.heat / MAX_HEAT);
  context.fillStyle = 'rgb(11 17 24 / 88%)';
  context.fillRect(combatant.x - width / 2, combatant.y - 27, width, 4);
  context.fillStyle = combatant.overheatRemaining > 0 ? '#FF5D6C' : '#FFB84D';
  context.fillRect(combatant.x - width / 2, combatant.y - 27, width * heatRatio, 4);
  context.strokeStyle = COLORS.text;
  context.strokeRect(combatant.x - width / 2, combatant.y - 27, width, 4);
}

function drawHeatWarning(context: CanvasRenderingContext2D, combatant: CombatantState): void {
  if (combatant.heat < 70 && combatant.overheatRemaining === 0) return;
  context.save();
  context.strokeStyle = combatant.overheatRemaining > 0 ? '#FF5D6C' : '#FFB84D';
  context.lineWidth = 2;
  context.setLineDash([4, 3]);
  context.beginPath();
  context.arc(combatant.x, combatant.y, 31, -Math.PI * 0.82, -Math.PI * 0.18);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = context.strokeStyle;
  context.beginPath();
  context.moveTo(combatant.x + 25, combatant.y - 25);
  context.lineTo(combatant.x + 34, combatant.y - 25);
  context.lineTo(combatant.x + 29.5, combatant.y - 17);
  context.closePath();
  context.fill();
  context.fillStyle = COLORS.mechanic;
  context.font = '700 8px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  context.fillText('!', combatant.x + 29.5, combatant.y - 19.5);
  context.restore();
}

function drawRobot(
  context: CanvasRenderingContext2D,
  combatant: CombatantState,
  target: CombatantState,
  activeRuleId: string | null,
): void {
  const side = robotSideForId(combatant.id);
  const direction = directionToTarget(combatant, target);
  const active = combatant.active;
  const bodyColor = side === 'ally' ? COLORS.ally : COLORS.enemy;
  const accentColor = side === 'ally' ? COLORS.allyLight : COLORS.enemyLight;

  drawFloorMarker(context, side, combatant.x, combatant.y, side === 'ally' && activeRuleId !== null);
  drawHealthBar(context, combatant, side);
  drawHeatWarning(context, combatant);

  context.save();
  context.globalAlpha = active ? 1 : 0.3;
  context.fillStyle = COLORS.shadow;
  context.beginPath();
  context.ellipse(combatant.x, combatant.y + 18, 24, 7, 0, 0, Math.PI * 2);
  context.fill();

  context.translate(combatant.x, combatant.y);
  context.rotate(direction.angle);

  // Small legs remain visible below the painted shell and establish the work-machine feel.
  context.strokeStyle = COLORS.mechanicLine;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(-11, 9);
  context.lineTo(-13, 17);
  context.moveTo(9, 9);
  context.lineTo(11, 17);
  context.stroke();

  pathFromPoints(context, robotSilhouette(side));
  context.fillStyle = bodyColor;
  context.fill();
  context.strokeStyle = COLORS.text;
  context.lineWidth = 2;
  context.stroke();

  // Repair plate and sensor line are shape cues, not decorative noise.
  context.fillStyle = COLORS.panelRepair;
  context.fillRect(-9, -7, 12, 5);
  context.strokeStyle = accentColor;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-8, 4);
  context.lineTo(10, 4);
  context.stroke();

  context.fillStyle = COLORS.mechanic;
  context.beginPath();
  context.arc(0, 0, 8, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = COLORS.mechanicLine;
  context.lineWidth = 2;
  context.stroke();

  // The barrel points along the same stable target direction as the body.
  context.fillStyle = COLORS.mechanic;
  context.fillRect(5, -3, 25, 6);
  context.strokeStyle = accentColor;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(17, -2);
  context.lineTo(28, -2);
  context.stroke();

  if (side === 'enemy') {
    context.strokeStyle = COLORS.enemyLight;
    context.setLineDash([3, 3]);
    context.strokeRect(-12, -8, 10, 11);
    context.setLineDash([]);
  }
  context.restore();

  context.save();
  context.globalAlpha = active ? 1 : 0.45;
  context.fillStyle = COLORS.text;
  context.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  context.fillText(side === 'ally' ? 'A1' : 'E1', combatant.x, combatant.y + 38);
  if (!active) {
    context.strokeStyle = COLORS.enemyLight;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(combatant.x - 14, combatant.y - 14);
    context.lineTo(combatant.x + 14, combatant.y + 14);
    context.stroke();
  }
  context.restore();
}

function drawProjectile(context: CanvasRenderingContext2D, projectile: ProjectileState): void {
  const side = robotSideForId(projectile.ownerId);
  const color = side === 'ally' ? COLORS.allyLight : COLORS.enemyLight;
  const length = Math.max(7, Math.min(18, Math.hypot(projectile.vx, projectile.vy) * 1.5));
  const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
  const dx = projectile.vx / speed;
  const dy = projectile.vy / speed;

  context.save();
  context.globalAlpha = projectile.active ? 1 : 0.25;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, projectile.radius / 2);
  context.beginPath();
  context.moveTo(projectile.x - dx * length, projectile.y - dy * length);
  context.lineTo(projectile.x, projectile.y);
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(projectile.x, projectile.y, Math.max(3, projectile.radius), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function combatantById(state: CombatState, id: number | undefined): CombatantState | undefined {
  if (id === undefined) return undefined;
  return state.combatants.find((combatant) => combatant.id === id);
}

function drawScorchMark(context: CanvasRenderingContext2D, x: number, y: number, index: number): void {
  context.save();
  context.translate(x, y + 5);
  context.rotate((index % 8) * (Math.PI / 8));
  context.strokeStyle = 'rgb(11 17 24 / 58%)';
  context.fillStyle = 'rgb(11 17 24 / 28%)';
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(0, 0, 14 + (index % 3), 5 + (index % 2), 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawScorchMarks(context: CanvasRenderingContext2D, state: CombatState, limit: number): void {
  if (limit <= 0) return;
  const hits = state.events.slice(-64).filter((event) => event.type === 'HIT_CONFIRMED').slice(-limit);
  hits.forEach((event, index) => {
    const target = combatantById(state, event.targetId);
    if (target) drawScorchMark(context, target.x, target.y, index);
  });
}

function drawMuzzleFlash(
  context: CanvasRenderingContext2D,
  combatant: CombatantState,
  target: CombatantState,
  age: number,
): void {
  const direction = directionToTarget(combatant, target);
  const side = robotSideForId(combatant.id);
  const color = side === 'ally' ? COLORS.allyLight : COLORS.enemyLight;
  context.save();
  context.translate(combatant.x, combatant.y);
  context.rotate(direction.angle);
  context.globalAlpha = 1 - age / (EFFECT_WINDOWS.muzzleFlash + 1);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(22, 0);
  context.lineTo(38, -7);
  context.lineTo(32, 0);
  context.lineTo(38, 7);
  context.closePath();
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(28, 0, 8 + (EFFECT_WINDOWS.muzzleFlash - age), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawImpactEffect(
  context: CanvasRenderingContext2D,
  target: CombatantState,
  event: CombatEvent,
  age: number,
  mode: BattleEffectMode,
): void {
  const side = robotSideForId(event.sourceId ?? 2);
  const color = side === 'ally' ? COLORS.allyLight : COLORS.enemyLight;
  const alpha = Math.max(0.12, 1 - age / (EFFECT_WINDOWS.impact + 2));
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(target.x, target.y, 10 + age * 2, 0, Math.PI * 2);
  context.stroke();
  for (let index = 0; index < 5; index += 1) {
    const angle = (index * Math.PI * 2) / 5 + (event.projectileId ?? 0) * 0.2;
    const length = 13 + (index % 2) * 5;
    context.beginPath();
    context.moveTo(target.x + Math.cos(angle) * 7, target.y + Math.sin(angle) * 7);
    context.lineTo(target.x + Math.cos(angle) * length, target.y + Math.sin(angle) * length);
    context.stroke();
  }
  if (mode === 'full' && age <= EFFECT_WINDOWS.smoke) {
    context.globalAlpha = Math.max(0, 0.28 - age * 0.025);
    context.fillStyle = '#AAB7C4';
    for (const [offsetX, offsetY, radius] of [[-6, -8, 6], [5, -5, 5], [3, 5, 7]] as const) {
      context.beginPath();
      context.arc(target.x + offsetX, target.y + offsetY - age * 0.4, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function drawBattleEffects(
  context: CanvasRenderingContext2D,
  state: CombatState,
  mode: BattleEffectMode,
): void {
  const events = state.events.slice(-32);
  for (const event of events) {
    const age = state.tick - event.tick;
    if (event.type === 'PROJECTILE_FIRED' && isEffectVisible(state.tick, event.tick, EFFECT_WINDOWS.muzzleFlash)) {
      const source = combatantById(state, event.sourceId);
      const target = state.combatants.find((combatant) => combatant.id !== event.sourceId);
      if (source && target) drawMuzzleFlash(context, source, target, age);
    }
    if (event.type === 'HIT_CONFIRMED' && isEffectVisible(state.tick, event.tick, EFFECT_WINDOWS.impact)) {
      const target = combatantById(state, event.targetId);
      if (target) drawImpactEffect(context, target, event, age, mode);
    }
  }
}

function arenaScale(state: CombatState, context: CanvasRenderingContext2D): { x: number; y: number } {
  const width = state.arena.maxX - state.arena.minX;
  const height = state.arena.maxY - state.arena.minY;
  return {
    x: context.canvas.width / width,
    y: context.canvas.height / height,
  };
}

/**
 * Draws the representative P3-15 scene. No time, randomness, or camera-following
 * state is read here, so the same combat snapshot always produces the same scene.
 */
export function drawBattleScene(
  context: CanvasRenderingContext2D,
  state: CombatState,
  activeRuleId: string | null,
  options: BattleRenderOptions = {},
): void {
  const first = state.combatants[0];
  const second = state.combatants[1];
  if (!first || !second) return;
  const scale = arenaScale(state, context);
  const quality = options.quality ?? 'high';
  const qualitySettings = BATTLE_QUALITY_SETTINGS[quality] ?? BATTLE_QUALITY_SETTINGS.high;
  const effectMode = options.effects ?? qualitySettings.effects;

  context.save();
  context.setTransform(scale.x, 0, 0, scale.y, -state.arena.minX * scale.x, -state.arena.minY * scale.y);
  drawArena(context);
  drawScorchMarks(context, state, qualitySettings.scorchMarkLimit);
  drawRobot(context, first, second, activeRuleId);
  drawRobot(context, second, first, activeRuleId);
  for (const projectile of state.projectiles) drawProjectile(context, projectile);
  drawBattleEffects(context, state, effectMode);
  context.restore();
}

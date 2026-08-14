import { addGameIntegers, assertGameInteger } from './fixed-point';
import { squaredDistance, validateBounds } from './geometry';
import { velocityForHeading } from './motion';
import type { ArenaBounds } from './geometry';

/** Fixed combat limits shared by the first playable ruleset. */
export const MAX_HEAT = 100;
export const OVERHEAT_DURATION_TICKS = 90;
export const MAX_COMBAT_TICKS = 45 * 60;
export const MAX_PROJECTILES = 1_024;
export const MAX_EVENTS_PER_REPLAY = 4_096;
export const DEFAULT_PROJECTILE_LIFETIME_TICKS = 120;

export interface WeaponSpec {
  readonly id: string;
  readonly ammoCost: number;
  readonly damage: number;
  readonly heat: number;
  readonly cooldownTicks: number;
  readonly projectileSpeed: number;
  readonly projectileRadius: number;
  readonly lifetimeTicks?: number;
}

export interface CombatantState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxHealth: number;
  readonly health: number;
  readonly heat: number;
  readonly ammo: number;
  readonly fireCooldownRemaining: number;
  readonly overheatRemaining: number;
  readonly damageDealt: number;
  readonly active: boolean;
}

export interface ProjectileState {
  readonly id: number;
  readonly ownerId: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly damage: number;
  readonly remainingTicks: number;
  readonly active: boolean;
}

export type CombatCommand =
  | {
      readonly kind: 'fire';
      readonly ownerId: number;
      readonly heading: number;
      readonly weapon: WeaponSpec;
    }
  | {
      readonly kind: 'cool';
      readonly ownerId: number;
      readonly amount: number;
    };

export type CombatEventType =
  | 'PROJECTILE_FIRED'
  | 'ACTION_UNAVAILABLE'
  | 'COOLED'
  | 'HEAT_STARTED'
  | 'HIT_CONFIRMED'
  | 'PROJECTILE_EXPIRED'
  | 'MATCH_END';

export interface CombatEvent {
  readonly type: CombatEventType;
  readonly tick: number;
  readonly sourceId?: number;
  readonly targetId?: number;
  readonly projectileId?: number;
  readonly value?: number;
  readonly reason?: string;
}

export type CombatOutcomeReason = 'not-ended' | 'destruction' | 'time-limit' | 'draw';

export interface CombatOutcome {
  readonly status: 'running' | 'finished';
  readonly winnerId: number | null;
  readonly reason: CombatOutcomeReason;
}

export interface CombatState {
  readonly tick: number;
  readonly maxTicks: number;
  readonly arena: ArenaBounds;
  readonly combatants: readonly CombatantState[];
  readonly projectiles: readonly ProjectileState[];
  readonly nextProjectileId: number;
  readonly events: readonly CombatEvent[];
  readonly outcome: CombatOutcome;
}

export interface CombatStateInput {
  readonly arena: ArenaBounds;
  readonly maxTicks: number;
  readonly combatants: readonly CombatantState[];
  readonly projectiles?: readonly ProjectileState[];
  readonly nextProjectileId?: number;
  readonly tick?: number;
}

function assertId(value: number, label: string): void {
  assertGameInteger(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

function assertTextId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value)) {
    throw new RangeError(`${label} is invalid`);
  }
}

function assertInsideArena(x: number, y: number, radius: number, arena: ArenaBounds, label: string): void {
  const minX = addGameIntegers(arena.minX, radius, `${label}.minX`);
  const maxX = addGameIntegers(arena.maxX, -radius, `${label}.maxX`);
  const minY = addGameIntegers(arena.minY, radius, `${label}.minY`);
  const maxY = addGameIntegers(arena.maxY, -radius, `${label}.maxY`);
  if (minX > maxX || minY > maxY || x < minX || x > maxX || y < minY || y > maxY) {
    throw new RangeError(`${label} must be inside the arena`);
  }
}

function validateWeapon(weapon: WeaponSpec): void {
  assertTextId(weapon.id, 'weapon.id');
  for (const [label, value] of [
    ['ammoCost', weapon.ammoCost],
    ['damage', weapon.damage],
    ['heat', weapon.heat],
    ['cooldownTicks', weapon.cooldownTicks],
    ['projectileSpeed', weapon.projectileSpeed],
    ['projectileRadius', weapon.projectileRadius],
  ] as const) {
    assertGameInteger(value, `weapon.${label}`);
  }
  if (weapon.ammoCost < 1 || weapon.damage < 1 || weapon.heat < 0 || weapon.cooldownTicks < 0) {
    throw new RangeError('weapon cost, damage, heat, and cooldown must be valid');
  }
  if (weapon.projectileSpeed <= 0 || weapon.projectileRadius <= 0) {
    throw new RangeError('projectile speed and radius must be positive');
  }
  if (weapon.heat > MAX_HEAT || weapon.damage > 2_000_000_000) {
    throw new RangeError('weapon value exceeds the combat limit');
  }
  if (weapon.lifetimeTicks !== undefined) {
    assertGameInteger(weapon.lifetimeTicks, 'weapon.lifetimeTicks');
    if (weapon.lifetimeTicks < 1 || weapon.lifetimeTicks > MAX_COMBAT_TICKS) {
      throw new RangeError('weapon lifetime is outside the combat limit');
    }
  }
}

function validateCombatant(combatant: CombatantState, arena: ArenaBounds): void {
  assertId(combatant.id, 'combatant.id');
  for (const [label, value] of [
    ['x', combatant.x],
    ['y', combatant.y],
    ['radius', combatant.radius],
    ['maxHealth', combatant.maxHealth],
    ['health', combatant.health],
    ['heat', combatant.heat],
    ['ammo', combatant.ammo],
    ['fireCooldownRemaining', combatant.fireCooldownRemaining],
    ['overheatRemaining', combatant.overheatRemaining],
    ['damageDealt', combatant.damageDealt],
  ] as const) {
    assertGameInteger(value, `combatant.${label}`);
  }
  if (combatant.radius <= 0 || combatant.maxHealth <= 0) {
    throw new RangeError('combatant radius and maxHealth must be positive');
  }
  if (combatant.health < 0 || combatant.health > combatant.maxHealth) {
    throw new RangeError('combatant health is outside its range');
  }
  if (combatant.heat < 0 || combatant.heat > MAX_HEAT || combatant.ammo < 0) {
    throw new RangeError('combatant heat or ammo is outside its range');
  }
  if (combatant.fireCooldownRemaining < 0 || combatant.overheatRemaining < 0 || combatant.damageDealt < 0) {
    throw new RangeError('combatant timers and damage must be non-negative');
  }
  if (combatant.active !== (combatant.health > 0)) {
    throw new RangeError('combatant active must match health');
  }
  assertInsideArena(combatant.x, combatant.y, combatant.radius, arena, `combatant ${combatant.id}`);
}

function validateProjectile(projectile: ProjectileState, arena: ArenaBounds): void {
  assertId(projectile.id, 'projectile.id');
  assertId(projectile.ownerId, 'projectile.ownerId');
  for (const [label, value] of [
    ['x', projectile.x],
    ['y', projectile.y],
    ['vx', projectile.vx],
    ['vy', projectile.vy],
    ['radius', projectile.radius],
    ['damage', projectile.damage],
    ['remainingTicks', projectile.remainingTicks],
  ] as const) {
    assertGameInteger(value, `projectile.${label}`);
  }
  if (projectile.radius <= 0 || projectile.damage <= 0 || projectile.remainingTicks < 0) {
    throw new RangeError('projectile radius, damage, and lifetime must be valid');
  }
  if (projectile.active && projectile.remainingTicks === 0) {
    throw new RangeError('active projectile must have remaining lifetime');
  }
  if (projectile.active) {
    assertInsideArena(projectile.x, projectile.y, projectile.radius, arena, `projectile ${projectile.id}`);
  }
}

function compareHealthRatio(first: CombatantState, second: CombatantState): number {
  const left = BigInt(first.health) * BigInt(second.maxHealth);
  const right = BigInt(second.health) * BigInt(first.maxHealth);
  return left === right ? 0 : left > right ? 1 : -1;
}

/** Applies the fixed time-limit tie-break order without using floating point. */
export function evaluateMatchOutcome(
  combatants: readonly CombatantState[],
  tick: number,
  maxTicks: number,
): CombatOutcome {
  assertGameInteger(tick, 'tick');
  assertGameInteger(maxTicks, 'maxTicks');
  if (combatants.length !== 2) throw new RangeError('combat must contain exactly two combatants');
  const [first, second] = [...combatants].sort((left, right) => left.id - right.id);
  const firstDead = first.health <= 0;
  const secondDead = second.health <= 0;
  if (firstDead || secondDead) {
    if (firstDead && secondDead) return { status: 'finished', winnerId: null, reason: 'draw' };
    return { status: 'finished', winnerId: firstDead ? second.id : first.id, reason: 'destruction' };
  }
  if (tick < maxTicks) return { status: 'running', winnerId: null, reason: 'not-ended' };

  const healthComparison = compareHealthRatio(first, second);
  if (healthComparison !== 0) {
    return { status: 'finished', winnerId: healthComparison > 0 ? first.id : second.id, reason: 'time-limit' };
  }
  if (first.heat !== second.heat) {
    return { status: 'finished', winnerId: first.heat < second.heat ? first.id : second.id, reason: 'time-limit' };
  }
  if (first.damageDealt !== second.damageDealt) {
    return {
      status: 'finished',
      winnerId: first.damageDealt > second.damageDealt ? first.id : second.id,
      reason: 'time-limit',
    };
  }
  return { status: 'finished', winnerId: null, reason: 'draw' };
}

function validateCombatState(state: CombatState): void {
  assertGameInteger(state.tick, 'state.tick');
  assertGameInteger(state.maxTicks, 'state.maxTicks');
  if (state.tick < 0 || state.maxTicks < 1 || state.maxTicks > MAX_COMBAT_TICKS || state.tick > state.maxTicks) {
    throw new RangeError('state tick is outside the combat range');
  }
  validateBounds(state.arena);
  if (state.combatants.length !== 2) throw new RangeError('combat must contain exactly two combatants');
  const combatantIds = new Set<number>();
  for (const combatant of state.combatants) {
    validateCombatant(combatant, state.arena);
    if (combatantIds.has(combatant.id)) throw new RangeError('combatant IDs must be unique');
    combatantIds.add(combatant.id);
  }
  if (state.projectiles.length > MAX_PROJECTILES) throw new RangeError('projectile count exceeds the combat limit');
  const projectileIds = new Set<number>();
  for (const projectile of state.projectiles) {
    validateProjectile(projectile, state.arena);
    if (!combatantIds.has(projectile.ownerId)) throw new RangeError('projectile owner does not exist');
    if (projectileIds.has(projectile.id)) throw new RangeError('projectile IDs must be unique');
    projectileIds.add(projectile.id);
  }
  assertId(state.nextProjectileId, 'nextProjectileId');
  if ([...projectileIds].some((id) => id >= state.nextProjectileId)) {
    throw new RangeError('nextProjectileId must be greater than existing IDs');
  }
  if (state.events.length > MAX_EVENTS_PER_REPLAY) throw new RangeError('event log exceeds the replay limit');
}

export function createCombatState(input: CombatStateInput): CombatState {
  assertGameInteger(input.maxTicks, 'maxTicks');
  if (input.maxTicks < 1 || input.maxTicks > MAX_COMBAT_TICKS) {
    throw new RangeError('maxTicks is outside the combat range');
  }
  const tick = input.tick ?? 0;
  assertGameInteger(tick, 'tick');
  if (tick < 0 || tick > input.maxTicks) throw new RangeError('tick is outside the combat range');
  validateBounds(input.arena);
  if (input.combatants.length !== 2) throw new RangeError('combat must contain exactly two combatants');
  const combatants = [...input.combatants].sort((left, right) => left.id - right.id).map((combatant) => ({ ...combatant }));
  const projectiles = [...(input.projectiles ?? [])].filter((projectile) => projectile.active).sort((left, right) => left.id - right.id);
  const nextProjectileId = input.nextProjectileId ?? (projectiles.reduce((max, projectile) => Math.max(max, projectile.id), -1) + 1);
  const state: CombatState = {
    tick,
    maxTicks: input.maxTicks,
    arena: { ...input.arena },
    combatants,
    projectiles: projectiles.map((projectile) => ({ ...projectile })),
    nextProjectileId,
    events: [],
    outcome: evaluateMatchOutcome(combatants, tick, input.maxTicks),
  };
  validateCombatState(state);
  return state;
}

function validateCommands(commands: readonly CombatCommand[], state: CombatState): CombatCommand[] {
  if (commands.length > state.combatants.length) throw new RangeError('one command per combatant per tick is allowed');
  const knownIds = new Set(state.combatants.map((combatant) => combatant.id));
  const seenIds = new Set<number>();
  for (const command of commands) {
    assertId(command.ownerId, 'command.ownerId');
    if (!knownIds.has(command.ownerId)) throw new RangeError('command owner does not exist');
    if (seenIds.has(command.ownerId)) throw new RangeError('duplicate command owner in one tick');
    seenIds.add(command.ownerId);
    if (command.kind === 'fire') {
      assertGameInteger(command.heading, 'command.heading');
      validateWeapon(command.weapon);
    } else {
      assertGameInteger(command.amount, 'command.amount');
      if (command.amount <= 0 || command.amount > MAX_HEAT) throw new RangeError('cooling amount is outside the combat range');
    }
  }
  return [...commands].sort((left, right) => left.ownerId - right.ownerId);
}

function unavailableEvent(tick: number, ownerId: number, reason: string): CombatEvent {
  return { type: 'ACTION_UNAVAILABLE', tick, sourceId: ownerId, reason };
}

function pointInsideArena(x: number, y: number, radius: number, arena: ArenaBounds): boolean {
  const minX = arena.minX + radius;
  const maxX = arena.maxX - radius;
  const minY = arena.minY + radius;
  const maxY = arena.maxY - radius;
  return minX <= maxX && minY <= maxY && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

interface PendingHit {
  readonly projectile: ProjectileState;
  readonly targetId: number;
}

/** Advances one fixed tick using command, movement, hit, and outcome order. */
export function stepCombat(state: CombatState, commands: readonly CombatCommand[] = []): CombatState {
  validateCombatState(state);
  if (state.outcome.status === 'finished') return state;
  const orderedCommands = validateCommands(commands, state);
  const tick = state.tick + 1;
  const events: CombatEvent[] = [];
  let nextProjectileId = state.nextProjectileId;
  const commandByOwner = new Map(orderedCommands.map((command) => [command.ownerId, command]));
  const combatants = state.combatants.map((combatant) => ({
    ...combatant,
    fireCooldownRemaining: Math.max(0, combatant.fireCooldownRemaining - 1),
    overheatRemaining: Math.max(0, combatant.overheatRemaining - 1),
  }));
  const createdProjectiles: ProjectileState[] = [];

  for (let index = 0; index < combatants.length; index += 1) {
    const combatant = combatants[index];
    const command = commandByOwner.get(combatant.id);
    if (!command) continue;
    if (command.kind === 'cool') {
      if (!combatant.active) {
        events.push(unavailableEvent(tick, combatant.id, 'inactive'));
        continue;
      }
      const cooled = Math.min(combatant.heat, command.amount);
      combatants[index] = { ...combatant, heat: combatant.heat - cooled };
      if (cooled > 0) events.push({ type: 'COOLED', tick, sourceId: combatant.id, value: cooled });
      continue;
    }

    const weapon = command.weapon;
    if (!combatant.active) {
      events.push(unavailableEvent(tick, combatant.id, 'inactive'));
    } else if (combatant.ammo < weapon.ammoCost) {
      events.push(unavailableEvent(tick, combatant.id, 'ammo-empty'));
    } else if (combatant.fireCooldownRemaining > 0) {
      events.push(unavailableEvent(tick, combatant.id, 'cooldown'));
    } else if (combatant.overheatRemaining > 0) {
      events.push(unavailableEvent(tick, combatant.id, 'overheated'));
    } else if (combatant.heat + weapon.heat > MAX_HEAT) {
      events.push(unavailableEvent(tick, combatant.id, 'heat-limit'));
    } else {
      const velocity = velocityForHeading(command.heading, weapon.projectileSpeed);
      const heat = combatant.heat + weapon.heat;
      const projectile: ProjectileState = {
        id: nextProjectileId,
        ownerId: combatant.id,
        x: combatant.x,
        y: combatant.y,
        vx: velocity.x,
        vy: velocity.y,
        radius: weapon.projectileRadius,
        damage: weapon.damage,
        remainingTicks: weapon.lifetimeTicks ?? DEFAULT_PROJECTILE_LIFETIME_TICKS,
        active: true,
      };
      nextProjectileId = addGameIntegers(nextProjectileId, 1, 'next projectile ID');
      combatants[index] = {
        ...combatant,
        ammo: combatant.ammo - weapon.ammoCost,
        heat,
        fireCooldownRemaining: weapon.cooldownTicks,
        overheatRemaining: heat >= MAX_HEAT ? OVERHEAT_DURATION_TICKS : combatant.overheatRemaining,
      };
      createdProjectiles.push(projectile);
      events.push({ type: 'PROJECTILE_FIRED', tick, sourceId: combatant.id, projectileId: projectile.id, value: weapon.damage });
      if (heat >= MAX_HEAT) events.push({ type: 'HEAT_STARTED', tick, sourceId: combatant.id, value: heat });
    }
  }

  const allProjectiles = [...state.projectiles, ...createdProjectiles].sort((left, right) => left.id - right.id);
  const pendingHits: PendingHit[] = [];
  const survivingProjectiles: ProjectileState[] = [];
  for (const projectile of allProjectiles) {
    const moved: ProjectileState = {
      ...projectile,
      x: addGameIntegers(projectile.x, projectile.vx, 'projectile next x'),
      y: addGameIntegers(projectile.y, projectile.vy, 'projectile next y'),
      remainingTicks: Math.max(0, projectile.remainingTicks - 1),
    };
    if (!pointInsideArena(moved.x, moved.y, moved.radius, state.arena)) {
      events.push({ type: 'PROJECTILE_EXPIRED', tick, projectileId: moved.id, reason: 'arena-exit' });
      continue;
    }
    const target = combatants.find(
      (candidate) => candidate.active && candidate.id !== moved.ownerId && squaredDistance(moved, candidate) <= BigInt(moved.radius + candidate.radius) ** 2n,
    );
    if (target) {
      pendingHits.push({ projectile: moved, targetId: target.id });
      continue;
    }
    if (moved.remainingTicks === 0) {
      events.push({ type: 'PROJECTILE_EXPIRED', tick, projectileId: moved.id, reason: 'lifetime' });
      continue;
    }
    survivingProjectiles.push(moved);
  }

  const damageByTarget = new Map<number, number>();
  const damageByOwner = new Map<number, number>();
  for (const hit of pendingHits) {
    damageByTarget.set(hit.targetId, addGameIntegers(damageByTarget.get(hit.targetId) ?? 0, hit.projectile.damage, 'target damage'));
    damageByOwner.set(hit.projectile.ownerId, addGameIntegers(damageByOwner.get(hit.projectile.ownerId) ?? 0, hit.projectile.damage, 'owner damage'));
    events.push({
      type: 'HIT_CONFIRMED',
      tick,
      sourceId: hit.projectile.ownerId,
      targetId: hit.targetId,
      projectileId: hit.projectile.id,
      value: hit.projectile.damage,
    });
  }

  const resolvedCombatants = combatants.map((combatant) => {
    const damage = damageByTarget.get(combatant.id) ?? 0;
    const health = Math.max(0, combatant.health - damage);
    return {
      ...combatant,
      health,
      damageDealt: addGameIntegers(combatant.damageDealt, damageByOwner.get(combatant.id) ?? 0, 'damage dealt'),
      active: health > 0,
    };
  });
  const outcome = evaluateMatchOutcome(resolvedCombatants, tick, state.maxTicks);
  if (outcome.status === 'finished') {
    events.push({ type: 'MATCH_END', tick, value: outcome.winnerId ?? -1, reason: outcome.reason });
  }
  const eventLog = [...state.events, ...events];
  if (eventLog.length > MAX_EVENTS_PER_REPLAY) throw new RangeError('event log exceeds the replay limit');
  const nextState: CombatState = {
    ...state,
    tick,
    combatants: resolvedCombatants,
    projectiles: survivingProjectiles,
    nextProjectileId,
    events: eventLog,
    outcome,
  };
  validateCombatState(nextState);
  return nextState;
}

/** Runs a finite command timeline without rendering or wall-clock input. */
export function runCombat(initial: CombatState, timeline: readonly (readonly CombatCommand[])[]): CombatState {
  let state = initial;
  for (let index = 0; index < timeline.length && state.outcome.status === 'running'; index += 1) {
    state = stepCombat(state, timeline[index]);
  }
  return state;
}


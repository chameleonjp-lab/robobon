import { assertGameInteger } from './fixed-point';

const STATE_HASH_VERSION = 1;

interface SimulationEntityState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  heat: number;
  active: boolean;
}

interface SimulationState {
  tick: number;
  entities: readonly SimulationEntityState[];
}

function canonicalStateBytes(state: SimulationState): Uint8Array {
  assertGameInteger(state.tick, 'tick');
  if (state.tick < 0) {
    throw new RangeError('tick must be non-negative');
  }
  if (state.entities.length > 10_000) {
    throw new RangeError('entity count exceeds the replay limit');
  }

  const entities = [...state.entities].sort((left, right) => left.id - right.id);
  const bytes = new Uint8Array(16 + entities.length * 29);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint32(offset, 0x52424e31, true);
  offset += 4;
  view.setUint32(offset, STATE_HASH_VERSION, true);
  offset += 4;
  view.setUint32(offset, state.tick, true);
  offset += 4;
  view.setUint32(offset, entities.length, true);
  offset += 4;

  for (const entity of entities) {
    assertGameInteger(entity.id, 'entity.id');
    if (entity.id < 0) {
      throw new RangeError('entity.id must be non-negative');
    }
    for (const [label, value] of [
      ['entity.x', entity.x],
      ['entity.y', entity.y],
      ['entity.vx', entity.vx],
      ['entity.vy', entity.vy],
      ['entity.health', entity.health],
      ['entity.heat', entity.heat],
    ] as const) {
      assertGameInteger(value, label);
    }

    view.setInt32(offset, entity.id, true);
    offset += 4;
    view.setInt32(offset, entity.x, true);
    offset += 4;
    view.setInt32(offset, entity.y, true);
    offset += 4;
    view.setInt32(offset, entity.vx, true);
    offset += 4;
    view.setInt32(offset, entity.vy, true);
    offset += 4;
    view.setInt32(offset, entity.health, true);
    offset += 4;
    view.setInt32(offset, entity.heat, true);
    offset += 4;
    bytes[offset] = entity.active ? 1 : 0;
    offset += 1;
  }

  return bytes;
}

/** FNV-1a is a replay fingerprint, not a security or authenticity boundary. */
function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hashSimulationState(state: SimulationState): string {
  return hashBytes(canonicalStateBytes(state));
}

export { STATE_HASH_VERSION, canonicalStateBytes, hashBytes, hashSimulationState };
export type { SimulationEntityState, SimulationState };

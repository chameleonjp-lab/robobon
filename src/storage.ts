import { validateRuleSet, type RuleCard } from './simulation/rules';

export const APP_STORAGE_ID = 'chameleonjp-lab.robobon.v1';
export const STORAGE_SCHEMA_VERSION = 1;
export const LEGACY_STORAGE_SCHEMA_VERSION = 0;
export const PROGRAM_FORMAT_VERSION = 1;
export const MAX_PROGRAM_SLOTS = 3;
export const MAX_PROGRAM_BYTES = 256 * 1024;
export const MAX_PROGRAM_NAME_LENGTH = 64;
export const MAX_PROGRAM_DEPTH = 16;
export const MAX_PROGRAM_ARRAY_LENGTH = 64;
export const MAX_PROGRAM_REVISIONS = 2;

const DB_VERSION = 1;
const REVISION_STORE = 'programRevisions';
const CURRENT_STORE = 'programCurrent';
const LOCAL_STORAGE_KEY = `${APP_STORAGE_ID}.programs`;

export interface ProgramDocument {
  readonly schemaVersion: number;
  readonly formatVersion: number;
  readonly simulationVersion: string;
  readonly id: string;
  readonly name: string;
  readonly rules: readonly RuleCard[];
  readonly updatedAt: string;
}

export interface ProgramStore {
  readonly mode: 'indexeddb' | 'localstorage' | 'memory';
  list(): Promise<readonly ProgramDocument[]>;
  get(id: string): Promise<ProgramDocument | null>;
  save(program: ProgramDocument): Promise<void>;
  delete(id: string): Promise<void>;
}

export type ProgramParseResult =
  | { readonly ok: true; readonly program: ProgramDocument; readonly migrated: boolean }
  | { readonly ok: false; readonly error: string };

interface StoredRevision {
  readonly key: string;
  readonly programId: string;
  readonly revision: number;
  readonly program: ProgramDocument;
}

interface CurrentPointer {
  readonly id: string;
  readonly revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function scanSafeJson(value: unknown, depth = 0): void {
  if (depth > MAX_PROGRAM_DEPTH) throw new Error(`データの深さが${MAX_PROGRAM_DEPTH}階層を超えています`);
  if (typeof value === 'string') {
    if (value.length > MAX_PROGRAM_BYTES) throw new Error('文字列が大きすぎます');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PROGRAM_ARRAY_LENGTH) throw new Error('配列の項目数が多すぎます');
    for (const item of value) scanSafeJson(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (hasDangerousKey(key)) throw new Error(`使用できないキーです: ${key}`);
    scanSafeJson(child, depth + 1);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label}が不正です`);
  }
  return value;
}

function readId(value: unknown, label: string): string {
  const id = readString(value, label, 64);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error(`${label}の形式が不正です`);
  return id;
}

function readSafeInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}が安全な整数の範囲外です`);
  }
  return value;
}

function copyRules(value: unknown): RuleCard[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error('規則は1〜8枚で指定してください');
  }
  const copied = value.map((rawRule, index): RuleCard => {
    if (!isRecord(rawRule)) throw new Error(`規則${index + 1}が不正です`);
    const id = readId(rawRule.id, `規則${index + 1}の識別子`);
    const priority = readSafeInteger(rawRule.priority, `規則${index + 1}の優先順位`, 0, 7);
    if (!Array.isArray(rawRule.conditions) || rawRule.conditions.length > 2) {
      throw new Error(`規則${index + 1}の条件が不正です`);
    }
    const conditions = rawRule.conditions.map((rawCondition, conditionIndex) => {
      if (!isRecord(rawCondition)) throw new Error(`規則${index + 1}の条件${conditionIndex + 1}が不正です`);
      const idValue = readString(rawCondition.id, `規則${index + 1}の条件`, 32);
      const conditionId = idValue as RuleCard['conditions'][number]['id'];
      if (rawCondition.expected !== undefined) {
        if (typeof rawCondition.expected !== 'boolean') throw new Error(`規則${index + 1}の条件の期待値が不正です`);
        return { id: conditionId, expected: rawCondition.expected };
      }
      return { id: conditionId };
    });
    const action = readString(rawRule.action, `規則${index + 1}の行動`, 32) as RuleCard['action'];
    const durationTicks = rawRule.durationTicks === undefined
      ? undefined
      : readSafeInteger(rawRule.durationTicks, `規則${index + 1}の継続時間`, 1, 600);
    const result: RuleCard = durationTicks === undefined
      ? { id, priority, conditions, action }
      : { id, priority, conditions, action, durationTicks };
    return result;
  });
  validateRuleSet(copied);
  return copied;
}

function migrateProgram(raw: Record<string, unknown>): { readonly value: Record<string, unknown>; readonly migrated: boolean } {
  const rawSchema = raw.schemaVersion === undefined ? LEGACY_STORAGE_SCHEMA_VERSION : raw.schemaVersion;
  const schemaVersion = readSafeInteger(rawSchema, '形式の版番号', LEGACY_STORAGE_SCHEMA_VERSION, STORAGE_SCHEMA_VERSION);
  if (schemaVersion === STORAGE_SCHEMA_VERSION) return { value: raw, migrated: false };
  return {
    value: { ...raw, schemaVersion: STORAGE_SCHEMA_VERSION, formatVersion: raw.formatVersion ?? PROGRAM_FORMAT_VERSION },
    migrated: true,
  };
}

export function validateProgramDocument(value: unknown): ProgramParseResult {
  try {
    scanSafeJson(value);
    if (!isRecord(value)) throw new Error('作戦データはオブジェクトで指定してください');
    const migration = migrateProgram(value);
    const raw = migration.value;
    const program: ProgramDocument = {
      schemaVersion: readSafeInteger(raw.schemaVersion, '形式の版番号', STORAGE_SCHEMA_VERSION, STORAGE_SCHEMA_VERSION),
      formatVersion: readSafeInteger(raw.formatVersion, '作戦形式の版番号', PROGRAM_FORMAT_VERSION, PROGRAM_FORMAT_VERSION),
      simulationVersion: readString(raw.simulationVersion, '戦闘計算の版', 32),
      id: readId(raw.id, '作戦識別子'),
      name: readString(raw.name, '作戦名', MAX_PROGRAM_NAME_LENGTH),
      rules: copyRules(raw.rules),
      updatedAt: readString(raw.updatedAt, '更新日時', 64),
    };
    return { ok: true, program, migrated: migration.migrated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '作戦データを読み込めません' };
  }
}

export function parseProgramJson(text: string): ProgramParseResult {
  if (byteLength(text) > MAX_PROGRAM_BYTES) return { ok: false, error: 'ファイルが256KBを超えています' };
  try {
    return validateProgramDocument(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, error: 'JSON形式として読み込めません' };
  }
}

export function serializeProgram(program: ProgramDocument): string {
  const result = validateProgramDocument(program);
  if (!result.ok) throw new Error(result.error);
  const text = JSON.stringify(result.program, null, 2);
  if (byteLength(text) > MAX_PROGRAM_BYTES) throw new Error('書き出しデータが256KBを超えています');
  return text;
}

function makeProgramId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return `program-${randomUuid.call(globalThis.crypto)}`;
  return `program-${Date.now().toString(36)}`;
}

export function createProgramDocument(
  rules: readonly RuleCard[],
  name = '試作作戦',
  id = 'starter',
  simulationVersion = 'p1-08',
): ProgramDocument {
  const now = new Date().toISOString();
  const program: ProgramDocument = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    formatVersion: PROGRAM_FORMAT_VERSION,
    simulationVersion,
    id,
    name,
    rules: rules.map((rule) => ({ ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })) })),
    updatedAt: now,
  };
  const checked = validateProgramDocument(program);
  if (!checked.ok) throw new Error(checked.error);
  return checked.program;
}

export function copyProgram(program: ProgramDocument): ProgramDocument {
  return createProgramDocument(program.rules, `${program.name}のコピー`.slice(0, MAX_PROGRAM_NAME_LENGTH), makeProgramId(), program.simulationVersion);
}

export function updateProgramRules(program: ProgramDocument, rules: readonly RuleCard[]): ProgramDocument {
  return createProgramDocument(rules, program.name, program.id, program.simulationVersion);
}

class MemoryProgramStore implements ProgramStore {
  readonly mode = 'memory' as const;
  private readonly programs = new Map<string, ProgramDocument>();

  async list(): Promise<readonly ProgramDocument[]> {
    return [...this.programs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<ProgramDocument | null> {
    return this.programs.get(id) ?? null;
  }

  async save(program: ProgramDocument): Promise<void> {
    const checked = validateProgramDocument(program);
    if (!checked.ok) throw new Error(checked.error);
    if (!this.programs.has(program.id) && this.programs.size >= MAX_PROGRAM_SLOTS) throw new Error('保存枠は3件までです');
    this.programs.set(program.id, checked.program);
  }

  async delete(id: string): Promise<void> {
    this.programs.delete(id);
  }
}

class LocalStorageProgramStore implements ProgramStore {
  readonly mode = 'localstorage' as const;
  constructor(private readonly storage: Storage) {}

  private read(): ProgramDocument[] {
    const raw = this.storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    if (byteLength(raw) > MAX_PROGRAM_BYTES) throw new Error('端末保存が256KBを超えています。書き出しを確認してから再試行してください。');
    const parsed = parseProgramJson(raw);
    if (parsed.ok) return [parsed.program];
    let values: unknown;
    try {
      values = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`端末保存が壊れています。書き出しを確認してから再試行してください。`);
    }
    if (!Array.isArray(values)) throw new Error('端末保存の形式が不正です');
    const programs: ProgramDocument[] = [];
    for (const value of values) {
      const result = validateProgramDocument(value);
      if (!result.ok) throw new Error(`端末保存を検証できません: ${result.error}`);
      programs.push(result.program);
    }
    if (programs.length > MAX_PROGRAM_SLOTS) throw new Error(`端末保存が${MAX_PROGRAM_SLOTS}件を超えています`);
    if (new Set(programs.map((program) => program.id)).size !== programs.length) {
      throw new Error('端末保存に重複した作戦識別子があります');
    }
    return programs;
  }

  async list(): Promise<readonly ProgramDocument[]> {
    return this.read().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<ProgramDocument | null> {
    return (await this.list()).find((program) => program.id === id) ?? null;
  }

  async save(program: ProgramDocument): Promise<void> {
    const checked = validateProgramDocument(program);
    if (!checked.ok) throw new Error(checked.error);
    const programs = [...(await this.list())];
    const index = programs.findIndex((candidate) => candidate.id === program.id);
    if (index < 0 && programs.length >= MAX_PROGRAM_SLOTS) throw new Error('保存枠は3件までです');
    if (index < 0) programs.push(checked.program);
    else programs[index] = checked.program;
    try {
      this.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(programs));
    } catch {
      throw new Error('端末の保存容量が不足しています。書き出しを使ってください。');
    }
  }

  async delete(id: string): Promise<void> {
    const programs = (await this.list()).filter((program) => program.id !== id);
    try {
      this.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(programs));
    } catch {
      throw new Error('端末保存を更新できません。書き出しを使ってください。');
    }
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('保存処理に失敗しました'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(APP_STORAGE_ID, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REVISION_STORE)) database.createObjectStore(REVISION_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(CURRENT_STORE)) database.createObjectStore(CURRENT_STORE, { keyPath: 'id' });
    };
    request.onblocked = () => reject(new Error('別のタブが保存領域を使用中です。閉じてから再試行してください。'));
    request.onerror = () => reject(request.error ?? new Error('保存領域を開けません'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

class IndexedDbProgramStore implements ProgramStore {
  readonly mode = 'indexeddb' as const;
  private readonly database = openDatabase();
  constructor(private readonly fallback: ProgramStore) {}

  private async databaseOrFallback(): Promise<IDBDatabase | ProgramStore> {
    try {
      return await this.database;
    } catch {
      return this.fallback;
    }
  }

  async list(): Promise<readonly ProgramDocument[]> {
    const databaseOrFallback = await this.databaseOrFallback();
    if ('mode' in databaseOrFallback) return databaseOrFallback.list();
    const database = databaseOrFallback;
    const transaction = database.transaction([REVISION_STORE, CURRENT_STORE], 'readonly');
    const pointers = await requestResult(transaction.objectStore(CURRENT_STORE).getAll()) as CurrentPointer[];
    const revisions = transaction.objectStore(REVISION_STORE);
    const programs: ProgramDocument[] = [];
    for (const pointer of pointers) {
      const stored = await requestResult(revisions.get(`${pointer.id}:${pointer.revision}`)) as StoredRevision | undefined;
      if (!stored) continue;
      const checked = validateProgramDocument(stored.program);
      if (!checked.ok) throw new Error(`保存データを検証できません: ${checked.error}`);
      programs.push(checked.program);
    }
    return programs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<ProgramDocument | null> {
    const databaseOrFallback = await this.databaseOrFallback();
    if ('mode' in databaseOrFallback) return databaseOrFallback.get(id);
    const database = databaseOrFallback;
    const transaction = database.transaction([REVISION_STORE, CURRENT_STORE], 'readonly');
    const pointer = await requestResult(transaction.objectStore(CURRENT_STORE).get(id)) as CurrentPointer | undefined;
    if (!pointer) return null;
    const stored = await requestResult(transaction.objectStore(REVISION_STORE).get(`${id}:${pointer.revision}`)) as StoredRevision | undefined;
    if (!stored) return null;
    const checked = validateProgramDocument(stored.program);
    if (!checked.ok) throw new Error(`保存データを検証できません: ${checked.error}`);
    return checked.program;
  }

  async save(program: ProgramDocument): Promise<void> {
    const checked = validateProgramDocument(program);
    if (!checked.ok) throw new Error(checked.error);
    const databaseOrFallback = await this.databaseOrFallback();
    if ('mode' in databaseOrFallback) return databaseOrFallback.save(checked.program);
    const database = databaseOrFallback;
    const transaction = database.transaction([REVISION_STORE, CURRENT_STORE], 'readwrite');
    const currentStore = transaction.objectStore(CURRENT_STORE);
    const revisionStore = transaction.objectStore(REVISION_STORE);
    const existing = await requestResult(currentStore.get(program.id)) as CurrentPointer | undefined;
    if (!existing) {
      const count = await requestResult(currentStore.count());
      if (count >= MAX_PROGRAM_SLOTS) throw new Error('保存枠は3件までです');
    }
    const revision = (existing?.revision ?? 0) + 1;
    const stored: StoredRevision = { key: `${program.id}:${revision}`, programId: program.id, revision, program: checked.program };
    revisionStore.put(stored);
    if (revision > MAX_PROGRAM_REVISIONS) revisionStore.delete(`${program.id}:${revision - MAX_PROGRAM_REVISIONS}`);
    currentStore.put({ id: program.id, revision } satisfies CurrentPointer);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('保存処理に失敗しました'));
      transaction.onabort = () => reject(transaction.error ?? new Error('保存処理が中断されました'));
    });
  }

  async delete(id: string): Promise<void> {
    const databaseOrFallback = await this.databaseOrFallback();
    if ('mode' in databaseOrFallback) return databaseOrFallback.delete(id);
    const database = databaseOrFallback;
    const transaction = database.transaction([REVISION_STORE, CURRENT_STORE], 'readwrite');
    const revisions = await requestResult(transaction.objectStore(REVISION_STORE).getAll()) as StoredRevision[];
    const revisionStore = transaction.objectStore(REVISION_STORE);
    for (const revision of revisions) if (revision.programId === id) revisionStore.delete(revision.key);
    transaction.objectStore(CURRENT_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('削除処理に失敗しました'));
      transaction.onabort = () => reject(transaction.error ?? new Error('削除処理が中断されました'));
    });
  }
}

function createFallbackProgramStore(): ProgramStore {
  try {
    if (typeof globalThis.localStorage !== 'undefined') return new LocalStorageProgramStore(globalThis.localStorage);
  } catch {
    // Private browsing or a disabled storage area falls through to memory.
  }
  return new MemoryProgramStore();
}

export function createProgramStore(): ProgramStore {
  if (typeof globalThis.indexedDB !== 'undefined') return new IndexedDbProgramStore(createFallbackProgramStore());
  return createFallbackProgramStore();
}

export { MemoryProgramStore };

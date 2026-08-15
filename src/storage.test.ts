import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from './vertical-slice';
import {
  MAX_PROGRAM_BYTES,
  MemoryProgramStore,
  copyProgram,
  createProgramDocument,
  parseProgramJson,
  serializeProgram,
} from './storage';

describe('P2-14 program storage format', () => {
  it('round-trips a bounded program through JSON', () => {
    const program = createProgramDocument(DEFAULT_RULES, '初回作戦', 'program-roundtrip');
    const result = parseProgramJson(serializeProgram(program));

    expect(result).toEqual({ ok: true, program, migrated: false });
  });

  it('migrates a legacy schema without changing the rules', () => {
    const program = createProgramDocument(DEFAULT_RULES, '旧形式', 'program-legacy');
    const legacy = JSON.stringify({ ...program, schemaVersion: 0 });
    const result = parseProgramJson(legacy);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.program.schemaVersion).toBe(1);
      expect(result.program.rules).toEqual(program.rules);
    }
  });

  it('rejects oversized, dangerous, malformed, and duplicate data', () => {
    expect(parseProgramJson('x'.repeat(MAX_PROGRAM_BYTES + 1))).toMatchObject({ ok: false });
    expect(parseProgramJson('{"__proto__":{"polluted":true}}')).toMatchObject({ ok: false, error: /使用できないキー/ });

    const program = createProgramDocument(DEFAULT_RULES, '検査', 'program-invalid');
    expect(parseProgramJson(JSON.stringify({ ...program, rules: [
      { ...program.rules[0], id: 'same-rule' },
      { ...program.rules[1], id: 'same-rule' },
    ] }))).toMatchObject({ ok: false });
    expect(parseProgramJson(JSON.stringify({ ...program, rules: [{ ...program.rules[0], durationTicks: 601 }] }))).toMatchObject({ ok: false });
    expect(parseProgramJson('{not-json')).toMatchObject({ ok: false });
  });

  it('keeps the last valid revision when an invalid save is attempted', async () => {
    const store = new MemoryProgramStore();
    const program = createProgramDocument(DEFAULT_RULES, '正常作戦', 'program-safe');
    await store.save(program);
    const invalid = { ...program, rules: [{ ...DEFAULT_RULES[0], action: 'not-an-action' as never }] };

    await expect(store.save(invalid)).rejects.toThrow();
    await expect(store.get(program.id)).resolves.toEqual(program);
  });

  it('limits program slots and gives copies a new id', async () => {
    const store = new MemoryProgramStore();
    const programs = [0, 1, 2].map((index) => createProgramDocument(DEFAULT_RULES, `作戦${index}`, `program-${index}`));
    for (const program of programs) await store.save(program);
    await expect(store.save(createProgramDocument(DEFAULT_RULES, '満杯', 'program-fourth'))).rejects.toThrow(/3件/);

    const copied = copyProgram(programs[0]!);
    expect(copied.id).not.toBe(programs[0]!.id);
    expect(copied.name).toContain('コピー');
    await store.delete(programs[1]!.id);
    expect(await store.list()).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { decideFirstUse, evaluateFirstUse, type FirstUseRecord } from './first-use';

const record = (anonymousId: string, overrides: Partial<FirstUseRecord> = {}): FirstUseRecord => ({
  anonymousId,
  meaningfulInputSeconds: 20,
  introBattleEndSeconds: 50,
  explainedQuestion: true,
  explainedNextAction: true,
  selfInitiatedReplay: false,
  note: '',
  ...overrides,
});

describe('P4-22 first-use acceptance summary', () => {
  it('passes only when five records meet every four-of-five target', () => {
    const summary = evaluateFirstUse(['a', 'b', 'c', 'd', 'e'].map((id) => record(id)));
    expect(summary.passed).toBe(true);
    expect(decideFirstUse(summary, 0)).toBe('pass');
  });

  it('reports the missing metric and allows at most two improvements', () => {
    const summary = evaluateFirstUse([
      record('a'),
      record('b'),
      record('c'),
      record('d', { meaningfulInputSeconds: 35, explainedQuestion: false }),
      record('e', { meaningfulInputSeconds: null, explainedQuestion: null }),
    ]);
    expect(summary.passed).toBe(false);
    expect(summary.missingData).toContain('意味のある入力を30秒以内に行えた（3/4）');
    expect(summary.missingData).toContain('任務の問いを自分の言葉で説明できた（3/4）');
    expect(decideFirstUse(summary, 0)).toBe('improve');
    expect(decideFirstUse(summary, 1)).toBe('improve');
    expect(decideFirstUse(summary, 2)).toBe('stop-or-redesign');
  });

  it('does not turn fewer than five records into a pass', () => {
    const summary = evaluateFirstUse([record('a'), record('b'), record('c'), record('d')]);
    expect(summary.passed).toBe(false);
    expect(decideFirstUse(summary, 0)).toBe('insufficient-data');
    expect(() => evaluateFirstUse([record('a'), record('a')])).toThrow(RangeError);
  });
});


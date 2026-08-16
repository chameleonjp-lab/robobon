import { describe, expect, it } from 'vitest';
import {
  assessEvidence,
  collectAnalysisEvidence,
  createExperimentIdeas,
  type AnalysisEvidence,
  type EvidenceKind,
} from './analysis';
import type { CombatEvent } from './simulation/combat';

const evidence = (kind: AnalysisEvidence['kind'], tick: number): AnalysisEvidence => ({
  kind,
  tick,
  text: `${kind}-${tick}`,
});

describe('P4-20 evidence assessment', () => {
  it('maps a deterministic 50-case fixture with no false positives', () => {
    const battleFixtures = Array.from({ length: 50 }, (_, index) => {
      const tick = 10 + index;
      if (index < 15) {
        return {
          events: [
            { type: 'MATCH_END', tick, reason: 'time-limit' },
            { type: 'PROJECTILE_FIRED', tick, sourceId: 1 },
          ] as const,
          expected: 'rule-choice' as EvidenceKind,
        };
      }
      if (index < 30) {
        return {
          events: [
            { type: 'MATCH_END', tick, reason: 'destruction' },
            { type: 'HIT_CONFIRMED', tick, sourceId: 2, targetId: 1, value: 4 },
          ] as const,
          expected: 'hit' as EvidenceKind,
        };
      }
      if (index < 45) {
        return {
          events: [
            { type: 'MATCH_END', tick, reason: 'time-limit' },
            { type: 'ACTION_UNAVAILABLE', tick, sourceId: 1, reason: 'cooldown' },
          ] as const,
          expected: 'blocked' as EvidenceKind,
        };
      }
      return {
        events: [
          { type: 'MATCH_END', tick, reason: 'time-limit' },
          { type: index % 2 === 0 ? 'PROJECTILE_FIRED' : 'ACTION_UNAVAILABLE', tick, sourceId: 2 },
        ] as const,
        expected: null,
      };
    });
    const positiveFixtures = battleFixtures.filter((fixture) => fixture.expected !== null);
    const negativeFixtures = battleFixtures.filter((fixture) => fixture.expected === null);
    const truePositives = positiveFixtures.filter((fixture) => collectAnalysisEvidence(
      fixture.events,
      'rule-fire',
    ).some((item) => item.kind === fixture.expected)).length;
    const falsePositives = negativeFixtures.filter((fixture) => collectAnalysisEvidence(
      fixture.events,
      'rule-fire',
    ).length > 0).length;

    expect(battleFixtures).toHaveLength(50);
    expect(truePositives / positiveFixtures.length).toBeGreaterThanOrEqual(0.85);
    expect(falsePositives / negativeFixtures.length).toBeLessThanOrEqual(0.1);
  });

  it('handles same-tick events and keeps the first three observations only', () => {
    const evidence = collectAnalysisEvidence([
      { type: 'PROJECTILE_FIRED', tick: 20, sourceId: 1 },
      { type: 'HIT_CONFIRMED', tick: 20, sourceId: 2, targetId: 1, value: 4 },
      { type: 'ACTION_UNAVAILABLE', tick: 20, sourceId: 1, reason: 'ammo-empty' },
      { type: 'PROJECTILE_FIRED', tick: 20, sourceId: 1 },
    ], 'rule-fire');

    expect(evidence).toHaveLength(3);
    expect(evidence.map((item) => item.kind)).toEqual(['rule-choice', 'hit', 'blocked']);
    expect(evidence.every((item) => item.tick === 20)).toBe(true);
  });

  it('does not treat an enemy-only event as a player observation', () => {
    expect(collectAnalysisEvidence([
      { type: 'PROJECTILE_FIRED', tick: 10, sourceId: 2 },
      { type: 'ACTION_UNAVAILABLE', tick: 11, sourceId: 2, reason: 'cooldown' },
    ], 'rule-fire')).toEqual([]);
  });

  it('rejects invalid evidence limits and supports an explicitly empty limit', () => {
    expect(collectAnalysisEvidence([
      { type: 'PROJECTILE_FIRED', tick: 10, sourceId: 1 },
    ], 'rule-fire', 0)).toEqual([]);
    expect(() => collectAnalysisEvidence([], null, -1)).toThrow(RangeError);
  });

  it('keeps a multi-event result limited instead of claiming a cause', () => {
    const events: CombatEvent[] = [
      { type: 'PROJECTILE_FIRED', tick: 10, sourceId: 1 },
      { type: 'HIT_CONFIRMED', tick: 20, sourceId: 1, targetId: 2, value: 12 },
      { type: 'MATCH_END', tick: 60, reason: 'destruction' },
    ];
    const assessment = assessEvidence([
      evidence('rule-choice', 10),
      evidence('hit', 20),
      evidence('rule-choice', 30),
    ], events);

    expect(assessment.level).toBe('limited');
    expect(assessment.summary).toContain('原因の確定ではありません');
    expect(assessment.gaps.map((gap) => gap.id)).toContain('blocked');
  });

  it('marks a short or one-sided record as insufficient', () => {
    const assessment = assessEvidence([evidence('rule-choice', 10)], [
      { type: 'PROJECTILE_FIRED', tick: 10, sourceId: 1 },
    ]);

    expect(assessment.level).toBe('insufficient');
    expect(assessment.summary).toContain('証拠が足りません');
    expect(assessment.observedKinds).toBe(1);
  });

  it('always provides three bounded experiments without editing rules', () => {
    const assessment = assessEvidence([], []);
    const ideas = createExperimentIdeas(assessment);

    expect(ideas).toHaveLength(3);
    expect(ideas.map((idea) => idea.id)).toEqual(['priority', 'repeat', 'condition']);
  });
});

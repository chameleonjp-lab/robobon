import { describe, expect, it } from 'vitest';
import { assessEvidence, createExperimentIdeas, type AnalysisEvidence } from './analysis';
import type { CombatEvent } from './simulation/combat';

const evidence = (kind: AnalysisEvidence['kind'], tick: number): AnalysisEvidence => ({
  kind,
  tick,
  text: `${kind}-${tick}`,
});

describe('P4-20 evidence assessment', () => {
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

import { describe, expect, it } from 'vitest';
import { INTRO_MISSIONS, missionById, missionStage } from './missions';

describe('P4-21 introductory missions', () => {
  it('defines three distinct questions with a short first-play duration', () => {
    expect(INTRO_MISSIONS).toHaveLength(3);
    expect(new Set(INTRO_MISSIONS.map((mission) => mission.id)).size).toBe(3);
    expect(new Set(INTRO_MISSIONS.map((mission) => mission.question)).size).toBe(3);
    for (const mission of INTRO_MISSIONS) {
      expect(mission.battleTicks).toBeGreaterThanOrEqual(15 * 60);
      expect(mission.battleTicks).toBeLessThanOrEqual(45 * 60);
      expect(mission.stages.map((stage) => stage.id)).toEqual(['edit', 'battle', 'analysis']);
    }
  });

  it('looks up a mission and its staged instruction without a fallback', () => {
    const mission = missionById('heat-window');
    expect(mission.title).toBe('熱の窓を守る');
    expect(missionStage(mission, 'battle').instruction).toContain('耐久');
    expect(() => missionById('unknown' as never)).toThrow(RangeError);
    expect(() => missionStage(mission, 'briefing' as never)).toThrow(RangeError);
  });
});

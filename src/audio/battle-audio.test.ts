import { describe, expect, it } from 'vitest';
import { soundForEvent } from './battle-audio';

describe('P3-16 temporary battle sound mapping', () => {
  it('keeps sound off until important events are explicitly enabled', () => {
    expect(soundForEvent('PROJECTILE_FIRED')).toBe('fire');
    expect(soundForEvent('HIT_CONFIRMED')).toBe('hit');
    expect(soundForEvent('HEAT_STARTED')).toBe('warning');
    expect(soundForEvent('ACTION_UNAVAILABLE')).toBeNull();
    expect(soundForEvent('COOLED')).toBeNull();
  });
});

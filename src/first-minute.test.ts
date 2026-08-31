import { describe, expect, it } from 'vitest';
import { isValidPlayerName, MAX_PLAYER_NAME_LENGTH } from './vertical-slice';

describe('first-minute start gate', () => {
  it('requires a non-blank name within the UI limit', () => {
    expect(isValidPlayerName('')).toBe(false);
    expect(isValidPlayerName('   ')).toBe(false);
    expect(isValidPlayerName('アオ')).toBe(true);
    expect(isValidPlayerName('あ'.repeat(MAX_PLAYER_NAME_LENGTH))).toBe(true);
    expect(isValidPlayerName('あ'.repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(false);
  });
});

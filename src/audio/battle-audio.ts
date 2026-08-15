import type { CombatEventType } from '../simulation/combat';

export type BattleSound = 'fire' | 'hit' | 'warning';

/** Maps only important combat events to a small, temporary sound vocabulary. */
export function soundForEvent(type: CombatEventType): BattleSound | null {
  if (type === 'PROJECTILE_FIRED') return 'fire';
  if (type === 'HIT_CONFIRMED') return 'hit';
  if (type === 'HEAT_STARTED') return 'warning';
  return null;
}

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const SOUND_SETTINGS: Record<BattleSound, { frequency: number; endFrequency: number; duration: number }> = {
  fire: { frequency: 320, endFrequency: 210, duration: 0.08 },
  hit: { frequency: 120, endFrequency: 72, duration: 0.12 },
  warning: { frequency: 560, endFrequency: 360, duration: 0.16 },
};

/**
 * A user-initiated, silent-by-default Web Audio helper. It owns no game state and
 * safely becomes a no-op when the browser does not provide an audio context.
 */
export class BattleAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private readonly lastPlayedAt = new Map<BattleSound, number>();

  get isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const audioWindow = window as AudioContextWindow;
      const AudioContextConstructor = window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioContextConstructor) return false;
      if (!this.context || this.context.state === 'closed') this.context = new AudioContextConstructor();
      await this.context.resume();
      this.enabled = this.context.state === 'running';
      return this.enabled;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
  }

  play(sound: BattleSound): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const lastPlayed = this.lastPlayedAt.get(sound) ?? -Infinity;
    if (now - lastPlayed < 0.045) return;
    this.lastPlayedAt.set(sound, now);
    const setting = SOUND_SETTINGS[sound];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = sound === 'warning' ? 'square' : 'triangle';
    oscillator.frequency.setValueAtTime(setting.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(setting.endFrequency, now + setting.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + setting.duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + setting.duration + 0.01);
  }

  dispose(): void {
    this.enabled = false;
    const context = this.context;
    this.context = null;
    this.lastPlayedAt.clear();
    if (context) void context.close();
  }
}

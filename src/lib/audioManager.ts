/**
 * Audio Manager — Phase 8。
 * 使用 Web Audio API 合成音效（非外部音檔），原因見 ARCHITECTURE.md：
 * 避免真實宗教音檔的授權與文化適當性風險，並移除網路依賴。
 * 任何音效失敗都必須被吞掉，不得中斷核心流程（見下方 try/catch）。
 */
export type SoundName =
  | 'tap'
  | 'confirm'
  | 'incense'
  | 'fire'
  | 'wood'
  | 'shake'
  | 'impact'
  | 'reveal'
  | 'chime'
  | 'completion';

interface ToneSpec {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

const TONES: Record<SoundName, ToneSpec> = {
  tap: { freq: 620, duration: 0.05, type: 'sine', gain: 0.05 },
  confirm: { freq: 520, duration: 0.12, type: 'sine', gain: 0.08 },
  incense: { freq: 300, duration: 0.4, type: 'sine', gain: 0.04 },
  fire: { freq: 180, duration: 0.3, type: 'triangle', gain: 0.05 },
  wood: { freq: 240, duration: 0.08, type: 'square', gain: 0.06 },
  shake: { freq: 400, duration: 0.06, type: 'triangle', gain: 0.04 },
  impact: { freq: 140, duration: 0.15, type: 'square', gain: 0.09 },
  reveal: { freq: 660, duration: 0.35, type: 'sine', gain: 0.07 },
  chime: { freq: 880, duration: 0.6, type: 'sine', gain: 0.06 },
  completion: { freq: 740, duration: 0.5, type: 'sine', gain: 0.08 },
};

class AudioManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private volume = 0.6;
  private unavailable = false;

  setEnabled(value: boolean) {
    this.enabled = value;
  }

  isEnabled() {
    return this.enabled;
  }

  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, value));
  }

  private ensureContext(): AudioContext | null {
    if (this.unavailable) return null;
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.unavailable = true;
        return null;
      }
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  /** 瀏覽器 autoplay 限制要求音訊需在使用者手勢後才能啟動。 */
  async resumeOnUserGesture() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      // 靜默失敗：音效是體驗加分，不是核心流程依賴。
    }
  }

  play(name: SoundName) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const spec = TONES[name];
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = spec.type;
      oscillator.frequency.value = spec.freq;
      gainNode.gain.value = spec.gain * this.volume;
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      const now = ctx.currentTime;
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
      oscillator.start(now);
      oscillator.stop(now + spec.duration + 0.02);
    } catch {
      // 音效播放失敗不得影響核心流程（Phase 8 明確要求）。
    }
  }
}

export const audioManager = new AudioManager();

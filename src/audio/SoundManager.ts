/**
 * Zero-dependency Procedural Web Audio API Sound Synthesizer.
 * Generates punchy, dynamic retro & arcade combat sounds without needing external audio files.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private cooldownMap = new Map<string, number>();
  public isMuted = false;
  public suppressPlayback = false; // true during fast-forward Skip to Result!
  public volume = 0.6;

  constructor() {
    // AudioContext will be initialized on first user interaction or match start
    if (typeof localStorage !== 'undefined') {
      this.isMuted = localStorage.getItem('stickman_sound_muted') === 'true';
      const savedVol = localStorage.getItem('stickman_sound_vol');
      if (savedVol) this.volume = parseFloat(savedVol) || 0.65;
    }
  }

  private ensureContext(key?: string, minIntervalMs = 45): AudioContext | null {
    if (typeof window === 'undefined' || this.isMuted || this.suppressPlayback) return null;
    if (key) {
      const now = performance.now();
      const prev = this.cooldownMap.get(key) ?? 0;
      if (now - prev < minIntervalMs) return null;
      this.cooldownMap.set(key, now);
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('stickman_sound_muted', String(muted));
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('stickman_sound_vol', String(this.volume));
    }
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  // --- SOUND EFFECTS ---

  /** High-pitch metallic katana parry ring with bright harmonics */
  public playParry(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1240, t);
    osc.frequency.exponentialRampToValueAtTime(1860, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(740, t + 0.38);

    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  /** Sharp gunshot punch with sub-bass drop */
  public playSniperShot(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    // Sub-bass thump
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.28);
    oscGain.gain.setValueAtTime(0.9, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.32);

    // Noise crack
    this.playNoiseBurst(0.09, 800, 0.65);
  }

  /** Heavy impact / blunt smash / hammer shockwave */
  public playHammerSlam(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + 0.52);

    gain.gain.setValueAtTime(0.95, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.58);
  }

  /** Crystalline glass shatter noise */
  public playGlassShatter(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    for (const freq of [2100, 2750, 3400]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 200, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.22);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.28);
    }
    this.playNoiseBurst(0.18, 3000, 0.45);
  }

  /** Hydraulic plier clamp / katana snap crunch */
  public playSnap(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.16);
    gain.gain.setValueAtTime(0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Elastic boing sound for Rubber */
  public playBoing(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(560, t + 0.15);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.35);

    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** Electro-taser high-voltage buzz */
  public playElectroZap(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(450, t);
    for (let i = 0; i < 4; i++) {
      osc.frequency.setValueAtTime(380 + (i % 2) * 180, t + i * 0.05);
    }
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** Portal teleport warp whoosh */
  public playPortalWarp(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(840, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.28);

    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  /** Explosion boom + smoke noise */
  public playExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.45);

    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.52);

    this.playNoiseBurst(0.38, 480, 0.7);
  }

  /** Comical Surrender Slide Whistle / Squeak */
  public playSurrenderWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.exponentialRampToValueAtTime(1180, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(210, t + 0.65);

    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.72);
  }

  /** Referee start whistle */
  public playRefereeWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    for (const f of [1820, 2150]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.25);
    }
  }

  /** Slash hit */
  public playSlash(): void {
    const ctx = this.ensureContext('slash', 55);
    if (!ctx || !this.masterGain || this.isMuted) return;
    this.playNoiseBurst(0.08, 1650, 0.42);
  }

  /** Crisp high-ringing steel sword / barrel clash (exact classic stickman CLANG!) */
  public playWeaponClash(): void {
    const ctx = this.ensureContext('clash', 65);
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    for (const [freq, ratio] of [
      [1680, 0.55],
      [2540, 0.4],
      [3390, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 90, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.86, t + 0.28);
      gain.gain.setValueAtTime(ratio, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  /** Roaring flame jet / pyromancy whoosh */
  public playFlameRoar(): void {
    const ctx = this.ensureContext('flame', 140);
    if (!ctx || !this.masterGain || this.isMuted) return;
    this.playNoiseBurst(0.28, 680, 0.45);
  }

  /** Heavy glass pillar rising thud */
  public playGlassRise(): void {
    const ctx = this.ensureContext('glass_rise', 70);
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.14);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /** Bulwark tower shield block clang */
  public playShieldBlock(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(210, t + 0.22);
    gain.gain.setValueAtTime(0.75, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  private playNoiseBurst(durationSec: number, cutoffHz: number, volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + durationSec);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(this.ctx.currentTime);
  }

  public playWeaponPickup(): void {
    const ctx = this.ensureContext('pickup', 60);
    if (!ctx || !this.masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** High-tech piercing laser beam beam-down sweep */
  public playLaserBeam(): void {
    const ctx = this.ensureContext('laser', 50);
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.24);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /** Mechanical motor buzzing rev for saws and drills */
  public playChainsawRev(): void {
    const ctx = this.ensureContext('chainsaw', 60);
    if (!ctx || !this.masterGain || this.isMuted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(240, t + 0.18);
    osc.frequency.linearRampToValueAtTime(140, t + 0.32);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  public announcerEnabled = true;
  private lastAnnounceTime = 0;

  public announce(phrase: string, rate = 1.12, pitch = 1.05): void {
    if (!this.announcerEnabled || this.isMuted || this.suppressPlayback) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const now = performance.now();
    if (now - this.lastAnnounceTime < 750) return;
    this.lastAnnounceTime = now;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = Math.min(1, this.volume * 1.2);
      window.speechSynthesis.speak(utterance);
    } catch {
      // SpeechSynthesis safely ignored if permissions or synthesis offline
    }
  }
}


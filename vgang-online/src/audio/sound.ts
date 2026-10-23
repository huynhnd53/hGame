import { EngineModel, ExhaustVoice, exhaustFor, scheduleDemo } from './exhaust';

/** Exhaust level against the horn, blinker and bumps. */
const ENGINE_LEVEL = 0.25;

/**
 * Small synthesised sound set (no audio files): each bike's exhaust, horn, blinker tick and bumps.
 * Browsers only allow audio after a user gesture, so call unlock() from an input handler.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bikeId = 'scooter-red';
  private engine: EngineModel | null = null;
  private voice: ExhaustVoice | null = null;
  private engineOn = false;
  private lastUpdate = 0;
  private demo: ExhaustVoice | null = null;
  private horn: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Switches to another bike's exhaust note; a running engine keeps running. */
  setBike(id: string): void {
    if (id === this.bikeId) return;
    this.bikeId = id;
    const running = this.engineOn;
    const ctx = this.ctx;
    if (this.voice && ctx) this.voice.stop(ctx.currentTime);
    this.voice = null;
    this.engine = null;
    if (running && ctx) {
      this.ensureVoice();
      this.engine!.setRunning(true);
      // Swapped while running: skip the starter.
      this.engine!.step(1, 0, 0);
    }
  }

  /** Starts the engine on the starter, or switches it off. */
  setEngine(on: boolean): void {
    this.engineOn = on;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.ensureVoice();
    if (on && !this.engine!.running) this.voice!.starter(ctx.currentTime);
    this.engine!.setRunning(on);
  }

  private ensureVoice(): void {
    if (this.voice || !this.ctx || !this.master) return;
    const p = exhaustFor(this.bikeId);
    this.engine = new EngineModel(p);
    this.voice = new ExhaustVoice(this.ctx, this.master, p, ENGINE_LEVEL);
    this.lastUpdate = this.ctx.currentTime;
  }

  /** speed in m/s, throttle 0..1; call once per frame. */
  updateEngine(speed: number, throttle: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.engineOn) this.ensureVoice();
    const e = this.engine;
    if (!e || !this.voice) return;
    const now = ctx.currentTime;
    const dt = Math.min(0.25, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    e.step(dt, speed, throttle);
    this.voice.tick(now, e, speed);
  }

  /** A short rev of a bike's exhaust, for the bike picker. */
  preview(id: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    if (this.demo) this.demo.stop(ctx.currentTime);
    this.demo = scheduleDemo(ctx, this.master, exhaustFor(id), ENGINE_LEVEL, ctx.currentTime + 0.05).voice;
  }

  hornOn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.horn) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.09, ctx.currentTime, 0.01);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    const oscs = [415, 520].map((freq) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain);
    gain.connect(this.master);
    this.horn = { oscs, gain };
  }

  hornOff(): void {
    const ctx = this.ctx;
    const h = this.horn;
    if (!ctx || !h) return;
    h.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    for (const o of h.oscs) o.stop(ctx.currentTime + 0.2);
    this.horn = null;
  }

  tick(high: boolean): void {
    this.blip(high ? 2200 : 1700, 0.018, 0.05);
  }

  bump(strength: number): void {
    this.burst(0.18, 220, Math.min(0.3, 0.06 + strength * 0.03));
  }

  private blip(freq: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private burst(dur: number, cutoff: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }
}

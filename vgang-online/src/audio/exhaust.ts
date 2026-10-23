/**
 * Per-bike exhaust note for a single-cylinder four-stroke: one firing pulse every two revolutions,
 * each pulse ringing the exhaust pipe's resonances. Pulses are scheduled a little ahead of time as
 * short buffers, so it runs on the main thread without an AudioWorklet.
 */

export interface ExhaustProfile {
  /** Short description of the sound for the bike picker. */
  label: string;
  idleRpm: number;
  maxRpm: number;
  /** Twist-and-go scooters hold their rpm while speed builds; geared bikes step through the gears. */
  cvt: boolean;
  /** Geared bikes: engine rpm per m/s in each gear, first gear first. */
  gears?: number[];
  /** Exhaust resonances of each firing pulse: frequency (Hz), decay time (s), amplitude. */
  res: [number, number, number][];
  /** Combustion hiss mixed into each pulse. */
  hiss: number;
  /** Rasp: how hard the note is driven into soft clipping. */
  drive: number;
  /** Low-pass cutoff around which the tone opens up with throttle (Hz). */
  tone: number;
  /** CVT belt whine level (0 = none). */
  whine: number;
  /** How readily it pops and crackles when the throttle is closed at high rpm (0 = never). */
  pops: number;
  /** Output level relative to the other bikes. */
  volume: number;
  /** Scales the raw pulse sum so full throttle peaks near 1 before the rasp stage. */
  norm: number;
}

export const EXHAUST: Record<string, ExhaustProfile> = {
  'scooter-red': {
    label: 'Êm, đều, rít nhẹ khi lên ga',
    idleRpm: 1700, maxRpm: 7500, cvt: true,
    res: [[140, 0.01, 1], [380, 0.004, 0.5]],
    hiss: 0.25, drive: 1.3, tone: 1800, whine: 0.025, pops: 0, volume: 0.85, norm: 0.97,
  },
  'scooter-blue-analog': {
    label: 'Nhỏ và hiền',
    idleRpm: 1600, maxRpm: 7000, cvt: true,
    res: [[120, 0.009, 1], [300, 0.003, 0.35]],
    hiss: 0.12, drive: 1.0, tone: 1100, whine: 0.02, pops: 0, volume: 0.65, norm: 1.13,
  },
  'scooter-white-lcd': {
    label: 'Trầm, dày, nhiều bass',
    idleRpm: 1450, maxRpm: 8000, cvt: true,
    res: [[82, 0.018, 1], [210, 0.007, 0.45]],
    hiss: 0.18, drive: 1.5, tone: 1300, whine: 0.04, pops: 0, volume: 0.95, norm: 1.23,
  },
  'scooter-black-lcd': {
    label: 'Thể thao, khàn, nhả ga phụt phụt',
    idleRpm: 1650, maxRpm: 8500, cvt: true,
    res: [[105, 0.012, 1], [430, 0.005, 0.7]],
    hiss: 0.45, drive: 2.6, tone: 2600, whine: 0.03, pops: 0.35, volume: 0.95, norm: 0.77,
  },
  'naked-black': {
    label: 'Đanh, có sang số, nổ pô lụp bụp',
    idleRpm: 1350, maxRpm: 10500, cvt: false, gears: [840, 540, 400, 330, 280],
    res: [[92, 0.015, 1], [300, 0.006, 0.6], [880, 0.002, 0.25]],
    hiss: 0.4, drive: 2.3, tone: 3200, whine: 0, pops: 0.8, volume: 1, norm: 0.63,
  },
  'underbone-white-dial': {
    label: 'Xe số "tạch tạch" giòn',
    idleRpm: 1500, maxRpm: 8800, cvt: false, gears: [1060, 630, 450, 330],
    res: [[175, 0.0065, 1], [520, 0.003, 0.55]],
    hiss: 0.3, drive: 1.7, tone: 2500, whine: 0, pops: 0.1, volume: 0.85, norm: 1.09,
  },
};

export function exhaustFor(bikeId: string): ExhaustProfile {
  return EXHAUST[bikeId] ?? EXHAUST['scooter-red'];
}

const CRANK_TIME = 0.65;
const SHIFT_TIME = 0.14;

/** Engine speed and gear from the rider's throttle and road speed; no audio, so it can be tested. */
export class EngineModel {
  rpm = 0;
  gear = 0;
  /** Effective throttle reaching the engine (cut to 0 while shifting). */
  load = 0;
  running = false;
  private crank = 0;
  private shift = 0;
  private time = 0;

  constructor(readonly p: ExhaustProfile) {}

  /** Starts with a short crank on the starter, or stops. */
  setRunning(on: boolean): void {
    if (on && !this.running) this.crank = CRANK_TIME;
    this.running = on;
  }

  get cranking(): boolean {
    return this.crank > 0;
  }

  step(dt: number, speed: number, throttle: number): void {
    const p = this.p;
    this.time += dt;
    const v = Math.abs(speed);
    const ease = (target: number, rate: number) => {
      this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));
    };
    if (!this.running) {
      this.load = 0;
      ease(0, 6);
      if (this.rpm < 150) this.rpm = 0;
      return;
    }
    if (this.crank > 0) {
      this.crank -= dt;
      this.load = 0;
      ease(280 + 60 * Math.sin(this.time * 60), 50);
      // The engine catches and flares up before settling to idle.
      if (this.crank <= 0) this.rpm = p.idleRpm * 1.7;
      return;
    }
    const idle = p.idleRpm * (1 + 0.02 * Math.sin(this.time * 7.3));
    this.load = throttle;
    if (p.cvt) {
      const target = throttle > 0 ? Math.min(p.maxRpm * 0.92, idle + (p.maxRpm * 0.78 - idle) * throttle + v * 18) : idle + Math.min(v * 10, p.maxRpm * 0.15);
      ease(target, target > this.rpm ? 10 : 2.8);
      return;
    }
    const gears = p.gears ?? [p.maxRpm / 10];
    if (this.shift > 0) {
      // Clutch in and throttle off for a moment while the next gear goes in.
      this.shift -= dt;
      this.load = 0;
      ease(v * gears[this.gear], 12);
      return;
    }
    if (this.gear > 0 && v * gears[this.gear] < p.maxRpm * 0.35) this.gear--;
    const slip = idle + throttle * (p.maxRpm * 0.45 - idle);
    const target = Math.min(p.maxRpm, Math.max(throttle > 0 ? slip : idle, v * gears[this.gear]));
    ease(target, target > this.rpm ? 50 : 2.8);
    if (throttle > 0 && this.rpm > p.maxRpm * 0.9 && this.gear < gears.length - 1) {
      this.gear++;
      this.shift = SHIFT_TIME;
    }
  }
}

const LOOKAHEAD = 0.1;
const HEADROOM = 3;
const VARIANTS = 6;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays one bike's exhaust into `dest`. Call tick() every frame with the engine state. */
export class ExhaustVoice {
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly pre: GainNode;
  private readonly whineOsc: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly intake: AudioBufferSourceNode;
  private readonly intakeGain: GainNode;
  private readonly pulses: AudioBuffer[] = [];
  private readonly pops: AudioBuffer[] = [];
  private readonly rand = rng(7);
  private nextPulse = 0;
  private lastPulse = 0;
  private smoothLoad = 0;
  private stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    readonly p: ExhaustProfile,
    level: number,
    shape = true,
  ) {
    const sr = ctx.sampleRate;
    const r = this.rand;
    // A few slightly different firing pulses so idle does not sound like a loop.
    const len = Math.floor(sr * 0.08);
    for (let v = 0; v < VARIANTS; v++) {
      const b = ctx.createBuffer(1, len, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let s = 0;
        for (const [f, tau, a] of p.res) s += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t);
        d[i] = s + gauss(r) * Math.exp(-t / 0.004) * p.hiss;
      }
      this.pulses.push(b);
    }
    // Unburnt fuel going off in the pipe: a crack plus a low thump.
    const plen = Math.floor(sr * 0.03);
    for (let v = 0; v < 4; v++) {
      const b = ctx.createBuffer(1, plen, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < plen; i++) {
        const t = i / sr;
        d[i] = gauss(r) * Math.exp(-t / 0.006) + 2.5 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.012);
      }
      this.pops.push(b);
    }

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = p.tone * 0.55;
    this.pre = ctx.createGain();
    // The shaper only sees -1..1, so leave headroom for peaks above the full-throttle level.
    this.pre.gain.value = shape ? p.norm / HEADROOM : p.norm;
    this.out = ctx.createGain();
    this.out.gain.value = level * p.volume * 0.9;
    this.filter.connect(this.pre);
    if (shape) {
      const shaper = ctx.createWaveShaper();
      const n = 1024;
      const curve = new Float32Array(n);
      // tanh(drive · x) for x up to HEADROOM, scaled so the usual full-throttle level comes out near 1.
      for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * HEADROOM * p.drive) / Math.tanh(p.drive);
      shaper.curve = curve;
      shaper.oversample = '2x';
      this.pre.connect(shaper);
      shaper.connect(this.out);
    } else {
      this.pre.connect(this.out);
    }
    this.out.connect(dest);

    // CVT belt whine rising with road speed.
    this.whineOsc = ctx.createOscillator();
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain);
    this.whineGain.connect(this.pre);
    this.whineOsc.start();
    // Intake roar under load.
    const nb = ctx.createBuffer(1, sr, sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = gauss(r) * 0.5;
    this.intake = ctx.createBufferSource();
    this.intake.buffer = nb;
    this.intake.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.6;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(bp);
    bp.connect(this.intakeGain);
    this.intakeGain.connect(this.pre);
    this.intake.start();
  }

  /** Schedules firing pulses up to a little past `now` and steers the tone. */
  tick(now: number, e: EngineModel, speed: number): void {
    if (this.stopped) return;
    const p = this.p;
    const rpm = e.rpm;
    const rpmShare = Math.min(1, rpm / p.maxRpm);
    const x = Math.min(1, Math.max(0, e.load * 0.8 + rpmShare * 0.4));
    this.filter.frequency.setTargetAtTime(p.tone * 0.55 * Math.pow(1.6 / 0.55, x), now, 0.04);
    this.intakeGain.gain.setTargetAtTime(0.06 * e.load * rpmShare, now, 0.05);
    const v = Math.abs(speed);
    this.whineOsc.frequency.setTargetAtTime(260 + v * 38, now, 0.05);
    this.whineGain.gain.setTargetAtTime(e.running ? p.whine * Math.min(1, v / 4) : 0, now, 0.1);

    if (rpm < 150) {
      this.nextPulse = 0;
      this.lastPulse = 0;
      return;
    }
    if (this.nextPulse < now) this.nextPulse = now + 0.005;
    // When the engine speeds up (e.g. catching after the starter), do not wait out the old, slow gap.
    if (this.lastPulse > 0) this.nextPulse = Math.min(this.nextPulse, Math.max(now, this.lastPulse + 120 / rpm));
    const until = now + LOOKAHEAD;
    while (this.nextPulse < until) {
      this.fire(this.nextPulse, e, rpm);
      this.lastPulse = this.nextPulse;
      let gap = 120 / rpm;
      // A slightly lumpy idle.
      if (rpm < p.idleRpm * 1.3) gap *= 1 + (this.rand() - 0.5) * 0.04;
      this.nextPulse += gap;
    }
  }

  private fire(t: number, e: EngineModel, rpm: number): void {
    const p = this.p;
    const r = this.rand;
    this.smoothLoad += (e.load - this.smoothLoad) * 0.3;
    let amp = e.cranking ? 0.25 : 0.45 + 0.55 * this.smoothLoad;
    amp *= (0.8 + 0.4 * r()) * (0.6 + 0.4 * Math.min(1, (rpm / p.maxRpm) * 2));
    this.play(this.pulses[Math.floor(r() * VARIANTS)], t, amp, 1 + (0.15 * rpm) / p.maxRpm);
    if (p.pops && !e.cranking && e.load === 0 && rpm > p.maxRpm * 0.3 && r() < p.pops * 0.08) {
      this.play(this.pops[Math.floor(r() * this.pops.length)], t, (1.2 + r()) * p.pops, 1);
    }
  }

  private play(buf: AudioBuffer, t: number, amp: number, rate: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = amp;
    src.connect(g);
    g.connect(this.filter);
    src.start(t);
  }

  /** Starter motor whir while cranking. */
  starter(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(210, t + CRANK_TIME);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 0.03;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.setTargetAtTime(0, t + CRANK_TIME, 0.03);
    lfo.connect(depth);
    depth.connect(g.gain);
    o.connect(g);
    g.connect(this.filter);
    o.start(t);
    lfo.start(t);
    o.stop(t + CRANK_TIME + 0.2);
    lfo.stop(t + CRANK_TIME + 0.2);
  }

  /** Fades out and frees the voice. */
  stop(at: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.out.gain.setTargetAtTime(0, at, 0.08);
    this.whineOsc.stop(at + 0.6);
    this.intake.onended = () => this.out.disconnect();
    this.intake.stop(at + 0.6);
  }
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

/**
 * A short scripted rev for the bike picker (and offline tests): crank, idle, two blips, and optionally
 * a full-throttle run. Everything is scheduled up front from `t0`.
 */
export function scheduleDemo(ctx: BaseAudioContext, dest: AudioNode, p: ExhaustProfile, level: number, t0: number, full = false, shape = true): { duration: number; voice: ExhaustVoice } {
  const voice = new ExhaustVoice(ctx, dest, p, level, shape);
  const e = new EngineModel(p);
  const duration = full ? 10 : 3.8;
  const throttleAt = (s: number) => {
    if ((s >= 2.0 && s < 2.25) || (s >= 2.7 && s < 2.9)) return 0.8;
    if (full && s >= 4.6 && s < 8.4) return 1;
    return 0;
  };
  e.setRunning(true);
  voice.starter(t0);
  let speed = 0;
  const dt = 0.005;
  for (let s = 0; s < duration; s += dt) {
    const th = throttleAt(s);
    // Rough road speed during the full-throttle run, so geared bikes change up.
    if (full && th > 0) speed += ((p.cvt ? 3 : 6.5) / (1 + speed / (p.cvt ? 10 : 14))) * dt;
    else speed *= 1 - 0.25 * dt;
    e.step(dt, speed, th);
    voice.tick(t0 + s, e, speed);
  }
  voice.stop(t0 + duration - 0.3);
  return { duration, voice };
}

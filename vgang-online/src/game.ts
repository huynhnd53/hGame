import * as THREE from 'three';
import { exhaustFor } from './audio/exhaust';
import { Sound } from './audio/sound';
import { drawClassicGauge } from './cockpit/classicGauge';
import { Cockpit } from './cockpit/cockpit';
import { type Action, Input } from './input/input';
import { BIKES, bikeDef, wheelieDifficulty } from './cockpit/bikes';
import { getFlag, getString, loadRide, type RideSave, saveRide, setFlag, setString } from './save';
import { type Block, type City, generateCity, groundHeight, HALF, ROAD, SIDEWALK } from './sim/city';
import { circleHitsRect, type Rect, segmentEntersRect } from './sim/geometry';
import { CRUISE_SPEED, SCOOTER_RADIUS, type ScooterState, stepScooter } from './sim/scooter';
import { Minimap } from './ui/minimap';
import { Traffic } from './sim/traffic';
import { NpcView } from './world/night/npcs';
import { PlayerBike, REAR_CONTACT_Z } from './world/night/rider';
import { balanceAngle, isWheelie, loopAngle, newWheelie, stepWheelie } from './sim/wheelie';
import { buildNightCity, FOG_COLOR, FOG_DENSITY, type NightCity } from './world/night/simpleCity';

const EYE_HEIGHT = 1.35;
/** Third-person camera: distance behind the rider, and the point it orbits around (above the seat). */
const CHASE_DISTANCE = 4.6;
const CHASE_PIVOT_HEIGHT = 1.2;
const SAVE_INTERVAL = 2;
/** Seconds lying on the road after looping out a wheelie. */
const CRASH_TIME = 2.5;
/** Wheelies shorter than this are not worth announcing. */
const WHEELIE_REPORT_M = 3;
const LANDMARK_NAMES: Partial<Record<Block['kind'], string>> = {
  lake: 'Hồ Sen',
  park: 'Công viên',
  plaza: 'Quảng trường Đài phun nước',
};

type Signal = 'left' | 'right' | null;
type View = 'first' | 'third';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

export class Game {
  readonly city: City = generateCity();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
  readonly input: Input;
  readonly cockpit: Cockpit;
  readonly sound = new Sound();
  readonly minimap: Minimap;
  readonly traffic: Traffic;
  private npcs: NpcView;

  scooter: ScooterState;
  engineOn = false;
  signal: Signal = null;
  headlight: boolean;
  odometerKm: number;

  private timer = new THREE.Timer();
  private elapsed = 0;
  private renderScale = 1;
  private perfTime = 0;
  private perfFrames = 0;
  private fastPeriods = 0;
  private saveTimer = 0;
  private signalHeading = 0;
  private lastBlinkPhase = false;
  private shake = 0;
  /** Smoothed height of the ground under the scooter (rises onto the sidewalk). */
  private ground = 0;
  private groundTarget = 0;
  private staticColliders: Rect[] = [];
  private hornHeld = false;
  private hornDownAt = 0;
  private night: NightCity;
  private cockpitLight = -1;
  private landmark: Block | null = null;
  private throttle = 0;
  private brake = 0;
  private view: View = getString('view') === 'third' ? 'third' : 'first';
  private playerBike: PlayerBike;
  /** Third-person camera direction, trailing the scooter's heading. */
  private camYaw = 0;
  private houseWalls: Rect[];
  private miniGauge = $('mini-gauge') as HTMLCanvasElement;
  private miniGaugeKey = '';
  private wheelie = newWheelie();
  private crashTimer = 0;
  private wheelieBest = Number(getString('wheelie-best')) || 0;
  private wheelieHudKey = '';

  constructor(canvas: HTMLCanvasElement) {
    const { spawn } = this.city;
    const saved = loadRide({ odometerKm: 0, x: spawn.x, z: spawn.z, heading: spawn.heading, headlight: true, muted: false });
    // A saved position inside a block or off the map (e.g. after a layout change) falls back to the spawn point.
    const b = this.city.bounds;
    const invalid =
      Math.abs(saved.x - b.x) > b.w / 2 - 1 ||
      Math.abs(saved.z - b.z) > b.d / 2 - 1 ||
      this.city.colliders.some((c) => Math.abs(saved.x - c.x) < c.w / 2 + 0.5 && Math.abs(saved.z - c.z) < c.d / 2 + 0.5);
    this.scooter = invalid
      ? { x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0, steer: 0 }
      : { x: saved.x, z: saved.z, heading: saved.heading, speed: 0, steer: 0 };
    this.odometerKm = saved.odometerKm;
    this.headlight = saved.headlight;
    this.sound.setMuted(saved.muted);

    // Everything is unlit (light is baked into vertex colours at load), so this runs on modest GPUs too.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.night = buildNightCity(this.city, `${import.meta.env.BASE_URL}assets/`);
    this.scene.add(this.night.group);
    this.staticColliders = [...this.city.colliders, ...this.night.obstacles];
    // Motorbikes, cars and people moving about the city.
    this.traffic = new Traffic(this.city, 220, 320);
    this.npcs = new NpcView(this.traffic, (x, z) => this.night.levelAt(x, z), `${import.meta.env.BASE_URL}assets/`);
    this.scene.add(this.npcs.group);

    this.camera.rotation.order = 'YXZ';
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.scene.add(this.camera);

    this.cockpit = new Cockpit(`${import.meta.env.BASE_URL}assets/`);
    this.cockpit.setBike(bikeDef(getString('bike')).id);
    this.playerBike = new PlayerBike(bikeDef(this.cockpit.bikeId).model);
    this.scene.add(this.playerBike.group);
    this.camYaw = this.scooter.heading;
    // House fronts the chase camera must stay in front of.
    this.houseWalls = this.city.blocks.filter((b) => b.kind === 'houses').map((b) => b.inner);
    $('cockpit-layer').append(this.cockpit.root);
    this.cockpit.onAction = (a) => this.handle(a);

    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, this.city);

    this.input = new Input($('app'), $('joystick'), $('joystick-knob'));
    this.input.onFirstInput = () => this.sound.unlock();
    this.input.onTouchModeChange = () => this.refreshChrome();

    this.bindUi();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.persist();
        this.input.reset();
      }
    });

    // The start screen (bike picker) shows on every visit.
    this.buildBikePicker();
    this.refreshChrome();
  }

  private pixelRatio(): number {
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.5) * this.renderScale);
  }

  /** Dynamic resolution: trade sharpness for a steady frame rate on slower GPUs. */
  private adaptResolution(frameTime: number): void {
    if (this.elapsed < 3) return;
    this.perfTime += frameTime;
    this.perfFrames++;
    if (this.perfTime < 2) return;
    const avg = this.perfTime / this.perfFrames;
    this.perfTime = 0;
    this.perfFrames = 0;
    let next = this.renderScale;
    if (avg > 0.026) {
      next = Math.max(0.5, this.renderScale - 0.15);
      this.fastPeriods = 0;
    } else if (avg < 0.0175 && ++this.fastPeriods >= 2) {
      next = Math.min(1, this.renderScale + 0.1);
      this.fastPeriods = 0;
    }
    if (next !== this.renderScale) {
      this.renderScale = next;
      const pr = this.pixelRatio();
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  /** Cards for each front end; picking one swaps the handlebar photo and remembers it. */
  private buildBikePicker(): void {
    const picker = $('bike-picker');
    const cards: HTMLButtonElement[] = [];
    const select = (id: string) => {
      this.cockpit.setBike(id);
      this.sound.setBike(id);
      this.setPlayerBike(id);
      this.wheelie = newWheelie();
      setString('bike', id);
      for (const c of cards) c.setAttribute('aria-checked', String(c.dataset.id === id));
    };
    for (const bike of BIKES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gauge-card bike-card';
      card.setAttribute('role', 'radio');
      card.dataset.id = bike.id;
      const img = document.createElement('img');
      img.src = `${import.meta.env.BASE_URL}assets/${bike.image}`;
      img.alt = '';
      // Show only the handlebar part of the photo.
      img.style.objectPosition = `50% ${Math.round((bike.barTop / bike.height) * 100 + 15)}%`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = bike.name;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = bike.description;
      const exhaust = document.createElement('span');
      exhaust.className = 'exhaust';
      exhaust.textContent = `Tiếng bô: ${exhaustFor(bike.id).label}`;
      const wheelie = document.createElement('span');
      wheelie.className = 'exhaust';
      wheelie.textContent = `Bốc đầu: ${wheelieDifficulty(bike)}`;
      card.append(img, name, sub, exhaust, wheelie);
      card.addEventListener('click', () => {
        select(bike.id);
        // Picking a bike gives it a quick rev so each exhaust note can be heard.
        this.sound.unlock();
        this.sound.preview(bike.id);
      });
      cards.push(card);
      picker.append(card);
    }
    select(this.cockpit.bikeId);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private bindUi(): void {
    $('panel-close').addEventListener('click', () => {
      this.sound.unlock();
      $('panel').classList.add('hidden');
    });
    $('btn-help').addEventListener('click', () => $('panel').classList.remove('hidden'));
    $('btn-mute').addEventListener('click', () => this.handle('mute'));
    $('btn-view').addEventListener('click', () => this.handle('view'));
    $('rotate-dismiss').addEventListener('click', () => {
      setFlag('rotate-dismissed');
      this.refreshChrome();
    });

    const press = (id: string, down: Action, up?: Action) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.sound.unlock();
        this.handle(down);
      });
      if (up) {
        const release = () => this.handle(up);
        el.addEventListener('pointerup', release);
        el.addEventListener('pointerleave', release);
        el.addEventListener('pointercancel', release);
      }
    };
    press('t-horn', 'horn-down', 'horn-up');
    press('t-signal-left', 'signal-left');
    press('t-signal-right', 'signal-right');
    press('t-light', 'light');
    press('t-engine', 'engine');
    const lift = $('t-wheelie');
    lift.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.liftButton = true;
      lift.classList.add('on');
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      lift.addEventListener(ev, () => {
        this.input.liftButton = false;
        lift.classList.remove('on');
      });
    }
  }

  private handle(action: Action): void {
    this.sound.unlock();
    switch (action) {
      case 'engine':
        this.engineOn = !this.engineOn;
        this.sound.setEngine(this.engineOn);
        if (!this.engineOn) this.toast('Đã tắt máy.');
        break;
      case 'horn-down':
        this.hornHeld = true;
        this.hornDownAt = performance.now();
        this.sound.hornOn();
        break;
      case 'horn-up': {
        this.hornHeld = false;
        // A quick tap still gives a short beep.
        const wait = Math.max(0, 220 - (performance.now() - this.hornDownAt));
        window.setTimeout(() => {
          if (!this.hornHeld) this.sound.hornOff();
        }, wait);
        break;
      }
      case 'signal-left':
      case 'signal-right': {
        const side = action === 'signal-left' ? 'left' : 'right';
        this.signal = this.signal === side ? null : side;
        this.signalHeading = this.scooter.heading;
        this.sound.tick(true);
        break;
      }
      case 'light':
        this.headlight = !this.headlight;
        this.sound.tick(false);
        this.persist();
        break;
      case 'mute':
        this.sound.setMuted(!this.sound.muted);
        this.persist();
        break;
      case 'view':
        this.view = this.view === 'first' ? 'third' : 'first';
        this.camYaw = this.scooter.heading;
        setString('view', this.view);
        break;
    }
    this.refreshChrome();
  }

  private toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 2) box.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 3500);
  }

  private persist(): void {
    const s = this.scooter;
    const data: RideSave = {
      odometerKm: this.odometerKm,
      x: s.x,
      z: s.z,
      heading: s.heading,
      headlight: this.headlight,
      muted: this.sound.muted,
    };
    saveRide(data);
  }

  private refreshChrome(): void {
    const touch = this.input.touchMode;
    $('touch').classList.toggle('hidden', !touch);
    $('btn-mute').textContent = this.sound.muted ? 'Âm thanh: tắt' : 'Âm thanh: bật';
    // The button names the view it switches to.
    $('btn-view').textContent = this.view === 'first' ? 'Nhìn: sau xe' : 'Nhìn: tay lái';
    $('app').classList.toggle('view-third', this.view === 'third');
    $('t-light').classList.toggle('on', this.headlight);
    $('t-engine').classList.toggle('on', this.engineOn);
    $('t-engine').textContent = this.engineOn ? 'Tắt' : 'Đề';
    $('t-signal-left').classList.toggle('on', this.signal === 'left');
    $('t-signal-right').classList.toggle('on', this.signal === 'right');
    const portrait = window.innerHeight > window.innerWidth;
    $('rotate-hint').classList.toggle('hidden', !(touch && portrait && !getFlag('rotate-dismissed')));
    this.updatePrompt();
  }

  private updatePrompt(): void {
    const prompt = $('prompt');
    const helpOpen = !$('panel').classList.contains('hidden');
    let html = '';
    if (!this.engineOn && !helpOpen) {
      html = this.input.touchMode
        ? 'Chạm nút <b>Đề</b> (hoặc nút ⚡ trên tay lái) để nổ máy'
        : 'Nhấn <kbd>K</kbd> hoặc bấm nút ⚡ trên tay lái để nổ máy';
    }
    if (prompt.innerHTML !== html) prompt.innerHTML = html;
    prompt.classList.toggle('hidden', html === '');
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.cockpit.layout(w, h);
    this.refreshChrome();
  }

  private updateSignals(): { left: boolean; right: boolean } {
    if (!this.signal) return { left: false, right: false };
    // Cancel automatically once a turn is finished and the bars are straight again.
    let turned = this.scooter.heading - this.signalHeading;
    turned = Math.atan2(Math.sin(turned), Math.cos(turned));
    if (Math.abs(turned) > 1.1 && Math.abs(this.scooter.steer) < 0.15) {
      this.signal = null;
      this.refreshChrome();
      return { left: false, right: false };
    }
    const phase = Math.floor(this.elapsed * 3) % 2 === 0;
    if (phase !== this.lastBlinkPhase) {
      this.lastBlinkPhase = phase;
      this.sound.tick(phase);
    }
    return { left: this.signal === 'left' && phase, right: this.signal === 'right' && phase };
  }

  private updateLandmark(): void {
    const s = this.scooter;
    let near: Block | null = null;
    for (const b of this.city.blocks) {
      if (b.kind === 'houses') continue;
      if (Math.abs(s.x - b.rect.x) < b.rect.w / 2 + 10 && Math.abs(s.z - b.rect.z) < b.rect.d / 2 + 10) near = b;
    }
    if (near !== this.landmark) {
      this.landmark = near;
      const name = near ? LANDMARK_NAMES[near.kind] : undefined;
      $('place').textContent = name ?? 'Dạo phố';
      if (name) this.toast(`Đang đi ngang ${name}`);
    }
  }

  /** Runs the wheelie balance, and reports landings and crashes. */
  private updateWheelie(dt: number, brake: number, lift: boolean): void {
    const profile = bikeDef(this.cockpit.bikeId).wheelie;
    for (let left = dt; left > 1e-6; left -= 1 / 60) {
      const ev = stepWheelie(
        this.wheelie,
        { throttle: this.throttle, brake, lift: lift && this.engineOn, speed: this.scooter.speed },
        profile,
        Math.min(1 / 60, left),
      );
      if (ev.landed) {
        const { impact, distance } = ev.landed;
        if (impact > 1.2) {
          this.shake = Math.max(this.shake, Math.min(0.6, impact * 0.12));
          this.sound.bump(2 + impact * 2);
        }
        if (distance >= WHEELIE_REPORT_M) this.reportWheelie(distance);
      }
      if (ev.crashed) {
        this.crash();
        break;
      }
    }
  }

  private reportWheelie(distance: number): void {
    const d = distance.toFixed(1).replace('.', ',');
    if (distance > this.wheelieBest) {
      this.wheelieBest = distance;
      setString('wheelie-best', distance.toFixed(1));
      this.toast(`Bốc đầu ${d} m — kỷ lục mới!`);
    } else {
      this.toast(`Bốc đầu ${d} m`);
    }
  }

  /** Looped out: the bike goes over backwards, the engine stalls, and the rider has to start again. */
  private crash(): void {
    this.crashTimer = CRASH_TIME;
    // The rider is off the bike: no handlebars in view while lying on the road.
    $('app').classList.add('crashed');
    this.scooter = { ...this.scooter, speed: 0, steer: 0 };
    this.engineOn = false;
    this.sound.setEngine(false);
    this.sound.bump(10);
    this.shake = 0.6;
    this.toast('Lật xe rồi! Nổ máy lại để đi tiếp.');
    this.refreshChrome();
  }

  private updateWheelieHud(): void {
    const box = $('wheelie');
    const crashed = this.crashTimer > 0;
    const show = crashed || isWheelie(this.wheelie);
    const profile = bikeDef(this.cockpit.bikeId).wheelie;
    const loop = loopAngle(profile);
    const bal = balanceAngle(profile);
    const pct = (a: number) => `${Math.max(0, Math.min(100, (a / loop) * 100)).toFixed(1)}%`;
    const best = this.wheelieBest > 0 ? ` · Kỷ lục ${this.wheelieBest.toFixed(1).replace('.', ',')} m` : '';
    const text = crashed ? 'Lật xe!' : `Bốc đầu ${this.wheelie.distance.toFixed(1).replace('.', ',')} m${best}`;
    const key = [show, crashed, text, pct(this.wheelie.pitch), bal].join('|');
    if (key === this.wheelieHudKey) return;
    this.wheelieHudKey = key;
    box.classList.toggle('hidden', !show);
    box.classList.toggle('crash', crashed);
    if (!show) return;
    $('wheelie-text').textContent = text;
    const zone = box.querySelector<HTMLElement>('.wheelie-zone')!;
    // Green zone: just under the balance point, where small throttle changes hold the bike.
    zone.style.left = pct(bal - 0.15);
    zone.style.width = `${(0.2 / loop) * 100}%`;
    box.querySelector<HTMLElement>('.wheelie-mark')!.style.left = crashed ? '100%' : pct(this.wheelie.pitch);
  }

  private setPlayerBike(id: string): void {
    this.scene.remove(this.playerBike.group);
    this.playerBike.dispose();
    this.playerBike = new PlayerBike(bikeDef(id).model);
    this.scene.add(this.playerBike.group);
  }

  /** Chase camera behind the rider; dragging orbits it, and it never ends up inside a house. */
  private placeChaseCamera(dt: number, jolt: number): void {
    const s = this.scooter;
    let turn = s.heading - this.camYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.camYaw += turn * (1 - Math.exp(-dt * 3.5));
    const yaw = this.camYaw + this.input.look.yaw * 2;
    const pitch = Math.max(0.06, Math.min(0.9, 0.3 - this.input.look.pitch * 1.5));
    const dx = Math.sin(yaw) * Math.cos(pitch);
    const dz = Math.cos(yaw) * Math.cos(pitch);
    const px = s.x;
    const pz = s.z;
    const py = this.ground + CHASE_PIVOT_HEIGHT;
    const dist = this.chaseClearance(px, pz, dx, dz, CHASE_DISTANCE + Math.min(1.6, Math.abs(s.speed) / 16.7) * 0.6);
    this.camera.position.set(px + dx * dist, py + Math.sin(pitch) * dist + jolt, pz + dz * dist);
    this.camera.lookAt(px - Math.sin(yaw) * 2, py + 0.2, pz - Math.cos(yaw) * 2);
  }

  /** How far back the camera can go along (dx, dz) before hitting a house front or the outer row of houses. */
  private chaseClearance(px: number, pz: number, dx: number, dz: number, dist: number): number {
    let best = dist;
    const ex = dx * dist;
    const ez = dz * dist;
    for (const w of this.houseWalls) {
      const t = segmentEntersRect(px, pz, ex, ez, w, 0.3);
      if (t !== null) best = Math.min(best, t * dist);
    }
    // The outer ring of houses starts just past the outermost sidewalk.
    const lim = HALF + ROAD / 2 + SIDEWALK - 0.3;
    for (const [p, e] of [
      [px, ex],
      [pz, ez],
    ]) {
      if (Math.abs(p + e) > lim && e !== 0) best = Math.min(best, (((Math.sign(e) * lim - p) / e) * dist));
    }
    return Math.max(0.8, best - 0.35);
  }

  private drawMiniGauge(v: Parameters<typeof drawClassicGauge>[1]): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.miniGauge.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.miniGauge.clientHeight * dpr));
    const key = [v.speedKmh.toFixed(1), v.leftLamp, v.rightLamp, v.headlight, v.engineOn, v.odometerKm.toFixed(1), w, h].join('|');
    if (key === this.miniGaugeKey) return;
    this.miniGaugeKey = key;
    if (this.miniGauge.width !== w || this.miniGauge.height !== h) {
      this.miniGauge.width = w;
      this.miniGauge.height = h;
    }
    drawClassicGauge(this.miniGauge, v, { clip: 'ellipse' });
  }

  private frame(): void {
    this.timer.update();
    // Physics runs in fixed steps so slow devices still ride at the true speed.
    const frameTime = this.timer.getDelta();
    const rawDt = Math.min(frameTime, 0.25);
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;

    for (const a of this.input.consumeActions()) this.handle(a);
    const helpOpen = !$('panel').classList.contains('hidden');
    const crashed = this.crashTimer > 0;
    const raw = helpOpen || crashed ? { throttle: 0, brake: 0, steer: 0, lift: false } : this.input.controls();
    // Up on the back wheel the bars barely steer the bike.
    const c = { ...raw, steer: raw.steer * (1 - 0.75 * Math.min(1, this.wheelie.pitch / 0.25)) };
    this.throttle = this.engineOn ? c.throttle : 0;
    this.brake = c.brake;

    for (let left = rawDt; left > 1e-6; left -= 1 / 30) this.traffic.update(Math.min(1 / 30, left), this.scooter);
    this.npcs.update(rawDt);
    // NPCs are solid too; skip any that have already walked into the rider so the scooter can always pull away.
    const near = this.traffic
      .collidersNear(this.scooter.x, this.scooter.z, 25)
      .filter((r) => !circleHitsRect(this.scooter.x, this.scooter.z, SCOOTER_RADIUS, r));
    // Same for furniture, in case a saved position starts on top of a lamp post or planter.
    const stuck = this.staticColliders.some((r) => circleHitsRect(this.scooter.x, this.scooter.z, SCOOTER_RADIUS, r));
    const fixed = stuck
      ? this.staticColliders.filter((r) => !circleHitsRect(this.scooter.x, this.scooter.z, SCOOTER_RADIUS, r))
      : this.staticColliders;
    const colliders = near.length ? [...fixed, ...near] : fixed;

    let impact = 0;
    for (let left = rawDt; left > 1e-6; left -= 1 / 60) {
      const before = this.scooter;
      const result = stepScooter(before, c, Math.min(1 / 60, left), this.engineOn, colliders, this.city.bounds);
      this.scooter = result.state;
      this.odometerKm += Math.hypot(this.scooter.x - before.x, this.scooter.z - before.z) / 1000;
      impact = Math.max(impact, result.impact);
    }
    if (impact > 1.2) {
      this.sound.bump(impact);
      this.shake = Math.min(0.6, impact * 0.06);
    }
    if (crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.wheelie = newWheelie();
        $('app').classList.remove('crashed');
      }
    } else {
      this.updateWheelie(rawDt, c.brake, c.lift);
    }
    this.sound.updateEngine(this.scooter.speed, this.throttle);
    this.input.relaxLook(dt);

    const signals = this.updateSignals();
    this.updateLandmark();

    // First-person camera: lean into turns, a little road buzz, and the rider's head look.
    const s = this.scooter;
    const speedRatio = Math.min(1.6, Math.abs(s.speed) / CRUISE_SPEED);
    const lean = -s.steer * speedRatio * 0.16;
    const buzz = this.engineOn ? Math.sin(this.elapsed * 40) * 0.004 * (0.3 + speedRatio) : 0;
    this.shake = Math.max(0, this.shake - dt * 2);
    const jolt = this.shake * Math.sin(this.elapsed * 60) * 0.05;
    // Riding up or down the curb: a quick hop of the camera and a thud.
    const target = groundHeight(this.city, s.x, s.z);
    if (target !== this.groundTarget && Math.abs(s.speed) > 1) {
      this.shake = Math.max(this.shake, Math.min(0.5, 0.15 + Math.abs(s.speed) * 0.02));
      this.sound.bump(2 + Math.abs(s.speed) * 0.2);
    }
    this.groundTarget = target;
    this.ground += (target - this.ground) * Math.min(1, dt * 18);
    const third = this.view === 'third';
    if (third) this.placeChaseCamera(dt, jolt);
    else {
      if (this.crashTimer > 0) {
        // Lying on the road next to the bike.
        this.camera.position.set(s.x, this.ground + 0.45, s.z);
        this.camera.rotation.set(0.15, s.heading + this.input.look.yaw, 1.25);
      } else {
        // On the back wheel the rider's head swings up and back around the rear tyre.
        const p = this.wheelie.pitch;
        const back = REAR_CONTACT_Z - REAR_CONTACT_Z * Math.cos(p) + EYE_HEIGHT * Math.sin(p);
        const eye = EYE_HEIGHT * Math.cos(p) + REAR_CONTACT_Z * Math.sin(p);
        this.camera.position.set(
          s.x + Math.sin(s.heading) * back,
          eye + this.ground + buzz + jolt,
          s.z + Math.cos(s.heading) * back,
        );
        this.camera.rotation.set(-0.07 + this.input.look.pitch + p, s.heading + this.input.look.yaw, lean);
      }
    }
    const fov = third ? 66 + speedRatio * 6 : 72 + speedRatio * 8;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.night.headlight.visible = this.headlight;
    this.night.headlight.position.set(s.x, 0.02, s.z);
    this.night.headlight.rotation.y = s.heading;

    // The cockpit photo is day-lit; darken it to match the street light around the rider.
    const level = Math.round((0.3 + this.night.levelAt(s.x, s.z) * 0.6) * 50) / 50;
    if (level !== this.cockpitLight) {
      this.cockpitLight = level;
      this.cockpit.setLighting(level);
    }

    const gauge = {
      speedKmh: Math.abs(s.speed) * 3.6,
      steer: s.steer,
      leftLamp: signals.left,
      rightLamp: signals.right,
      headlight: this.headlight,
      engineOn: this.engineOn,
      odometerKm: this.odometerKm,
    };
    this.playerBike.group.visible = third;
    if (third) {
      this.playerBike.update(dt, s, this.ground, this.night.levelAt(s.x, s.z), {
        head: this.headlight,
        brake: this.brake > 0,
        left: signals.left,
        right: signals.right,
      }, this.wheelie.pitch, this.crashTimer > 0);
      this.drawMiniGauge(gauge);
    } else {
      this.cockpit.render(gauge);
    }
    this.updateWheelieHud();
    this.minimap.draw(s.x, s.z, s.heading, this.traffic.vehicles);
    this.updatePrompt();

    this.saveTimer += dt;
    if (this.saveTimer > SAVE_INTERVAL) {
      this.saveTimer = 0;
      this.persist();
    }

    this.renderer.render(this.scene, this.camera);
    this.adaptResolution(frameTime);
  }
}


import type { Action } from './input';

/**
 * Riding with a phone as the handlebars, over the same link as the games in `tiltpad/` (`tiltpad/link.js`: WebRTC via
 * PeerJS, with an MQTT relay as fallback). The phone opens `tiltpad/pad.html` in "Tay lái" mode and only sends
 * {t:"drive"} (tilt steering, throttle, brake, wheelie) once it is held sideways and has been level for a second.
 */

export interface PhoneControls {
  throttle: number;
  brake: number;
  steer: number;
  lift: boolean;
}

interface LinkHost {
  broadcast(msg: unknown): void;
  goTo(game: string): void;
}
interface TiltLinkApi {
  hostScreen(opts: {
    game: string;
    onCode(code: string): void;
    onPads(n: number, info: { relay: number }): void;
    onMessage(msg: Record<string, unknown>): void;
    onError(err: { type?: string; message?: string }): void;
  }): LinkHost;
}
declare global {
  interface Window {
    TiltLink?: TiltLinkApi;
    QRCode?: new (el: HTMLElement, opts: Record<string, unknown>) => unknown;
  }
}

/** No drive message for this long means hands off the bars (network drop, screen off). */
const STALE_MS = 1000;
const SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];

/** The `tiltpad/` folder next to the game (`../tiltpad/` on GitHub Pages); `?tiltpad=` points elsewhere for testing. */
export function tiltpadBase(): URL {
  const override = new URLSearchParams(location.search).get('tiltpad');
  return new URL(override || '../tiltpad/', location.href);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Không tải được ${src}`));
    document.head.append(el);
  });
}

export class PhoneLink {
  private link: LinkHost | null = null;
  private latest: PhoneControls & { at: number } = { throttle: 0, brake: 0, steer: 0, lift: false, at: 0 };
  private starting: Promise<void> | null = null;
  code = '';
  pads = 0;
  relay = 0;
  /** The phone is held sideways and has been levelled. */
  ready = false;
  error = '';
  onChange: () => void = () => {};
  onAction: (a: Action) => void = () => {};
  onReady: () => void = () => {};

  get active(): boolean {
    return this.link !== null;
  }

  /** Loads the libraries and opens a room; later calls reuse the first one. */
  start(): Promise<void> {
    this.starting ??= this.open().catch((err: Error) => {
      this.error = err.message;
      this.starting = null;
      this.onChange();
    });
    return this.starting;
  }

  private async open(): Promise<void> {
    for (const src of SCRIPTS) await loadScript(src).catch(() => {}); // the rest still works without MQTT or the QR code
    await loadScript(new URL('link.js', tiltpadBase()).href);
    const api = window.TiltLink;
    if (!api) throw new Error('Không tải được link.js');
    this.link = api.hostScreen({
      game: 'vgang',
      onCode: (code) => {
        this.code = code;
        this.onChange();
      },
      onPads: (n, info) => {
        this.pads = n;
        this.relay = info.relay;
        if (n === 0) this.setReady(false);
        this.onChange();
      },
      onMessage: (msg) => this.receive(msg),
      onError: (err) => {
        this.error = `Không mở được phòng (${err.type || err.message})`;
        this.onChange();
      },
    });
  }

  private setReady(on: boolean): void {
    if (this.ready === on) return;
    this.ready = on;
    this.latest = { throttle: 0, brake: 0, steer: 0, lift: false, at: 0 };
    if (on) this.onReady();
    this.onChange();
  }

  private receive(msg: Record<string, unknown>): void {
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    switch (msg.t) {
      case 'ready':
        this.setReady(Boolean(msg.on));
        break;
      case 'drive':
        if (!this.ready) this.setReady(true); // the "ready" message went missing (page switch, flaky network)
        this.latest = {
          steer: clamp(num(msg.s), -1, 1),
          throttle: clamp(num(msg.th), 0, 1),
          brake: clamp(num(msg.br), 0, 1),
          lift: Boolean(msg.lift),
          at: performance.now(),
        };
        break;
      case 'act': {
        const a = String(msg.a);
        const allowed: Action[] = ['horn-down', 'horn-up', 'signal-left', 'signal-right', 'light', 'engine', 'view'];
        if ((allowed as string[]).includes(a)) this.onAction(a as Action);
        break;
      }
    }
  }

  /** Current phone controls, or null when the phone is not ready or has gone quiet. */
  controls(): PhoneControls | null {
    if (!this.ready || performance.now() - this.latest.at > STALE_MS) return null;
    const { throttle, brake, steer, lift } = this.latest;
    return { throttle, brake, steer, lift };
  }

  send(msg: unknown): void {
    this.link?.broadcast(msg);
  }

  goTo(game: string): void {
    this.link?.goTo(game);
  }

  /** Link for the phone: the tiltpad controller page, straight into handlebar mode. */
  padUrl(): string {
    const u = new URL('pad.html', tiltpadBase());
    if (this.code) u.searchParams.set('c', this.code);
    u.searchParams.set('game', 'vgang');
    const p = new URLSearchParams(location.search);
    for (const k of ['peer', 'relay', 'via']) {
      const v = p.get(k);
      if (v) u.searchParams.set(k, v);
    }
    return u.href;
  }
}

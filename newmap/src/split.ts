/** Smallest a pane may get, in pixels. */
export const MIN_PANE = 300;
/** Default share of the map pane. */
export const DEFAULT_SPLIT = { side: 0.45, stacked: 0.44 };

/** Share (0–1) of the first pane for a splitter dragged to `pos` px in a box of `total` px, keeping both panes usable. */
export function clampSplit(pos: number, total: number, min = MIN_PANE): number {
  if (total <= 0) return 0.5;
  const lo = Math.min(min, total / 2);
  return Math.min(total - lo, Math.max(lo, pos)) / total;
}

const KEY = { side: 'newmap.split', stacked: 'newmap.splitStacked' } as const;

function load(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 && v < 1 ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // Private mode or blocked storage: the size just is not remembered.
  }
}

/**
 * The bar between the map and the 3D view. Dragging it (mouse or finger) shares the space between the two panes,
 * side by side on wide screens and one above the other on phones; arrow keys move it, a double click resets it.
 * The panes follow by themselves: both watch their own size.
 */
export function initSplitter(main: HTMLElement, bar: HTMLElement): void {
  const stacked = matchMedia('(max-width: 760px)');
  const mode = () => (stacked.matches ? 'stacked' : 'side');
  const apply = (share: number) => {
    main.style.setProperty(stacked.matches ? '--split-stacked' : '--split', `${(share * 100).toFixed(2)}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  };
  const current = () => load(KEY[mode()], DEFAULT_SPLIT[mode()]);
  const set = (share: number) => {
    apply(share);
    save(KEY[mode()], share);
  };
  const shareAt = (e: PointerEvent) => {
    const r = main.getBoundingClientRect();
    return stacked.matches ? clampSplit(e.clientY - r.top, r.height) : clampSplit(e.clientX - r.left, r.width);
  };

  main.style.setProperty('--split', `${load(KEY.side, DEFAULT_SPLIT.side) * 100}%`);
  main.style.setProperty('--split-stacked', `${load(KEY.stacked, DEFAULT_SPLIT.stacked) * 100}%`);
  const orient = () => {
    bar.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
    bar.setAttribute('aria-valuenow', String(Math.round(current() * 100)));
  };
  orient();
  stacked.addEventListener('change', orient);

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  bar.addEventListener('pointermove', (e) => {
    if (bar.hasPointerCapture(e.pointerId)) apply(shareAt(e));
  });
  const end = (e: PointerEvent) => {
    if (!bar.hasPointerCapture(e.pointerId)) return;
    bar.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing');
    set(shareAt(e));
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => set(DEFAULT_SPLIT[mode()]));
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const back = stacked.matches ? 'ArrowUp' : 'ArrowLeft';
    const fwd = stacked.matches ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== back && e.key !== fwd && e.key !== 'Home') return;
    e.preventDefault();
    const r = main.getBoundingClientRect();
    const total = stacked.matches ? r.height : r.width;
    const share = e.key === 'Home' ? DEFAULT_SPLIT[mode()] : current() + (e.key === fwd ? step : -step);
    set(clampSplit(share * total, total));
  });
}

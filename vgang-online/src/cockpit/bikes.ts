import type { CockpitAction } from './cockpit';
import type { WheelieProfile } from '../sim/wheelie';
import type { GaugeClip } from './classicGauge';

export interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  down: CockpitAction;
  up?: CockpitAction;
}

/**
 * One rideable front end: a transparent first-person photo of the handlebars plus where its parts are.
 * All coordinates are in the image's own pixels.
 */
export interface BikeDef {
  id: string;
  name: string;
  description: string;
  /** File under public/assets/. */
  image: string;
  width: number;
  height: number;
  /** First image row with handlebar pixels; everything above is transparent. */
  barTop: number;
  /** Rows to keep on screen below barTop on short and tall screens. */
  visibleBottom: [number, number];
  /** Share of the image width that spans the screen width (the rest falls off the sides). */
  fit?: number;
  /**
   * Moves the photo down (positive) or up on screen, in image pixels, so its dashboard sits at the same
   * level as the red scooter's instead of rising higher.
   */
  offsetY?: number;
  /** Steering column pivot (may lie below the image). */
  pivot: { x: number; y: number };
  /** Rectangle covering the instrument; the red scooter's gauge is drawn into it. */
  gauge: { x: number; y: number; w: number; h: number };
  /** Enlarges the gauge's numbers on small instruments. */
  textScale?: number;
  gaugeClip: GaugeClip;
  hotspots: Hotspot[];
  /** How the bike looks from outside (third-person view): body style, main paint and trim colour. */
  model: BikeModel;
  /** Balance point and how readily the front pops up. */
  wheelie: WheelieProfile;
}

export interface BikeModel {
  kind: 'scooter' | 'naked' | 'underbone';
  paint: number;
  trim: number;
}

export const BIKES: BikeDef[] = [
  {
    id: 'scooter-red',
    name: 'Tay ga đỏ',
    description: 'Đầu xe tay ga, mặt đồng hồ hình bầu dục',
    image: 'handlebar.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    pivot: { x: 836, y: 1180 },
    gauge: { x: 615, y: 345, w: 480, h: 220 },
    gaugeClip: 'ellipse',
    fit: 0.952,
    model: { kind: 'scooter', paint: 0xb3161b, trim: 0x1c1c1e },
    wheelie: { balanceDeg: 46, pop: 18 },
    hotspots: [
      { x: 368, y: 440, w: 70, h: 78, label: 'Đèn pha', down: 'light' },
      { x: 384, y: 535, w: 100, h: 60, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 398, y: 594, w: 40, h: 42, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 438, y: 594, w: 40, h: 42, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1200, y: 615, w: 100, h: 60, label: 'Nút đề', down: 'engine' },
    ],
  },
  {
    id: 'scooter-blue-analog',
    name: 'Tay ga xanh kim cam',
    description: 'Đầu xe xanh, đồng hồ kim, có gương',
    image: 'bikes/blue-analog.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    fit: 0.952,
    offsetY: -60,
    pivot: { x: 790, y: 1180 },
    gauge: { x: 483, y: 406, w: 611, h: 324 },
    gaugeClip: 'ellipse',
    model: { kind: 'scooter', paint: 0x1d3f8f, trim: 0xd9d6cf },
    wheelie: { balanceDeg: 45, pop: 16 },
    hotspots: [
      { x: 205, y: 550, w: 90, h: 90, label: 'Đèn pha', down: 'light' },
      { x: 250, y: 705, w: 70, h: 50, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 230, y: 665, w: 50, h: 40, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 280, y: 665, w: 50, h: 40, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1240, y: 700, w: 90, h: 70, label: 'Nút đề', down: 'engine' },
    ],
  },
  {
    id: 'scooter-white-lcd',
    name: 'Tay ga trắng LCD',
    description: 'Đầu xe trắng đen, màn LCD hình thang',
    image: 'bikes/white-lcd.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    fit: 0.952,
    offsetY: 41,
    pivot: { x: 836, y: 1180 },
    gauge: { x: 660, y: 300, w: 350, h: 148 },
    gaugeClip: [
      [0.03, 0],
      [0.97, 0],
      [0.9, 1],
      [0.1, 1],
    ],
    textScale: 1.4,
    model: { kind: 'scooter', paint: 0xe9e7e2, trim: 0x232326 },
    wheelie: { balanceDeg: 47, pop: 19 },
    hotspots: [
      { x: 385, y: 420, w: 60, h: 60, label: 'Đèn pha', down: 'light' },
      { x: 365, y: 500, w: 70, h: 50, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 370, y: 550, w: 35, h: 40, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 405, y: 550, w: 35, h: 40, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1240, y: 565, w: 65, h: 50, label: 'Nút đề', down: 'engine' },
    ],
  },
  {
    id: 'scooter-black-lcd',
    name: 'Tay ga đen LCD xanh',
    description: 'Đầu xe đen, màn LCD xanh dương',
    image: 'bikes/black-lcd-blue.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    fit: 0.952,
    offsetY: -45,
    pivot: { x: 816, y: 1180 },
    gauge: { x: 678, y: 400, w: 274, h: 143 },
    gaugeClip: 'rect',
    textScale: 1.4,
    model: { kind: 'scooter', paint: 0x1b1c1f, trim: 0x2a63c9 },
    wheelie: { balanceDeg: 48, pop: 21 },
    hotspots: [
      { x: 235, y: 470, w: 70, h: 100, label: 'Đèn pha', down: 'light' },
      { x: 300, y: 640, w: 70, h: 55, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 255, y: 575, w: 45, h: 55, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 300, y: 575, w: 45, h: 55, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1310, y: 510, w: 60, h: 50, label: 'Nút đề', down: 'engine' },
    ],
  },
  {
    id: 'naked-black',
    name: 'Côn tay đen',
    description: 'Xe côn tay, ghi đông trần, màn LCD',
    image: 'bikes/naked-lcd.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    fit: 0.952,
    offsetY: -27,
    pivot: { x: 846, y: 1180 },
    gauge: { x: 712, y: 298, w: 266, h: 108 },
    gaugeClip: 'rect',
    textScale: 1.4,
    model: { kind: 'naked', paint: 0x18191b, trim: 0xb8babd },
    wheelie: { balanceDeg: 52, pop: 36 },
    hotspots: [
      { x: 310, y: 560, w: 70, h: 60, label: 'Đèn pha', down: 'light' },
      { x: 280, y: 745, w: 60, h: 45, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 255, y: 705, w: 45, h: 45, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 300, y: 705, w: 45, h: 45, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1375, y: 800, w: 65, h: 60, label: 'Nút đề', down: 'engine' },
    ],
  },
  {
    id: 'underbone-white-dial',
    name: 'Xe số mặt trắng',
    description: 'Xe số xanh, đồng hồ kim mặt trắng, có giỏ',
    image: 'bikes/blue-white-dial.webp',
    width: 1672,
    height: 940,
    barTop: 270,
    visibleBottom: [600, 720],
    fit: 0.952,
    offsetY: 40,
    pivot: { x: 800, y: 1180 },
    gauge: { x: 520, y: 318, w: 560, h: 235 },
    gaugeClip: [
      [0.02, 0.04],
      [0.98, 0.04],
      [0.75, 0.98],
      [0.25, 0.98],
    ],
    model: { kind: 'underbone', paint: 0x1f4fa8, trim: 0xe6e4de },
    wheelie: { balanceDeg: 50, pop: 26 },
    hotspots: [
      { x: 200, y: 470, w: 80, h: 90, label: 'Đèn pha', down: 'light' },
      { x: 255, y: 650, w: 85, h: 50, label: 'Còi', down: 'horn-down', up: 'horn-up' },
      { x: 225, y: 585, w: 45, h: 45, label: 'Xi nhan trái', down: 'signal-left' },
      { x: 290, y: 585, w: 45, h: 45, label: 'Xi nhan phải', down: 'signal-right' },
      { x: 1320, y: 610, w: 90, h: 60, label: 'Nút đề', down: 'engine' },
    ],
  },
];

export const DEFAULT_BIKE = 'scooter-red';

export function bikeDef(id: string | null): BikeDef {
  return BIKES.find((b) => b.id === id) ?? BIKES.find((b) => b.id === DEFAULT_BIKE)!;
}

/** How hard the bike is to pull a wheelie on, for the picker. */
export function wheelieDifficulty(b: BikeDef): string {
  return b.wheelie.pop >= 30 ? 'dễ' : b.wheelie.pop >= 22 ? 'vừa' : 'khó';
}

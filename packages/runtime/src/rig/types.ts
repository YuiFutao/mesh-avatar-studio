export type Point = [number, number];
export type Band = [number, number];
export interface Ellipse { cx: number; cy: number; rx: number; ry: number }
export interface Eye {
  opening: Point[];
  roi: Point[];
  x0: number;
  x1: number;
  top: number[];
  bot: number[];
}
export interface Strand {
  name: string;
  nodes: Point[];
  sigma: number;
  k: number;
  max: number;
}
export interface Accessory {
  name: string;
  pivot: Point;
  tip: Point;
  split: number;
  box: [number, number, number, number];
  color: { redness: number; minRed: number };
  /** Optional exact cutout for parts whose colours cannot be isolated by redness. */
  outline?: Point[];
  keepLargest?: boolean;
  /** Foreground root occluder, moving with the head rather than the pendulum. */
  rootCover?: Point[];
  /** Optional upright, head-relative two-joint spring; omitted keeps legacy hanging physics. */
  pendulum?: { mode: 'upright'; frequency: number; damping: number; inertia: number; maxAngle: number; maxBend: number };
  /** Shared occasional two-pulse gesture; requires an upright pendulum. Seconds / signed radians. */
  twitch?: { interval: Band; angle: number };
}
export interface Hand {
  outline: Point[];
  jaw: Point[];
  jawRange: Band;
  background: Point[];
  elbow: Point;
  wrist: Point;
  knuckle: Point;
  contact: Point;
  forearmShare: number;
  armBand: Band;
  wristBand: Band;
  handBand: Band;
  fingerXBand: Band;
  fingerYBand: Band;
  pinBand: Band;
}
export interface Rig {
  version: 1;
  image: { width: number; height: number };
  head: Ellipse & {
    shiftX: number; shiftY: number; pivotX: number; pivotY: number;
    maxRoll: number; weightBand: Band; turnBand: Band;
    /** Coherent ears/horns, following their anchor without local bending. */
    rigidRegions?: { outline: Point[]; feather: number; anchor: Point;
      /** Optional damped angular lag around the attachment; tip defines the ear direction/length. */
      sway?: { tip: Point; frequency: number; damping: number; maxAngle: number; lag: number; inertia: number };
    }[];
    /** Extra full head-roll regions, with an outward feather in source pixels. */
    rollRegions?: {
      outline: Point[]; feather: number;
      /** Coherent, gravity-biased angular motion about the hair attachment. */
      swing?: { pivot: Point; length: number; band: Band; gravity: number; frequency: number; damping: number; maxAngle: number };
    }[];
  };
  body: {
    pivotX: number; pivotY: number; maxRoll: number;
    breathBand: Band; rollBand: Band; chest: Ellipse; shoulders: Ellipse[];
  };
  face: Record<'nose' | 'mouth' | 'eyeA' | 'eyeB' | 'earL' | 'earR', Ellipse> & {
    brow: Ellipse & { band: Band };
    jaw: Ellipse & { band: Band };
  };
  buns?: Partial<Record<'bunL' | 'bunR', Ellipse>>;
  eyes: Eye[];
  /** Optional sprite thresholds; half-open occupies [closedMax, openMin). */
  eyeFrames?: { closedMax: number; openMin: number; smileOpenSprite?: boolean; widening?: {
    upper: number; lower: number;
  } };
  mouth: {
    cx: number; cy: number; angle: number; halfLen: number; bow: number;
    area: Ellipse & { angle: number };
    /** Optional drawn-mouth hysteresis and safe fallback for missing vowel drawings. */
    stability?: { openThreshold: number; closeThreshold: number; largeThreshold: number; smallThreshold: number; minOpenSeconds: number; minSmallSeconds?: number; minLargeSeconds?: number };
  };
  cheeks: Point[];
  strands?: Strand[];
  accessories?: Accessory[];
  hand?: Hand;
  mesh: {
    baseCell: number;
    fine: { x0: number; x1: number; y0: number; y1: number; cell: number };
    handCell: number; tasselCell: number; eyeBallCell: number;
    eyeCell: number; spriteCell: number;
  };
  view: { padTop: number; padSide: number; gazeCenter?: Point };
}

import type { Rig } from './types';

type Check = (value: unknown, path: string, errors: string[]) => void;
const number: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected a finite number`);
};
const positive: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && v <= 0) e.push(`${p}: must be positive`);
};
const integer: Check = (v, p, e) => {
  positive(v, p, e);
  if (typeof v === 'number' && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
const wholeNumber: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
const string: Check = (v, p, e) => {
  if (typeof v !== 'string' || !v.trim()) e.push(`${p}: expected a non-empty string`);
};
const boolean: Check = (v, p, e) => { if (typeof v !== 'boolean') e.push(`${p}: expected a boolean`); };
const array = (item: Check, min = 0, max = Infinity): Check => (v, p, e) => {
  if (!Array.isArray(v)) { e.push(`${p}: expected an array`); return; }
  if (v.length < min || v.length > max) e.push(`${p}: expected ${min}..${max} items`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, e));
};
const point = array(number, 2, 2);
const band: Check = (v, p, e) => {
  point(v, p, e);
  if (Array.isArray(v) && v.length === 2 && v[0] >= v[1]) e.push(`${p}: start must be less than end`);
};
const object = (fields: Record<string, Check>, optional: string[] = []): Check => (v, p, e) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { e.push(`${p}: expected an object`); return; }
  const record = v as Record<string, unknown>;
  for (const [key, check] of Object.entries(fields)) {
    if (record[key] === undefined && optional.includes(key)) continue;
    check(record[key], `${p}.${key}`, e);
  }
};
const ellipseFields = { cx: number, cy: number, rx: positive, ry: positive };
const ellipse = object(ellipseFields);
const polygon = array(point, 3);
const line = array(point, 2);
const unit: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && (v < 0 || v > 1)) e.push(`${p}: must be between 0 and 1`);
};
const schema = (draft: boolean) => object({
  version: (v, p, e) => { if (v !== 1) e.push(`${p}: only version 1 is supported`); },
  image: object({ width: integer, height: integer }),
  head: object({ ...ellipseFields, shiftX: number, shiftY: number, pivotX: number,
    pivotY: number, maxRoll: number, weightBand: band, turnBand: band,
    rigidRegions: array(object({ outline: polygon, feather: positive, anchor: point,
      sway: object({ tip: point, frequency: positive, damping: positive, maxAngle: positive, lag: unit, inertia: unit }),
    }, ['sway'])),
    rollRegions: array(object({ outline: polygon, feather: positive,
      swing: object({ pivot: point, length: positive, band, gravity: unit, frequency: positive, damping: positive, maxAngle: positive }),
    }, ['swing'])) }, ['rollRegions', 'rigidRegions']),
  body: object({ pivotX: number, pivotY: number, maxRoll: number, breathBand: band,
    rollBand: band, chest: ellipse, shoulders: array(ellipse) }),
  face: object({ nose: ellipse, mouth: ellipse, eyeA: ellipse, eyeB: ellipse,
    earL: ellipse, earR: ellipse, brow: object({ ...ellipseFields, band }),
    jaw: object({ ...ellipseFields, band }) }),
  buns: object({ bunL: ellipse, bunR: ellipse }, ['bunL', 'bunR']),
  eyes: array(object({ opening: polygon, roi: polygon, x0: number, x1: number,
    top: array(number, 24, 24), bot: array(number, 24, 24) }, draft ? ['x0', 'x1', 'top', 'bot'] : []), 2, 2),
  eyeFrames: object({ closedMax: unit, openMin: unit, smileOpenSprite: boolean,
    widening: object({ upper: positive, lower: positive }),
  }, ['smileOpenSprite', 'widening']),
  mouth: object({ cx: number, cy: number, angle: number, halfLen: positive, bow: number,
    area: object({ ...ellipseFields, angle: number }),
    stability: object({ openThreshold: unit, closeThreshold: unit, largeThreshold: unit, smallThreshold: unit, minOpenSeconds: unit, minSmallSeconds: unit, minLargeSeconds: unit }, ['minSmallSeconds', 'minLargeSeconds']),
  }, ['stability']),
  cheeks: array(point, 2, 2),
  strands: array(object({ name: string, nodes: line, sigma: positive, k: positive, max: positive })),
  accessories: array(object({ name: string, pivot: point, tip: point, split: unit,
    box: array(wholeNumber, 4, 4), color: object({ redness: unit, minRed: number }),
    outline: polygon, keepLargest: boolean, rootCover: polygon,
    pendulum: object({ mode: (v, p, e) => { if (v !== 'upright') e.push(`${p}: expected upright`); }, frequency: positive, damping: positive, inertia: unit, maxAngle: positive, maxBend: positive }),
    twitch: object({ interval: band, angle: number }),
  }, ['outline', 'keepLargest', 'rootCover', 'pendulum', 'twitch'])),
  hand: object({ outline: polygon, jaw: line, jawRange: band, background: polygon,
    elbow: point, wrist: point, knuckle: point, contact: point, forearmShare: unit,
    armBand: band, wristBand: band, handBand: band, fingerXBand: band,
    fingerYBand: band, pinBand: band }),
  mesh: object({ baseCell: integer, fine: object({ x0: wholeNumber, x1: wholeNumber,
    y0: wholeNumber, y1: wholeNumber, cell: integer }), handCell: integer,
    tasselCell: integer, eyeBallCell: integer, eyeCell: integer, spriteCell: integer }),
  view: object({ padTop: number, padSide: number, gazeCenter: point }, ['gazeCenter']),
}, ['buns', 'strands', 'accessories', 'hand', 'eyeFrames']);

export function validateRig(value: unknown, options: { draft?: boolean } = {}): string[] {
  const errors: string[] = [];
  schema(options.draft ?? false)(value, 'rig', errors);
  if (errors.length) return errors;
  const rig = value as Rig;
  for (const [i, region] of (rig.head.rigidRegions ?? []).entries()) {
    if (region.sway && region.sway.tip.every((n, axis) => n === region.anchor[axis]))
      errors.push(`rig.head.rigidRegions[${i}].sway.tip: must differ from anchor`);
  }
  if (rig.eyeFrames && rig.eyeFrames.closedMax >= rig.eyeFrames.openMin)
    errors.push('rig.eyeFrames: closedMax must be less than openMin');
  const stability = rig.mouth.stability;
  if (stability && !(stability.closeThreshold < stability.openThreshold && stability.openThreshold < stability.smallThreshold && stability.smallThreshold < stability.largeThreshold))
    errors.push('rig.mouth.stability: require closeThreshold < openThreshold < smallThreshold < largeThreshold');
  rig.eyes.forEach((eye, i) => {
    const curves = ['x0', 'x1', 'top', 'bot'] as const;
    if (options.draft && curves.every(key => eye[key] === undefined)) return;
    if (curves.some(key => eye[key] === undefined)) {
      errors.push(`rig.eyes[${i}]: supply all x0/x1/top/bot fields or omit all in a draft`);
      return;
    }
    if (eye.x0 >= eye.x1) errors.push(`rig.eyes[${i}].x1: must exceed x0`);
    if (eye.top.some((y, k) => y > eye.bot[k])) errors.push(`rig.eyes[${i}].top: must not exceed bottom curve`);
  });
  if (rig.mesh.fine.x0 >= rig.mesh.fine.x1 || rig.mesh.fine.y0 >= rig.mesh.fine.y1)
    errors.push('rig.mesh.fine: rectangle must have positive area');
  if (rig.view.padTop <= -1 || rig.view.padTop >= 1 || rig.view.padSide <= -0.5)
    errors.push('rig.view: margins must leave a positive viewport');
  for (const [i, strand] of (rig.strands ?? []).entries()) {
    if (strand.nodes.some((p, j) => j > 0 && p[0] === strand.nodes[j - 1][0] && p[1] === strand.nodes[j - 1][1]))
      errors.push(`rig.strands[${i}].nodes: consecutive nodes must differ`);
  }
  for (const [i, accessory] of (rig.accessories ?? []).entries()) {
    if (accessory.twitch) {
      if (!accessory.pendulum) errors.push(`rig.accessories[${i}].twitch: requires an upright pendulum`);
      if (accessory.twitch.interval[0] <= .53) errors.push(`rig.accessories[${i}].twitch.interval: minimum must exceed gesture duration (0.53 seconds)`);
      if (accessory.twitch.angle === 0 || Math.abs(accessory.twitch.angle) > (accessory.pendulum?.maxAngle ?? 0))
        errors.push(`rig.accessories[${i}].twitch.angle: magnitude must be positive and no greater than pendulum.maxAngle`);
    }
    for (const key of ['outline', 'rootCover'] as const) {
      if (accessory[key]?.some(([x, y]) => x < 0 || x > rig.image.width || y < 0 || y > rig.image.height))
        errors.push(`rig.accessories[${i}].${key}: must stay inside the image`);
    }
    if (accessory.box[0] < 0 || accessory.box[1] < 0 || accessory.box[2] > rig.image.width || accessory.box[3] > rig.image.height)
      errors.push(`rig.accessories[${i}].box: rectangle must stay inside the image`);
    if (accessory.split <= 0 || accessory.split >= 1) errors.push(`rig.accessories[${i}].split: must be strictly between 0 and 1`);
    if (accessory.pivot.every((n, k) => n === accessory.tip[k])) errors.push(`rig.accessories[${i}].tip: must differ from pivot`);
    if (accessory.box[0] >= accessory.box[2] || accessory.box[1] >= accessory.box[3]) errors.push(`rig.accessories[${i}].box: rectangle must have positive area`);
  }
  return errors;
}

export function parseRig(value: unknown): Rig {
  const errors = validateRig(value);
  if (errors.length) throw new Error(`Invalid rig:\n${errors.join('\n')}`);
  return structuredClone(value) as Rig;
}

import {expect, test} from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import {parseRig, validateRig, PARAMS} from 'mesh-avatar';
import {createRig} from '../packages/runtime/src/engine/rig.js';
import {FacePose, mapFace, readFace, type FaceResult} from '../src/live/tracking';

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const physics = {gain: 0, bunL: [0, 0], bunR: [0, 0]};
const options = {mirror: false, sensitivity: 1, smoothing: 0};
function setup() {
  const rig = parseRig(fixture);
  rig.eyeFrames = {closedMax: .3, openMin: .5, widening: {upper: 24, lower: 6}};
  return {rig, engine: createRig(rig)};
}
function face(shapes: Record<string, number>): FaceResult {
  return {faceLandmarks: [[]], facialTransformationMatrixes: [{data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}],
    faceBlendshapes: [{categories: Object.entries(shapes).map(([categoryName, score]) => ({categoryName, score}))}]};
}

test('optional widening lifts the upper contour, lowers the lower contour and pins corners without folding', () => {
  const {rig, engine} = setup(), e = rig.eyes[0], x = (e.x0 + e.x1) / 2;
  const draw = (x: number, y: number, extra = {}) => engine.deformBase(x, y, engine.baseWeights(x, y, 0), {...defaults, ...extra}, physics, [0, 0]);
  const top = (e.top[11] + e.top[12]) / 2, bot = (e.bot[11] + e.bot[12]) / 2;
  expect(draw(x, top, {eyeRWide: 1})[1]).toBeCloseTo(top - 24, 8);
  expect(draw(x, bot, {eyeRWide: 1})[1]).toBeCloseTo(bot + 6, 8);
  expect(draw(e.x0, e.top[0], {eyeRWide: 1})).toEqual(draw(e.x0, e.top[0]));
  expect(draw(x, top, {eyeLWide: 1})).toEqual(draw(x, top));
  expect(draw(x, top, {eyeRWide: 1, eyeROpen: 0})).toEqual(draw(x, top, {eyeROpen: 0}));
  expect(draw(x, top, {eyeRWide: 1, eyeROpen: .5})).toEqual(draw(x, top, {eyeROpen: .5}));
  for (let x = e.x0; x <= e.x1; x += 7) {
    let previous = -Infinity;
    for (let y = Math.min(...e.top) - 100; y <= Math.max(...e.bot) + 100; y += 1) {
      const p = draw(x, y, {eyeRWide: 1});
      expect(p.every(Number.isFinite)).toBe(true); expect(p[1]).toBeGreaterThan(previous); previous = p[1];
    }
  }
});

test('rigs without widening data ignore wide parameters exactly; configured neutral remains identical', () => {
  const legacy = createRig(parseRig(fixture)), {engine, rig} = setup();
  for (let y = 0; y < rig.image.height; y += 19) for (let x = 0; x < rig.image.width; x += 19) {
    const a = legacy.deformBase(x, y, legacy.baseWeights(x, y, 0), defaults, physics, [0, 0]);
    expect(legacy.deformBase(x, y, legacy.baseWeights(x, y, 0), {...defaults, eyeRWide: 1, eyeLWide: 1}, physics, [0, 0])).toEqual(a);
    expect(engine.deformBase(x, y, engine.baseWeights(x, y, 0), defaults, physics, [0, 0])).toEqual(a);
  }
});

test('wide tracking is independent per eye, mirrored, neutral-relative and suppressed during a blink', () => {
  const input = readFace(face({eyeWideLeft: .5}))!;
  expect(mapFace(input, null, options)).toMatchObject({eyeLWide: 1, eyeRWide: 0});
  expect(mapFace(input, null, {...options, mirror: true})).toMatchObject({eyeRWide: 1, eyeLWide: 0});
  expect(mapFace(input, input, options).eyeLWide).toBe(0);
  expect(mapFace(readFace(face({eyeWideLeft: 1, eyeBlinkLeft: .9}))!, null, options)).toMatchObject({eyeLOpen: 0, eyeLWide: 0});
  expect(mapFace(readFace(face({eyeWideLeft: NaN}))!, null, options).eyeLWide).toBe(0);
});

test('calibrated tracking retains widening and smile, but drops stale widening without new device input', () => {
  const pose = new FacePose();
  pose.setCalibration({neutralMouth: 0, floor: .00002, exit: .00003, enter: .00006, gentle: .0003, big: .9,
    open: [.1, .2], closed: [.65, .75], enterSeconds: .1, exitSeconds: .16, riseSeconds: .08, fallSeconds: .12});
  const input = face({eyeWideLeft: .5, eyeBlinkLeft: .1, eyeBlinkRight: .2, mouthSmileLeft: .9, mouthSmileRight: .9});
  for (let i = 0; i < 60; i++) {pose.update(input, i * 33); pose.sample(i * 33, .033, options);}
  const output = pose.sample(1950, .016, options).params;
  expect(output.eyeLWide).toBe(1); expect(output.eyeRWide).toBe(0); expect(output.eyeSmile).toBeGreaterThan(.99);
  expect(pose.sample(2300, .016, options).params.eyeLWide).toBe(0);
  pose.reset(); expect(pose.sample(2400, .016, options).params.eyeLWide).toBe(0);
});

test('widening data requires finite positive upper and lower distances', () => {
  const {rig} = setup(); expect(validateRig(rig)).toEqual([]);
  rig.eyeFrames!.widening!.upper = NaN; expect(validateRig(rig).length).toBeGreaterThan(0);
  rig.eyeFrames!.widening!.upper = -1; expect(validateRig(rig).length).toBeGreaterThan(0);
});

test('calibrated extra openness drives widening even with a weak wide classifier, while relaxed eyes stay neutral', () => {
  const pose = new FacePose();
  pose.setCalibration({neutralMouth: 0, floor: .00002, exit: .00003, enter: .00006, gentle: .0003, big: .9,
    open: [.14, .16], closed: [.65, .75], enterSeconds: .1, exitSeconds: .16, riseSeconds: .08, fallSeconds: .12});
  const sample = (blink: number, start: number) => {
    for (let i = 0; i < 40; i++) {
      pose.update(face({eyeWideLeft: .01, eyeWideRight: .01, eyeBlinkLeft: blink, eyeBlinkRight: .16, mouthSmileLeft: 0, mouthSmileRight: 0}), start + i * 33);
      pose.sample(start + i * 33, .033, options);
    }
    return pose.sample(start + 39 * 33, .016, options).params;
  };
  expect(sample(.14, 0)).toMatchObject({eyeLWide: 0, eyeRWide: 0, eyeSmile: 0});
  expect(sample(.01, 1400).eyeLWide).toBeGreaterThan(.99);
  const neutral = sample(.14, 2800); expect(neutral.eyeLWide).toBeLessThan(.001); expect(neutral.eyeRWide).toBe(0);
  const closed = sample(.9, 4200); expect(closed.eyeLOpen).toBeLessThan(.001); expect(closed.eyeLWide).toBeLessThan(.001);
});

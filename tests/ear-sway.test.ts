import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
function setup(sway = true) {
  const rig = parseRig(fixture);
  rig.strands = []; rig.accessories = []; delete rig.buns;
  rig.head.rigidRegions = [{ outline: [[250, 100], [600, 100], [600, 450], [250, 450]], feather: 25, anchor: [450, 400],
    ...(sway ? { sway: { tip: [400, 130] as [number, number], frequency: 2.2, damping: .6, maxAngle: .065, lag: .7, inertia: .6 } } : {}) }];
  const engine = createRig(rig), physics = new (createPhysics(engine, rig).Physics)();
  return { rig, engine, physics };
}

test.each([15, 30, 60])('ears respond to head motion and settle without idle flutter at %i fps', fps => {
  const { physics } = setup(), dt = 1 / fps;
  for (let i = 0; i < fps; i++) expect(physics.step(defaults, dt).rigidRegions[0]).toBe(0);
  let peak = 0, tailPeak = 0, last = 0;
  for (let i = 0; i < fps * 8; i++) {
    const t = i / fps;
    const P = t < 2 ? { ...defaults, angleX: 25 * Math.sin(2 * Math.PI * t / .8), angleZ: 12 * Math.sin(2 * Math.PI * t) } : defaults;
    last = physics.step(P, dt).rigidRegions[0];
    expect(Number.isFinite(last)).toBe(true); expect(Math.abs(last)).toBeLessThanOrEqual(.065);
    peak = Math.max(peak, Math.abs(last));
    if (t >= 2 && t < 2.5) tailPeak = Math.max(tailPeak, Math.abs(last));
  }
  expect(peak).toBeGreaterThan(.003); expect(tailPeak).toBeGreaterThan(.0001); expect(Math.abs(last)).toBeLessThan(1e-6);
});

test('rotation lags and rings down, translation also drives it, and gain/paused/stalled frames are safe', () => {
  const { physics } = setup(), dt = 1 / 60;
  physics.step(defaults, dt);
  const tilted = { ...defaults, angleZ: 15 };
  expect(physics.step(tilted, dt).rigidRegions[0]).toBeGreaterThan(.01);
  const offsets = Array.from({ length: 90 }, () => physics.step(tilted, dt).rigidRegions[0]);
  expect(offsets.some(v => v < 0)).toBe(true);
  expect(Math.abs(offsets.at(-1)!)).toBeLessThan(.0001);
  expect(physics.step(defaults, 0).rigidRegions[0]).toBe(0);
  let translationPeak = 0;
  for (let i = 0; i < 60; i++) translationPeak = Math.max(translationPeak, Math.abs(physics.step({ ...defaults, angleX: 25 * Math.sin(i * dt * 6) }, dt).rigidRegions[0]));
  expect(translationPeak).toBeGreaterThan(.001);
  expect(physics.step(tilted, 2).rigidRegions[0]).toBe(0);
  physics.gain = 0;
  expect(physics.step(defaults, dt).rigidRegions[0]).toBeCloseTo(0, 12);
  physics.gain = 5;
  expect(Math.abs(physics.step(tilted, dt).rigidRegions[0])).toBeLessThanOrEqual(.065);
});

test('sway rotates the complete ear about its fixed attachment without stretching its shape', () => {
  const { engine, physics } = setup();
  physics.step(defaults, 1 / 60);
  const P = { ...defaults, angleZ: 15, angleX: 20 }, phys = physics.step(P, 1 / 60);
  const points = [[280, 130], [560, 160], [400, 420]];
  const moved = points.map(([x, y]) => engine.deformBase(x, y, engine.baseWeights(x, y, 0), P, phys, [0, 0]));
  for (let i = 1; i < points.length; i++) expect(Math.hypot(moved[i][0] - moved[0][0], moved[i][1] - moved[0][1])).toBeCloseTo(Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]), 9);
  const at = engine.deformBase(450, 400, engine.baseWeights(450, 400, 0), P, phys, [0, 0]);
  expect(at).toEqual(engine.rigidFrame(0, P, phys).anchor);
  const rigid = setup(false);
  expect(rigid.physics.step(P, 1 / 60).rigidRegions).toEqual([0]);
});

test('sway configuration rejects coincident tips, non-finite values and invalid gains', () => {
  const { rig } = setup();
  expect(validateRig(rig)).toEqual([]);
  const region = rig.head.rigidRegions![0], original = structuredClone(region.sway!);
  for (const bad of [{ tip: region.anchor }, { frequency: 0 }, { damping: NaN }, { maxAngle: 0 }, { lag: 1.1 }, { inertia: -1 }]) {
    region.sway = { ...original, ...bad };
    expect(validateRig(rig).length).toBeGreaterThan(0);
  }
});

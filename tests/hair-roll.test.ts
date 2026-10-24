import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';
import { PARAMS } from '../packages/runtime/src/engine/rig.js';

test('long hair rotates as one lock below the neck without pulling the torso', () => {
  const rig = parseRig(fixture);
  rig.head.rollRegions = [{ outline: [[20, 500], [180, 500], [180, 1100], [20, 1100]], feather: 20 }];
  const engine = createRig(rig);
  expect(engine.headWeight(100, 1000)).toBe(1);
  expect(engine.headWeight(190, 1000)).toBeCloseTo(0.5);
  expect(engine.headWeight(200, 1000)).toBe(0);
  expect(engine.headWeight(500, 1000)).toBe(createRig(parseRig(fixture)).headWeight(500, 1000));
  for (const angleZ of [-30, 30]) {
    const a = [100, 800], b = [100, 1000];
    const pose = { angleX: 0, angleY: 0, angleZ };
    engine.applyHead(a, engine.headWeight(...a), pose);
    engine.applyHead(b, engine.headWeight(...b), pose);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(200, 10);
  }
});

const swingRig = () => {
  const rig = parseRig(fixture);
  rig.head.rollRegions = [{ outline: [[20, 400], [180, 400], [180, 1100], [20, 1100]], feather: 20,
    swing: { pivot: [100, 500], length: 500, band: [500, 700], gravity: 0.85, frequency: 1, damping: 0.65, maxAngle: 0.3 } }];
  return rig;
};
const neutral = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));

test('long locks hang closer to vertical at rest while keeping their attachment and length', () => {
  const rig = swingRig(), engine = createRig(rig), { Physics } = createPhysics(engine, rig), physics = new Physics();
  const pose = { ...neutral, angleZ: 25 };
  let phys = physics.step(pose, 0);
  for (let i = 0; i < 300; i++) phys = physics.step(pose, 1 / 60);
  const headRoll = -pose.angleZ / 30 * rig.head.maxRoll;
  expect(Math.abs(headRoll + phys.rollRegions[0])).toBeLessThan(Math.abs(headRoll) * 0.2);
  const pivot = engine.deformBase(100, 500, engine.baseWeights(100, 500, 0), pose, phys, [0, 0]);
  const rigid = engine.deformBase(100, 500, engine.baseWeights(100, 500, 0), pose, { ...phys, rollRegions: [0] }, [0, 0]);
  expect(pivot).toEqual(rigid);
  const a = engine.deformBase(100, 800, engine.baseWeights(100, 800, 0), pose, phys, [0, 0]);
  const b = engine.deformBase(100, 1000, engine.baseWeights(100, 1000, 0), pose, phys, [0, 0]);
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(200, 3);
});

test('hair responds with lag, settles after a tilt, and stays bounded during abrupt reversals', () => {
  const rig = swingRig(), { Physics } = createPhysics(createRig(rig), rig), physics = new Physics();
  for (let i = 0; i < 60; i++) physics.step(neutral, 1 / 60);
  const pose = { ...neutral, angleZ: 30 };
  physics.step(pose, 0); // A paused redraw must not consume attachment velocity.
  const first = physics.step(pose, 1 / 60).rollRegions[0];
  let last = first;
  for (let i = 0; i < 300; i++) last = physics.step(pose, 1 / 60).rollRegions[0];
  const target = rig.head.maxRoll * 0.85;
  expect(Math.abs(first - target)).toBeGreaterThan(0.005);
  expect(last).toBeCloseTo(target, 3);
  for (let i = 0; i < 120; i++) {
    const offset = physics.step({ ...neutral, angleZ: i % 2 ? 30 : -30, angleX: i % 3 ? 30 : -30 }, 1 / 60).rollRegions[0];
    expect(Number.isFinite(offset)).toBe(true);
    expect(Math.abs(offset)).toBeLessThanOrEqual(0.3);
  }
});

test('validates optional pendulum data and preserves legacy regions without it', () => {
  const rig = swingRig();
  expect(validateRig(rig)).toEqual([]);
  rig.head.rollRegions![0].swing!.gravity = 1.5;
  expect(validateRig(rig).join()).toContain('swing.gravity');
  rig.head.rollRegions![0].swing!.gravity = 0.85;
  rig.head.rollRegions![0].swing!.band = [700, 500];
  expect(validateRig(rig).join()).toContain('swing.band');
});

test('extra roll regions are optional and reject invalid outline or feather', () => {
  const rig = parseRig(fixture);
  expect(validateRig(rig)).toEqual([]);
  rig.head.rollRegions = [{ outline: [[0, 0], [100, 0], [0, 100]], feather: 20 }];
  expect(validateRig(rig)).toEqual([]);
  rig.head.rollRegions[0].feather = 0;
  expect(validateRig(rig).join()).toContain('rollRegions[0].feather');
  rig.head.rollRegions[0].feather = 20;
  rig.head.rollRegions[0].outline.pop();
  expect(validateRig(rig).join()).toContain('rollRegions[0].outline');
});

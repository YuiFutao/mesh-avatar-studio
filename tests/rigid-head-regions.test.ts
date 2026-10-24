import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const phys = { gain: 1, strands: [], bunL: [0, 0], bunR: [0, 0] };
test('optional rigid head patch preserves ear shape through both turns and tilts while following its attachment', () => {
  const rig = parseRig(fixture), legacy = createRig(structuredClone(rig));
  rig.head.rigidRegions = [{ outline: [[250, 100], [600, 100], [600, 450], [250, 450]], feather: 25, anchor: [450, 400] }];
  const engine = createRig(rig), points = [[280, 130], [560, 160], [400, 420]];
  for (const angleX of [-30, 0, 30]) for (const angleZ of [-20, 0, 20]) {
    const P = { ...defaults, angleX, angleZ, angleY: 10, bodyAngleZ: 5 };
    const transformed = points.map(([x, y]) => engine.deformBase(x, y, engine.baseWeights(x, y), P, phys, [0, 0]));
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(transformed[i][0] - transformed[0][0], transformed[i][1] - transformed[0][1])).toBeCloseTo(Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]), 9);
    }
    const anchor = engine.deformBase(450, 400, engine.baseWeights(450, 400), P, phys, [0, 0]);
    const oldAnchor = legacy.deformBase(450, 400, legacy.baseWeights(450, 400), P, phys, [0, 0]);
    expect(anchor).toEqual(oldAnchor);
    const outside = [900, 700];
    expect(engine.deformBase(...outside, engine.baseWeights(...outside), P, phys, [0, 0])).toEqual(legacy.deformBase(...outside, legacy.baseWeights(...outside), P, phys, [0, 0]));
  }
});

test('rigid patch and smile selection data reject invalid fields', () => {
  const rig = parseRig(fixture);
  rig.head.rigidRegions = [{ outline: [[250, 100], [600, 100], [600, 450]], feather: 25, anchor: [450, 400] }];
  rig.eyeFrames = { closedMax: .3, openMin: .5, smileOpenSprite: false };
  expect(validateRig(rig)).toEqual([]);
  rig.head.rigidRegions[0].feather = 0;
  expect(validateRig(rig).length).toBeGreaterThan(0);
  rig.head.rigidRegions[0].feather = 25;
  rig.head.rigidRegions[0].anchor[0] = NaN;
  expect(validateRig(rig).length).toBeGreaterThan(0);
});

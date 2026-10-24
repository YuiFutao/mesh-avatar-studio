import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig, PARAMS } from 'mesh-avatar';
import { createSpriteModule } from '../packages/runtime/src/engine/sprites.js';
import { Motion } from '../packages/runtime/src/engine/motion.js';
import { rmsLevel, mapFace, readFace } from '../src/live/tracking';

const stability = { openThreshold: .18, closeThreshold: .12, largeThreshold: .65, smallThreshold: .53, minOpenSeconds: .065 };
const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
function harness(names: string[], stable = true, config: NonNullable<ReturnType<typeof parseRig>['mouth']['stability']> = stability, eyeFrames?: { closedMax: number; openMin: number; smileOpenSprite?: boolean }) {
  const rig = parseRig(fixture);
  if (eyeFrames) rig.eyeFrames = eyeFrames;
  if (stable) rig.mouth.stability = config;
  const layers = new Map<string, { visible: boolean; alpha: number }>();
  const renderer = { addLayer(name: string) { const layer = { visible: false, alpha: 1 }; layers.set(name, layer); return layer; } };
  const engine = { MOUTH: rig.mouth, baseWeights() { return {}; }, deformBase() {} };
  const module = createSpriteModule(engine as never, rig);
  const sheet = { layers: Object.fromEntries(names.map(n => [n, [0, 0, 1, 1]])) };
  const images = Object.fromEntries(names.map(n => [n, { width: 1 }]));
  type Create = (...args: unknown[]) => { update(params: Record<string, number>, physics: unknown, dt: number): unknown };
  const sprites = (module.createSprites as unknown as Create)(renderer, sheet, images, () => ({ rest: [], pos: [] }), () => new Uint8Array());
  const frame = (params: Record<string, number>, dt = 1 / 60) => {
    sprites.update({ ...defaults, ...params }, {}, dt);
    return [...layers].filter(([,l]) => l.visible && l.alpha > .001).map(([n]) => n).sort();
  };
  return Object.assign(frame, { layers });
}
const mouths = ['mouth_a', 'mouth_a_half'];

test('optional wide-source smile keeps open eyes and uses smiling closed mouth, with speech and moods taking priority', () => {
  const names = ['eyes_half_0', 'eyes_half_1', 'eyes_closed_0', 'eyes_closed_1', 'eyes_smile_open_0', 'eyes_smile_open_1', 'mouth_smile', ...mouths];
  const frame = harness(names, true, stability, { closedMax: .3, openMin: .5, smileOpenSprite: false });
  expect(frame({ eyeSmile: .4, eyeSmileL: .4 }, 0)).toEqual(['mouth_smile']);
  expect(frame({ eyeSmile: .4, eyeSmileL: .4, mouthOpen: .8 }, 0)).toEqual(['mouth_a']);
  expect(frame({ eyeSmile: .4, eyeSmileL: .4, eyeLOpen: .4 }, 0)).toEqual(['eyes_half_1', 'mouth_smile']);
  expect(frame({ eyeSmile: .4, eyeSmileL: .4, eyeLOpen: 0 }, 0)).toEqual(['eyes_closed_1', 'mouth_smile']);
  expect(frame({ eyeSmile: 0, eyeSmileL: 1 }, 0)).toEqual([]);
  expect(frame({ eyeSmile: 0, eyeSmileL: 0 }, 0)).toEqual([]);
});

test('narrow half-eye band keeps ordinary partial opening open and preserves blink and independent wink', () => {
  const names = ['closed', 'half', 'smile_open'].flatMap(n => [0, 1].map(i => `eyes_${n}_${i}`));
  const frame = harness(names, true, stability, { closedMax: .3, openMin: .5 });
  for (const open of [.5, .6, .74, 1]) expect(frame({ eyeLOpen: open, eyeROpen: open }, 0)).toEqual([]);
  for (const open of [.3, .4, .499]) expect(frame({ eyeLOpen: open, eyeROpen: open }, 0)).toEqual(['eyes_half_0', 'eyes_half_1']);
  expect(frame({ eyeLOpen: 0, eyeROpen: .6, eyeSmile: .4 }, 0)).toEqual(['eyes_closed_1', 'eyes_smile_open_0']);
  expect(harness(names)({ eyeLOpen: .6, eyeROpen: .6 }, 0)).toEqual(['eyes_half_0', 'eyes_half_1']);
});

test.each([15, 30, 60])('a late short loud peak holds large mouth for 180ms at %i fps without delaying attack', fps => {
  const frame = harness(mouths, true, { ...stability, minOpenSeconds: .12, minSmallSeconds: .1, minLargeSeconds: .18 });
  const dt = 1 / fps;
  frame({ mouthOpen: .3 }, dt); frame({ mouthOpen: .3 }, 1);
  expect(frame({ mouthOpen: .9 }, dt)).toEqual(['mouth_a']);
  let elapsed = 0;
  while (elapsed + dt < .18) {
    elapsed += dt;
    expect(frame({ mouthOpen: .3 }, dt)).toEqual(['mouth_a']);
  }
  expect(frame({ mouthOpen: .3 }, dt)).toEqual(['mouth_a_half']);
  expect(frame({ mouthOpen: 0 }, .09)).toEqual(['mouth_a_half']);
  expect(frame({ mouthOpen: 0 }, .02)).toEqual([]);
  // Silence directly after a large peak also observes the large-state minimum.
  frame({ mouthOpen: .9 }, dt);
  expect(frame({ mouthOpen: 0 }, .17)).toEqual(['mouth_a']);
  expect(frame({ mouthOpen: 0 }, .02)).toEqual([]);
  frame({ mouthOpen: .9 }, dt);
  expect(frame({ mouthOpen: 0 }, 0)).toEqual([]);
});

test.each([15, 30, 60])('mouth hysteresis and short minimum hold at %i fps; silence closes promptly', fps => {
  const frame = harness(mouths), dt = 1 / fps;
  expect(frame({ mouthOpen: .17 }, dt)).toEqual([]);
  expect(frame({ mouthOpen: .19 }, dt)).toEqual(['mouth_a_half']);
  let elapsed = 0;
  while (elapsed + dt < stability.minOpenSeconds) {
    elapsed += dt;
    expect(frame({ mouthOpen: 0 }, dt)).toEqual(['mouth_a_half']);
  }
  expect(frame({ mouthOpen: 0 }, dt)).toEqual([]);
  frame({ mouthOpen: .3 }, dt);
  for (let i = 0; i < fps; i++) expect(frame({ mouthOpen: i % 2 ? .15 : .17 }, dt)).toEqual(['mouth_a_half']);
  expect(frame({ mouthOpen: .11 }, dt)).toEqual([]);
  frame({ mouthOpen: .66 }, dt);
  for (const open of [.59, .61, .54, .6]) expect(frame({ mouthOpen: open }, dt)).toEqual(['mouth_a']);
  expect(frame({ mouthOpen: .52 }, dt)).toEqual(['mouth_a_half']);
  for (const open of [.59, .61, .64]) expect(frame({ mouthOpen: open }, dt)).toEqual(['mouth_a_half']);
});

test('missing vowels select available artwork; data without stability keeps legacy selection', () => {
  const stable = harness(mouths), legacy = harness(mouths, false);
  for (const form of [-1, -.4, .5, 1]) expect(stable({ mouthOpen: .3, mouthForm: form }, 0)).toEqual(['mouth_a_half']);
  expect(legacy({ mouthOpen: .3, mouthForm: -1 }, 0)).toEqual([]);
  expect(harness(['mouth_a'])({ mouthOpen: .3 }, 0)).toEqual(['mouth_a']);
  expect(harness([])({ mouthOpen: .9 }, 0)).toEqual([]);
  const paused = harness(mouths);
  paused({ mouthOpen: .5 });
  expect(paused({ mouthOpen: 0 }, 0)).toEqual([]);
});

test('smiling open artwork is optional, supports gentle smiles, and keeps independent blink/half states', () => {
  const names = ['closed', 'half', 'smile', 'smile_open'].flatMap(n => [0, 1].map(i => `eyes_${n}_${i}`));
  const frame = harness(names);
  expect([...frame.layers.keys()].indexOf('eyes_smile_open_0')).toBeLessThan([...frame.layers.keys()].indexOf('eyes_closed_0'));
  expect(frame({ eyeSmile: .4, eyeSmileL: .4 }, 0)).toEqual(['eyes_smile_open_0', 'eyes_smile_open_1']);
  expect(frame({ eyeSmile: .8, eyeSmileL: .8, eyeLOpen: 0 }, 0)).toEqual(['eyes_smile_1', 'eyes_smile_open_0']);
  expect(frame({ eyeSmile: .8, eyeSmileL: .8, eyeROpen: .5 }, 0)).toEqual(['eyes_half_0', 'eyes_smile_open_1']);
  expect(frame({ eyeSmile: 0, eyeSmileL: 0 }, 0)).toEqual([]);
  frame({ eyeROpen: .5, eyeLOpen: .5 }, 0);
  frame({ eyeSmile: .4, eyeSmileL: .4 }, .03);
  expect(frame.layers.get('eyes_half_0')?.alpha).toBe(1);
  expect(frame.layers.get('eyes_smile_open_0')?.alpha).toBeCloseTo(.5);
  expect(harness(names.filter(n => !n.startsWith('eyes_smile_open')))({ eyeSmile: .8, eyeSmileL: .8 }, 0)).toEqual([]);
  frame({ eyeSmile: .4, eyeSmileL: .4 }, 0);
  frame({ eyeSmile: .8, eyeSmileL: .8, eyeLOpen: 0, eyeROpen: 0 }, .03);
  expect(frame.layers.get('eyes_smile_open_0')?.alpha).toBe(1);
  expect(frame.layers.get('eyes_smile_0')?.alpha).toBeCloseTo(.5);
});

test('mouth stability rejects invalid durations and reversed thresholds', () => {
  const rig = parseRig(fixture);
  rig.mouth.stability = stability;
  expect(validateRig(rig)).toEqual([]);
  for (const change of [{ minOpenSeconds: -1 }, { minOpenSeconds: NaN }, { minOpenSeconds: 1.1 }, { closeThreshold: .2 }, { smallThreshold: .7 }]) {
    rig.mouth.stability = { ...stability, ...change };
    expect(validateRig(rig).length).toBeGreaterThan(0);
  }
  rig.mouth.stability = { ...stability, minLargeSeconds: -1 };
  expect(validateRig(rig).length).toBeGreaterThan(0);
  rig.mouth.stability = { ...stability, minSmallSeconds: NaN };
  expect(validateRig(rig).length).toBeGreaterThan(0);
  rig.mouth.stability = stability;
  for (const eyeFrames of [{ closedMax: .5, openMin: .5 }, { closedMax: -.1, openMin: .5 }, { closedMax: .3, openMin: NaN }]) {
    rig.eyeFrames = eyeFrames;
    expect(validateRig(rig).length).toBeGreaterThan(0);
  }
});

test('camera mapping and microphone RMS/speech feed small, large and closed drawings for all vowels', () => {
  const frame = harness(mouths, true, { ...stability, openThreshold: .14, closeThreshold: .09 });
  const camera = (jaw: number) => mapFace(readFace({ faceLandmarks: [[]], facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }], faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: jaw }] }] })!, null, { mirror: true, sensitivity: 1, smoothing: .35 });
  expect(frame(camera(.2), 0)).toEqual(['mouth_a_half']);
  expect(frame(camera(.8), 0)).toEqual(['mouth_a']);
  expect(frame(camera(0), 0)).toEqual([]);
  for (const vowel of ['a', 'i', 'u', 'e', 'o']) {
    const motion = new Motion([0, 0]); motion.setSpeaking(true);
    for (const [rms, expected] of [[.026, 'mouth_a_half'], [.2, 'mouth_a'], [0, null]] as const) {
      motion.setVoiceLevel(rmsLevel(new Float32Array([rms, -rms]), 1));
      let shown: string[] = [];
      for (let i = 0; i < 90; i++) {
        motion.vowel = vowel; motion.syllableArmed = false;
        const [mouthOpen, mouthForm] = motion.speechMouth(1 / 60)!;
        shown = frame({ mouthOpen, mouthForm });
      }
      expect(shown, `${vowel} at RMS ${rms}`).toEqual(expected ? [expected] : []);
    }
  }
});

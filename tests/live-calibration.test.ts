import { afterEach, expect, test, vi } from 'vitest';
import { FaceCalibration, calibrationFromQuery, loadCalibration, parseCalibrationProfile, saveCalibration, type CalibrationProfile } from '../src/live/calibration';
import { FacePose, type FaceResult } from '../src/live/tracking';
const profile: CalibrationProfile = { version: 1, config: { neutralMouth: 1e-6, floor: 2e-5, exit: 3e-5, enter: 6e-5, gentle: 3e-4, big: .9,
  open: [.1, .2], closed: [.65, .75], enterSeconds: .1, exitSeconds: .16, riseSeconds: .08, fallSeconds: .12 } };
const shapes = (mouth = 0, left = .1, right = .2) => ({ mouthSmileLeft: mouth, mouthSmileRight: mouth, eyeBlinkLeft: left, eyeBlinkRight: right, jawOpen: .6, browInnerUp: .4 });
const result = (s = shapes()): FaceResult => ({ faceLandmarks: [[]], facialTransformationMatrixes: [{ data: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }], faceBlendshapes: [{ categories: Object.entries(s).map(([categoryName, score]) => ({ categoryName, score })) }] });
const options = { mirror: false, sensitivity: 1, smoothing: .35 };
afterEach(() => vi.unstubAllGlobals());
test('profiles reject unusable ranges and copy only validated configuration', () => {
  const source = { ...structuredClone(profile), ignored: 'metadata' };
  const parsed = parseCalibrationProfile(source)!; expect(parsed).toEqual(profile);
  parsed.config.open[0] = .3; expect(source.config.open[0]).toBe(.1);
  for (const patch of [{ enter: NaN }, { enter: 1e-320 }, { gentle: 1 }, { closed: [.1, .75] }, { riseSeconds: 0 }, { exit: .1 }, { open: [0] }, { floor: -1 }]) {
    expect(parseCalibrationProfile({ version: 1, config: { ...profile.config, ...patch } })).toBeNull();
  }
  expect(parseCalibrationProfile({ version: 2, config: profile.config })).toBeNull();
});
test('calibration uses temporal evidence, keeps asymmetric eyes and releases safely', () => {
  const c = new FaceCalibration(profile.config);
  c.update(shapes(.000301, .65, .2), 0);
  expect(c.output.smile).toBe(0); expect(c.output.eyes).toEqual([0, 1]);
  for (let i = 0; i < 60; i++) c.update(shapes(.000301, .65, .2), 1 / 30);
  expect(c.output.smile).toBeCloseTo(.4, 3);
  for (let i = 0; i < 60; i++) c.update(shapes(.900001), 1 / 30);
  expect(c.output.smile).toBeGreaterThan(.99);
  c.update(shapes(.900001), .3); expect(c.output.valid).toBe(false); expect(c.output.smile).toBe(0);
  c.update({ ...shapes(), eyeBlinkLeft: NaN }, .03); expect(c.output.valid).toBe(false);
});
test('zero-duration gates still require their amplitude threshold', () => {
  const c = new FaceCalibration({ ...profile.config, enterSeconds: 0, exitSeconds: 0 });
  c.update(shapes(), .1); expect(c.output.smile).toBe(0);
  for (let i = 0; i < 30; i++) c.update(shapes(.000301), 1 / 30);
  expect(c.output.smile).toBeCloseTo(.4, 3);
  const before = c.output.smile; c.update(shapes(), .1); expect(c.output.smile).toBeLessThan(before);
});
test('optional correction affects only eyes and smile, supports mirror and restores old behavior', () => {
  const old = new FacePose(), corrected = new FacePose(); corrected.setCalibration(profile.config);
  let a, b;
  for (let i = 0; i < 60; i++) {
    const r = result(shapes(.000301, .65, .2)); old.update(r, i * 33); corrected.update(r, i * 33);
    a = old.sample(i * 33, .033, options); b = corrected.sample(i * 33, .033, options);
    for (const k of ['angleX', 'angleY', 'angleZ', 'bodyAngleX', 'gazeX', 'mouthOpen', 'mouthForm', 'browY']) expect(b.params[k]).toBe(a.params[k]);
  }
  expect(b!.params.eyeSmile).toBeCloseTo(.4, 3); expect(b!.params.eyeLOpen).toBeLessThan(.001); expect(b!.params.eyeROpen).toBeGreaterThan(.99);
  for (let i = 0; i < 30; i++) { old.sample(1950, .033, { ...options, mirror: true }); b = corrected.sample(1950, .033, { ...options, mirror: true }); }
  expect(b!.params.eyeROpen).toBeLessThan(.001); expect(b!.params.eyeLOpen).toBeGreaterThan(.99);
  corrected.setCalibration(null);
  old.update(result(shapes(.000301)), 2000); corrected.update(result(shapes(.000301)), 2000);
  expect(corrected.sample(2000, .033, options).params).toEqual(old.sample(2000, .033, options).params);
});
test('cached renders do not count as new smile evidence, and missing or stale input resets it', () => {
  const p = new FacePose(); p.setCalibration(profile.config); p.update(result(shapes(.000301)), 0);
  for (let t = 0; t < 300; t += 5) expect(p.sample(t, .005, options).params.eyeSmile).toBe(0);
  for (let i = 1; i < 30; i++) { p.update(result(shapes(.000301)), i * 33); p.sample(i * 33, .033, options); }
  expect(p.sample(960, .033, options).params.eyeSmile).toBeGreaterThan(.39);
  expect(p.sample(1300, .033, options).params.eyeSmile).toBe(0);
  p.update(result({ ...shapes(), mouthSmileLeft: NaN }), 1320);
  expect(p.sample(1320, .033, options).params.eyeSmile).toBe(0);
  p.reset(); expect(p.sample(1400, .033, options).tracking).toBe(false);
});
test('storage is scoped to avatar and project and can be unavailable', () => {
  const entries = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v) });
  saveCalibration('a', undefined, { profile, enabled: true }); expect(loadCalibration('a')).toEqual({ profile, enabled: true });
  expect(loadCalibration('b').enabled).toBe(false); expect(loadCalibration('a', '/different.mavatar').enabled).toBe(false);
  vi.stubGlobal('localStorage', { getItem() { throw Error(); }, setItem() { throw Error(); } });
  expect(loadCalibration('a')).toEqual({ profile: null, enabled: false }); expect(() => saveCalibration('a', undefined, { profile, enabled: true })).not.toThrow();
});
test('explicit profile requests stay local and reject redirects, malformed and oversized content', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(profile))); vi.stubGlobal('fetch', fetchMock);
  expect(await calibrationFromQuery('', 'http://127.0.0.1:5173')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  await expect(calibrationFromQuery('?trackingProfile=https://example.com/p.json', 'http://127.0.0.1:5173')).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  expect(await calibrationFromQuery('?trackingProfile=/p.json', 'http://127.0.0.1:5173')).toEqual(profile);
  expect(fetchMock.mock.calls[0]).toEqual(['http://127.0.0.1:5173/p.json', { credentials: 'same-origin', redirect: 'error' }]);
  fetchMock.mockImplementation(async () => new Response('x'.repeat(65537)));
  await expect(calibrationFromQuery('?trackingProfile=/p.json', 'http://127.0.0.1:5173')).rejects.toThrow();
});

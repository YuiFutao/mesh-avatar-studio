import {expect, test, vi} from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import {parseRig, validateRig, PARAMS} from 'mesh-avatar';
import {createRig} from '../packages/runtime/src/engine/rig.js';
import {createPhysics} from '../packages/runtime/src/engine/physics.js';
const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
function setup(enabled = true) {
  const rig = parseRig(fixture);
  rig.strands = []; delete rig.buns;
  rig.accessories = [0, 1].map(i => ({name: `ear_${i}`, pivot: [700, 500], tip: [700, 150], split: .42,
    box: [500, 100, 850, 550], color: {redness: .5, minRed: 60},
    pendulum: {mode: 'upright', frequency: 1.5, damping: .55, inertia: .4, maxAngle: .085, maxBend: .045},
    ...(enabled ? {twitch: {interval: [10, 20], angle: i ? .07 : -.07}} : {})}));
  const engine = createRig(rig);
  return {rig, engine, physics: new (createPhysics(engine, rig).Physics)()};
}

test.each([15, 30, 60, 120])('one shared gesture every 10–20 seconds, two pulses and exact rest at %i fps', fps => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  try {
    const {rig, physics} = setup(); expect(validateRig(rig)).toEqual([]);
    const starts: number[] = [], peaks: number[] = [];
    let moving = false, lastPeak = 0;
    for (let i = 0; i < fps * 100; i++) {
      physics.step(defaults, 1 / fps);
      const a = Math.abs(physics.chains[1].phi[0]);
      expect(physics.chains[0].phi).toEqual([0, 0]); // Only the selected ear moves.
      expect(a).toBeLessThanOrEqual(.07 + 1e-12);
      expect(physics.chains[1].phi[1]).toBe(physics.chains[1].phi[0]); // No added bend.
      if (a > 1e-8 && !moving) {starts.push((i + 1) / fps); lastPeak = 0;}
      if (a > 1e-8) lastPeak = Math.max(a, lastPeak);
      if (a <= 1e-8 && moving) peaks.push(lastPeak);
      moving = a > 1e-8;
    }
    expect(starts).toHaveLength(12); // Six pairs, not twice the cadence for two ears.
    for (let i = 2; i < starts.length; i += 2) expect(starts[i] - starts[i - 2]).toBeCloseTo(15, 5);
    expect(starts[1] - starts[0]).toBeLessThan(.4);
    expect(peaks[0]).toBeGreaterThan(.05); expect(peaks[1]).toBeGreaterThan(.03);
    expect(physics.chains[1].phi).toEqual([0, 0]);
  } finally {random.mockRestore();}
});

test('twitch overlaps head motion safely and returns to unchanged spring state', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  try {
    const active = setup(), baseline = setup(false);
    for (let i = 0; i < 60 * 36; i++) {
      const t = (i + 1) / 60, P = {...defaults, angleX: 25 * Math.sin(t * 4), angleZ: 18 * Math.sin(t * 5)};
      active.physics.step(P, 1 / 60); baseline.physics.step(P, 1 / 60);
      active.physics.chains.forEach((ch, j) => {
        const reference = active.engine.attachmentAngle(active.rig.accessories![j], P);
        expect(Math.abs(ch.phi[0] - reference)).toBeLessThanOrEqual(.085 + 1e-12);
        expect(Math.abs(ch.phi[1] - ch.phi[0])).toBeLessThanOrEqual(.045 + 1e-12);
        expect(ch.pts!.flat().every(Number.isFinite)).toBe(true);
        if (!active.physics.twitch?.active) expect(ch.phi).toEqual(baseline.physics.chains[j].phi);
      });
    }
  } finally {random.mockRestore();}
});

test('pause, long gap and zero gain leave no stuck gesture; absent data consumes no randomness', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  try {
    const legacy = setup(false); legacy.physics.step(defaults, 1 / 60); expect(random).not.toHaveBeenCalled();
    const {physics} = setup();
    for (let i = 0; i < 906; i++) physics.step(defaults, 1 / 60);
    expect(Math.abs(physics.chains[1].phi[0])).toBeGreaterThan(.05);
    physics.gain = 0; physics.step(defaults, 1 / 60); expect(physics.chains[1].phi).toEqual([0, 0]);
    physics.gain = 1; physics.step(defaults, 0); expect(physics.chains[1].phi).toEqual([0, 0]);
    physics.step(defaults, 60); expect(physics.chains[1].phi).toEqual([0, 0]);
    physics.step(defaults, 1 / 60); expect(physics.chains[1].phi).toEqual([0, 0]);
  } finally {random.mockRestore();}
});

test('reject invalid optional twitch data', () => {
  for (const twitch of [{interval: [0, 20], angle: .07}, {interval: [20, 10], angle: .07},
    {interval: [10, 20], angle: NaN}, {interval: [10, 20], angle: .2}, {interval: [10, 20], angle: 0}]) {
    const {rig} = setup(); rig.accessories![0].twitch = twitch as {interval: [number, number]; angle: number};
    expect(validateRig(rig).length).toBeGreaterThan(0);
  }
  const {rig} = setup(); delete rig.accessories![0].pendulum;
  expect(validateRig(rig).some(e => e.includes('requires an upright pendulum'))).toBe(true);
});

test.each([0, .999999])('random interval endpoints remain in range with a clamped physics clock (%s)', value => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(value);
  try {
    const {physics} = setup(), expected = 10 + value * 10;
    expect(physics.twitch!.next).toBeCloseTo(expected, 9);
    for (let i = 0; i < Math.floor(expected * 15); i++) physics.step(defaults, .05, 1 / 15);
    physics.step(defaults, .05, 1 / 15);
    expect(physics.twitch!.start).toBeCloseTo(expected, 9);
    expect(physics.twitch!.time).toBeGreaterThanOrEqual(expected);
    expect(physics.twitch!.time).toBeLessThan(expected + .1);
  } finally {random.mockRestore();}
});

test('manual preview starts once, restores the normal shared interval and is a no-op without data', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  try {
    const {physics} = setup(); physics.triggerTwitch();
    expect(physics.twitch!.next).toBe(15);
    physics.step(defaults, .1); expect(Math.abs(physics.chains[1].phi[0])).toBeGreaterThan(.05);
    physics.step(defaults, .2); physics.step(defaults, .24);
    expect(physics.chains[1].phi).toEqual([0, 0]);
    expect(physics.twitch!.next).toBe(15);
    const legacy = setup(false); legacy.physics.triggerTwitch(); expect(legacy.physics.twitch).toBeNull();
  } finally {random.mockRestore();}
});

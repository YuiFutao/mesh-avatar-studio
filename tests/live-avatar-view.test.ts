import { afterEach, expect, test, vi } from 'vitest';
import { createAvatarView } from '../src/live/avatar-view';

const avatar = vi.hoisted(() => ({
  setAutoIdle: vi.fn(), setAutoMotion: vi.fn(), setParameters: vi.fn(),
  advance: vi.fn(), advanceParameters: vi.fn(), destroy: vi.fn(),
}));
vi.mock('mesh-avatar', () => ({ PARAMS: [], createMeshAvatar: vi.fn(), loadMeshAvatar: async () => avatar }));
vi.mock('../src/editor/project', () => ({ localProjects: vi.fn(), openLocalProject: vi.fn(), openSampleAvatar: vi.fn() }));
const settings = { avatar: '/avatar.json', project: 'test', background: 'transparent', fit: 'contain' as const, idle: true };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function clock() {
  let callback: FrameRequestCallback = () => undefined;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return (now: number) => callback(now);
}

test('30 fps drawing stays capped on a 144 Hz display while preserving elapsed animation time', async () => {
  const step = clock();
  const view = await createAvatarView({ dataset: {} } as HTMLCanvasElement, { ...settings, fps: 30 });
  for (let i = 1; i <= 1440; i++) step(i * 1000 / 144);
  expect(avatar.advance.mock.calls.length).toBeGreaterThanOrEqual(299);
  expect(avatar.advance.mock.calls.length).toBeLessThanOrEqual(301);
  const elapsed = avatar.advance.mock.calls.reduce((sum, args) => sum + args[2], 0);
  expect(elapsed).toBeCloseTo(10, 1);
  view.destroy();
});

test('paused preview runs parameter relay without drawing and can resume without reloading', async () => {
  const step = clock(), relay = vi.fn(); let draw = false;
  const view = await createAvatarView({ dataset: {} } as HTMLCanvasElement, { ...settings, fps: 30 }, undefined, relay, () => draw);
  for (let i = 1; i <= 120; i++) step(i * 1000 / 60);
  expect(avatar.advance).not.toHaveBeenCalled();
  expect(avatar.advanceParameters.mock.calls.length).toBeGreaterThanOrEqual(59);
  expect(relay).toHaveBeenCalledTimes(avatar.advanceParameters.mock.calls.length);
  expect(view.paintPaused(2000)).toBe(false);
  draw = true;
  for (let i = 121; i <= 180; i++) step(i * 1000 / 60);
  expect(avatar.advance.mock.calls.length).toBeGreaterThanOrEqual(29);
  // When the browser suspends paint callbacks, the worker clock still relays parameters.
  const before = relay.mock.calls.length;
  view.updateIfStalled(3300);
  expect(relay).toHaveBeenCalledTimes(before + 1);
  view.destroy();
});

test('without performance options the normal preview still draws every display frame', async () => {
  const step = clock();
  const view = await createAvatarView({ dataset: {} } as HTMLCanvasElement, settings);
  for (let i = 1; i <= 144; i++) step(i * 1000 / 144);
  expect(avatar.advance).toHaveBeenCalledTimes(144);
  view.destroy();
});

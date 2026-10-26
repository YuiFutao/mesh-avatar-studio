import { createMeshAvatar, loadMeshAvatar, type MeshAvatar, PARAMS } from 'mesh-avatar';
import { localProjects, openLocalProject, openSampleAvatar } from '../editor/project';
import { SAMPLE_PROJECT, type ViewSettings } from './settings';

export const neutralParameters: Record<string, number> = Object.fromEntries(PARAMS.map(param => [param.id, param.def]));
export interface FrameTiming { frames: number; totalMs: number; maxMs: number }
export async function createAvatarView(canvas: HTMLCanvasElement, settings: ViewSettings,
  beforeFrame?: (avatar: MeshAvatar, now: number, dt: number) => void,
  afterFrame?: (avatar: MeshAvatar, now: number) => void,
  drawEnabled: () => boolean = () => true) {
  canvas.dataset.state = 'loading';
  const options = { manual: true, fit: settings.fit, preserveMouthForm: true };
  let avatar: MeshAvatar;
  if (settings.avatar) avatar = await loadMeshAvatar(canvas, settings.avatar, options);
  else {
    const projects = await localProjects(), project = projects?.find(entry => entry.name === settings.project);
    if (project?.error || (!project && settings.project !== SAMPLE_PROJECT)) throw new Error('Project unavailable');
    const loaded = project ? await openLocalProject(project) : await openSampleAvatar();
    avatar = await createMeshAvatar(canvas, { ...options, rig: loaded.rig!, assets: loaded.assets });
  }
  if (settings.lighting) avatar.setLighting(settings.lighting);
  avatar.setAutoIdle(settings.idle); avatar.setAutoMotion(settings.idle);
  if (!settings.idle) avatar.setParameters(neutralParameters);
  canvas.dataset.state = 'ready';
  const timing: FrameTiming = { frames: 0, totalMs: 0, maxMs: 0 };
  let raf = 0, previous = performance.now(), lastPaint = previous, lastAnimation = previous, nextFrame = previous;
  const update = (now: number, draw = true) => {
    const frameElapsed = Math.max(0, (now - previous) / 1000);
    const dt = Math.min(0.05, Math.max(0.001, frameElapsed)); previous = now;
    beforeFrame?.(avatar, now, dt);
    const start = performance.now();
    if (draw) avatar.advance(dt, 1 / dt, frameElapsed); else avatar.advanceParameters(dt);
    const elapsed = performance.now() - start;
    if (draw) { timing.frames++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed); }
    afterFrame?.(avatar, now);
  };
  const frame = (now: number) => {
    lastAnimation = now;
    const draw = drawEnabled(), interval = settings.fps ? 1000 / settings.fps : draw ? 0 : 1000 / 30;
    if (!interval || now >= nextFrame) {
      if (draw) lastPaint = now;
      update(now, draw);
      // Keep the deadline on its original cadence, rather than rounding 30 fps down
      // to 20 fps when a display callback arrives slightly after a frame boundary.
      nextFrame = interval ? now + interval - (now - nextFrame) % interval : now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { avatar, timing,
    paintPaused(now: number) { return drawEnabled() && now - lastPaint > 1000; },
    updateIfStalled(now: number) { if (now - lastAnimation > 100 && now - previous >= 1000 / 30 - 2) update(now, false); },
    destroy() { cancelAnimationFrame(raf); avatar.destroy(); } };
}

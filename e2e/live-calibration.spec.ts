import { test, expect, type Page } from '@playwright/test';
import { samplePresent, sampleSkipReason } from './sample';
test.beforeEach(() => test.skip(!samplePresent, sampleSkipReason));
const profile = { version: 1, config: { neutralMouth: 1e-6, floor: 2e-5, exit: 3e-5, enter: 6e-5, gentle: 3e-4, big: .9,
  open: [.1, .2], closed: [.65, .75], enterSeconds: .1, exitSeconds: .16, riseSeconds: .08, fallSeconds: .12 } };
async function prepare(page: Page) {
  const outside: string[] = [];
  await page.context().route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { outside.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    const globals = window as Window & { cameraCalls?: number };
    globals.cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      globals.cameraCalls!++;
      const c = document.createElement('canvas'); c.width = 640; c.height = 480;
      const ctx = c.getContext('2d')!, timer = setInterval(() => ctx.fillRect(0, 0, 640, 480), 33);
      const stream = c.captureStream(30), track = stream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); }; return stream;
    };
  });
  await page.context().route('**/mediapipe/tracking-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = ({data}) => {
      if(data.type === 'init') self.postMessage({type:'ready',delegate:'GPU'});
      if(data.type === 'frame') {
        const scores={mouthSmileLeft:.000301,mouthSmileRight:.000301,eyeBlinkLeft:.65,eyeBlinkRight:.2,jawOpen:.4};
        self.postMessage({type:'result',elapsed:1,result:{faceLandmarks:[[]],facialTransformationMatrixes:[{data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],faceBlendshapes:[{categories:Object.entries(scores).map(([categoryName,score])=>({categoryName,score}))}]}});
        data.frame.close(); self.postMessage({type:'consumed'});
      }
    };` }));
  return outside;
}
async function ready(page: Page, path = '/live.html') { await page.goto(path); await expect(page.getByTestId('live-avatar')).toHaveAttribute('data-state', 'ready'); }
async function nextParams(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/live/relay.ts'; const { receiveLiveParameters } = await import(path);
    return new Promise<Record<string, number>>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(Error('No relay')); }, 2500);
      const off = receiveLiveParameters((data: { params: Record<string, number> }) => { clearTimeout(timer); off(); resolve(data.params); });
    });
  });
}
test('optional calibration imports, relays, switches off and persists without starting devices', async ({ context, page }) => {
  const outside = await prepare(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  const section = page.getByTestId('tracking-calibration'); await section.locator('summary').click();
  const enabled = page.getByRole('checkbox', { name: 'Use calibrated face tracking' });
  await expect(enabled).not.toBeChecked(); await expect(enabled).toBeDisabled();
  await page.getByLabel('Load calibration JSON', { exact: true }).setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
  await expect(enabled).toBeChecked();
  expect(await page.evaluate(() => (window as Window & { cameraCalls?: number }).cameraCalls)).toBe(0);
  const stream = await context.newPage(); await stream.goto('/stream.html');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'tracking');
  await expect.poll(async () => Number(await page.getByTestId('tracking-signal-smile').textContent())).toBeGreaterThan(.39);
  await expect(stream.locator('#avatar')).toHaveAttribute('data-live', 'active');
  await expect.poll(async () => (await nextParams(page)).eyeSmile).toBeGreaterThan(.39);
  await expect.poll(async () => (await nextParams(page)).eyeROpen).toBeLessThan(.01);
  await enabled.uncheck();
  await expect.poll(async () => (await nextParams(page)).eyeSmile).toBeLessThan(.001);
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
  await page.reload(); await expect(page.getByTestId('live-avatar')).toHaveAttribute('data-state', 'ready');
  await expect(enabled).not.toBeChecked(); await expect(enabled).toBeEnabled();
  expect(await page.evaluate(() => (window as Window & { cameraCalls?: number }).cameraCalls)).toBe(0);
  await page.getByRole('button', { name: 'Remove calibration', exact: true }).click(); await section.locator('summary').click(); await expect(enabled).toBeDisabled();
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});
test('explicit local profile installs once and external or malformed profiles cannot replace it', async ({ page }) => {
  const outside = await prepare(page);
  await page.route(url => url.pathname === '/test-calibration.json', route => route.fulfill({ json: profile }));
  await ready(page, '/live.html?trackingProfile=/test-calibration.json');
  const enabled = page.getByRole('checkbox', { name: 'Use calibrated face tracking' });
  await expect(enabled).toBeChecked(); await expect(page).not.toHaveURL(/trackingProfile/);
  await enabled.uncheck(); await page.reload(); await expect(enabled).not.toBeChecked();
  await page.getByLabel('Load calibration JSON', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole('alert')).toContainText('Could not load calibration'); await expect(enabled).toBeEnabled();
  await ready(page, '/live.html?trackingProfile=https://example.com/private.json');
  await expect(page.getByRole('alert')).toContainText('Could not load calibration'); await expect(enabled).not.toBeChecked();
  expect(await page.evaluate(() => (window as Window & { cameraCalls?: number }).cameraCalls)).toBe(0);
  expect(outside).toEqual([]);
});

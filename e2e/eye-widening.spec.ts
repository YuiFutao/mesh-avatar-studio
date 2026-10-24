import {expect, test} from '@playwright/test';
import {samplePresent, sampleSkipReason} from './sample';

test('calibrated camera widening reaches the stream relay, swaps mirror sides and yields to blinking', async ({page}) => {
  test.skip(!samplePresent, sampleSkipReason);
  const outside: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.context().route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (outside.push(route.request().url()), route.abort()));
  await page.addInitScript(() => {
    Object.assign(window, {cameraCalls: 0});
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as {cameraCalls: number}).cameraCalls++;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!, timer = setInterval(() => ctx.fillRect(0, 0, 640, 480), 33);
      const stream = canvas.captureStream(30), track = stream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => {clearInterval(timer); stop();}; return stream;
    };
  });
  await page.route('**/mediapipe/tracking-worker.js', route => route.fulfill({contentType: 'text/javascript', body: `
    let frames=0;
    self.onmessage=({data})=>{
      if(data.type==='init')self.postMessage({type:'ready',delegate:'GPU'});
      if(data.type==='frame'){
        const blink=frames++%60>=30;
        const shapes={mouthSmileLeft:.9,mouthSmileRight:.9,eyeBlinkLeft:blink ? .9 : .01,eyeBlinkRight:.2,eyeWideLeft:.01,eyeWideRight:0};
        self.postMessage({type:'result',elapsed:1,result:{faceLandmarks:[[]],facialTransformationMatrixes:[{data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],faceBlendshapes:[{categories:Object.entries(shapes).map(([categoryName,score])=>({categoryName,score}))}]}});
        data.frame.close();self.postMessage({type:'consumed'});
      }
    };`}));
  const profile = {version: 1, config: {neutralMouth: 0, floor: .00002, exit: .00003, enter: .00006, gentle: .0003, big: .9,
    open: [.1, .2], closed: [.65, .75], enterSeconds: .1, exitSeconds: .16, riseSeconds: .08, fallSeconds: .12}};
  await page.route(url => url.pathname === '/wide-test-profile.json', route => route.fulfill({json: profile}));
  await page.goto('/live.html?trackingProfile=/wide-test-profile.json');
  await expect(page.getByTestId('live-avatar')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => (window as unknown as {cameraCalls: number}).cameraCalls)).toBe(0);
  await page.evaluate(async () => {
    const path = '/src/live/relay.ts', {receiveLiveParameters} = await import(path);
    const seen: Record<string, number>[] = []; Object.assign(window, {wideSeen: seen});
    receiveLiveParameters((data: {params: Record<string, number>}) => seen.push(data.params));
  });
  await page.getByRole('button', {name: 'Start camera', exact: true}).click();
  const seen = () => page.evaluate(() => (window as unknown as {wideSeen: Record<string, number>[]}).wideSeen);
  await expect.poll(async () => (await seen()).some(p => p.eyeRWide > .95 && p.eyeLWide === 0 && p.eyeROpen > .99 && p.eyeSmile > .9)).toBe(true);
  await expect.poll(async () => (await seen()).some(p => p.eyeRWide < .05 && p.eyeROpen < .05 && p.eyeLOpen > .99)).toBe(true);
  await page.getByRole('button', {name: 'Stop camera', exact: true}).click();
  expect(await page.evaluate(() => (window as unknown as {cameraCalls: number}).cameraCalls)).toBe(1);
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer, WebSocketClient } from 'vite';
import { afterEach, expect, test, vi } from 'vitest';
import { IDLE_SHUTDOWN_MS, IDLE_SHUTDOWN_PATH, idleShutdown } from '../src/server/idle-shutdown';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
function setup(options: { enabled?: boolean } = { enabled: true }) {
  vi.useFakeTimers();
  const ws = Object.assign(new EventEmitter(), { clients: new Set<WebSocketClient>() });
  const http = new EventEmitter(), exit = vi.fn(), info = vi.fn(), error = vi.fn();
  const close = vi.fn(async () => { http.emit('close'); });
  let middleware: Middleware | undefined;
  const server = { ws, httpServer: http, close, config: { logger: { info, error } },
    middlewares: { use: (handler: Middleware) => { middleware = handler; } } } as unknown as ViteDevServer;
  const plugin = idleShutdown({ ...options, exit });
  if (typeof plugin.configureServer !== 'function') throw new Error('Missing configureServer');
  plugin.configureServer.call({} as never, server);
  const connect = () => { const socket = new EventEmitter(); ws.emit('connection', socket); return socket; };
  return { ws, http, close, exit, connect, info, error, request: (path: string) => {
    const writeHead = vi.fn(), end = vi.fn(), next = vi.fn();
    middleware?.({ url: path, method: 'GET' } as IncomingMessage, { writeHead, end } as unknown as ServerResponse, next);
    return { writeHead, end, next };
  } };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

test('the launcher server exits after exactly five unused minutes, including if no browser ever opens', async () => {
  const server = setup();
  expect(IDLE_SHUTDOWN_MS).toBe(300000);
  await vi.advanceTimersByTimeAsync(299999); expect(server.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(server.close).toHaveBeenCalledOnce();
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('open Live and OBS pages prevent shutdown without any user interaction', async () => {
  const server = setup(), live = server.connect(), obs = server.connect();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000); expect(server.close).not.toHaveBeenCalled();
  live.emit('close');
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000); expect(server.close).not.toHaveBeenCalled();
  obs.emit('close');
  await vi.advanceTimersByTimeAsync(299999); expect(server.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(server.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test('a three-minute break is safe and reconnecting gives a new full five-minute grace period', async () => {
  const server = setup(), live = server.connect(); live.emit('close');
  await vi.advanceTimersByTimeAsync(3 * 60 * 1000); expect(server.close).not.toHaveBeenCalled();
  const resumed = server.connect();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000); expect(server.close).not.toHaveBeenCalled();
  resumed.emit('close');
  await vi.advanceTimersByTimeAsync(299999); expect(server.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(server.close).toHaveBeenCalledOnce();
});

test('loading a page resets the grace period and exposes the five-minute launcher setting', async () => {
  const server = setup();
  await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
  const response = server.request(IDLE_SHUTDOWN_PATH);
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }));
  expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ timeoutMs: 300000 });
  expect(response.next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(299999); expect(server.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(server.close).toHaveBeenCalledOnce();
});

test('manual server shutdown removes the pending auto-exit timer', async () => {
  const server = setup(); server.http.emit('close');
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(server.close).not.toHaveBeenCalled(); expect(server.exit).not.toHaveBeenCalled();
  expect(server.ws.listenerCount('connection')).toBe(0);
});

test('normal development servers do not install idle shutdown', async () => {
  vi.stubEnv('MESH_AVATAR_IDLE_SHUTDOWN', '');
  const server = setup({});
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(server.close).not.toHaveBeenCalled(); expect(server.exit).not.toHaveBeenCalled();
  expect(server.ws.listenerCount('connection')).toBe(0);
  expect(server.request(IDLE_SHUTDOWN_PATH).end).not.toHaveBeenCalled();
});

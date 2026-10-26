import type { Plugin, WebSocket } from 'vite';

export const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;
export const IDLE_SHUTDOWN_PATH = '/__studio/idle-shutdown';

/** Only launcher-owned servers opt in. Connected pages count as use, even when hidden. */
export function idleShutdown(options: { enabled?: boolean; timeoutMs?: number; exit?: (code: number) => void } = {}): Plugin {
  const enabled = options.enabled ?? process.env.MESH_AVATAR_IDLE_SHUTDOWN === '1';
  const timeoutMs = options.timeoutMs ?? IDLE_SHUTDOWN_MS;
  const exit = options.exit ?? (code => process.exit(code));
  return {
    name: 'launcher-idle-shutdown',
    configureServer(server) {
      if (!enabled) return;
      const clients = new Set<WebSocket>();
      let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
      const cancel = () => { clearTimeout(timer); timer = undefined; };
      const cleanup = () => { stopped = true; cancel(); server.ws.off('connection', connect); };
      const arm = () => {
        cancel();
        if (stopped || clients.size) return;
        timer = setTimeout(() => {
          if (stopped || clients.size) return;
          cleanup();
          server.config.logger.info('No browser or OBS connections for five minutes. Stopping the background server.');
          void server.close().then(() => exit(0), error => { server.config.logger.error(String(error)); exit(1); });
        }, timeoutMs);
        timer.unref();
      };
      const connect = (socket: WebSocket) => {
        if (stopped) return;
        clients.add(socket); cancel();
        socket.once('close', () => { clients.delete(socket); if (!clients.size) arm(); });
      };
      for (const client of server.ws.clients) connect(client.socket);
      server.ws.on('connection', connect);
      server.httpServer?.once('close', cleanup);
      server.middlewares.use((request, response, next) => {
        // Loading a page or reconnecting during the grace period restarts the full five minutes.
        arm();
        if (request.url?.split('?')[0] !== IDLE_SHUTDOWN_PATH || request.method !== 'GET') { next(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ timeoutMs }));
      });
      arm();
    },
  };
}

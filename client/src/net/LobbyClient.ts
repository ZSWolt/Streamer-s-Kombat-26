type Handler = (m: any) => void;

const SERVER_KEY = 'sk_server';

/** Address of the host's lobby server: ?server=… in the link, or one the player pasted earlier in this tab. */
export function serverOverride(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  try { return sessionStorage.getItem(SERVER_KEY) ?? ''; } catch { return ''; }
}

/** Accepts a full invite link or a bare server address. Returns false when it is neither. */
export function setServerFromInvite(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  let server = t;
  try {
    const u = new URL(t);
    server = u.searchParams.get('server') ?? u.origin;
  } catch { return false; }
  try { sessionStorage.setItem(SERVER_KEY, server); } catch { /* private mode */ }
  return true;
}

export function serverWsUrl(): string {
  const override = serverOverride();
  if (override) return override.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws';
  // dev server (vite) runs on 5173; the game server on 7777
  if (location.port === '5173') return `ws://${location.hostname}:7777/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class LobbyClient {
  ws: WebSocket | null = null;
  id = '';
  host = false;
  invite = '';
  private handlers = new Map<string, Set<Handler>>();
  connected = false;
  rtt = 0;
  private pingT: number | null = null;

  connect(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverWsUrl());
      this.ws = ws;
      const to = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 6000);
      const hk = new URLSearchParams(location.search).get('hk') ?? undefined;
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name, hk })); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') {
          clearTimeout(to);
          this.id = m.id; this.host = m.host; this.invite = m.invite; this.connected = true;
          this.pingT = window.setInterval(() => this.send({ t: 'ping', ct: performance.now() }), 2000);
          resolve();
        }
        if (m.t === 'pong') this.rtt = performance.now() - m.ct;
        if (m.t === 'lobby' && m.invite) this.invite = m.invite;
        this.handlers.get(m.t)?.forEach((h) => h(m));
        this.handlers.get('*')?.forEach((h) => h(m));
      };
      ws.onclose = () => {
        this.connected = false;
        if (this.pingT) clearInterval(this.pingT);
        this.handlers.get('close')?.forEach((h) => h({}));
      };
      ws.onerror = () => { clearTimeout(to); reject(new Error('ws error')); };
    });
  }

  on(t: string, h: Handler): () => void {
    let s = this.handlers.get(t);
    if (!s) { s = new Set(); this.handlers.set(t, s); }
    s.add(h);
    return () => s!.delete(h);
  }

  send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

export const lobby = new LobbyClient();

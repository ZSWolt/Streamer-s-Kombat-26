// STREAM KOMBAT 26 — host server.
// Serves the built game, runs the lobby (WebSocket), relays WebRTC signaling / fallback inputs,
// and (if tools/bin/cloudflared(.exe) exists) opens a free public link friends can join from anywhere.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 7777);
const NO_TUNNEL = process.argv.includes('--no-tunnel');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/info') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ invite: publicUrl, players: clients.size }));
    return;
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 500; res.end('Game not built. Run: npm run build'); return; }
  res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('cache-control', 'public, max-age=3600');
  fs.createReadStream(file).pipe(res);
});

// ------------------------------------------------------------------ lobby state
interface Client { id: string; name: string; ws: WebSocket; room: string | null; status: 'idle' | 'room' | 'playing' | 'spectating'; isHost: boolean }
interface Room {
  id: string; name: string; players: (string | null)[]; spectators: string[];
  state: 'waiting' | 'select' | 'playing'; picks: ({ char: number; skin: number; locked: boolean } | null)[]; stage: number;
  seed: number; rounds: number; time: number;
}
const clients = new Map<string, Client>();
const rooms = new Map<string, Room>();
let publicUrl = '';
let nextId = 1;
const newId = (p: string) => p + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);

function send(c: Client | undefined, msg: unknown) {
  if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}
function broadcast(msg: unknown) { for (const c of clients.values()) send(c, msg); }
function roomBroadcast(r: Room, msg: unknown, except?: string) {
  for (const id of [...r.players, ...r.spectators]) if (id && id !== except) send(clients.get(id), msg);
}
function lobbySnapshot() {
  return {
    t: 'lobby',
    players: [...clients.values()].map((c) => ({ id: c.id, name: c.name, status: c.status, room: c.room, host: c.isHost })),
    rooms: [...rooms.values()].map((r) => ({ id: r.id, name: r.name, players: r.players.map((p) => (p ? clients.get(p)?.name ?? '?' : null)), spectators: r.spectators.length, state: r.state })),
    invite: publicUrl,
  };
}
function pushLobby() { broadcast(lobbySnapshot()); }
function roomState(r: Room) {
  return { t: 'room', room: { id: r.id, name: r.name, players: r.players.map((p) => (p ? { id: p, name: clients.get(p)?.name ?? '?' } : null)), spectators: r.spectators.map((s) => clients.get(s)?.name ?? '?'), state: r.state, picks: r.picks, stage: r.stage } };
}
function sys(text: string) { broadcast({ t: 'chat', from: '', text, sys: true }); }

function leaveRoom(c: Client) {
  if (!c.room) return;
  const r = rooms.get(c.room);
  c.room = null;
  c.status = 'idle';
  if (!r) return;
  const i = r.players.indexOf(c.id);
  if (i >= 0) {
    r.players[i] = null;
    r.picks[i] = null;
    if (r.state !== 'waiting') { r.state = 'waiting'; roomBroadcast(r, { t: 'abort', reason: `${c.name} עזב` }); }
  }
  r.spectators = r.spectators.filter((s) => s !== c.id);
  if (!r.players.some((p) => p)) {
    for (const s of r.spectators) { const sc = clients.get(s); if (sc) { sc.room = null; sc.status = 'idle'; send(sc, { t: 'left' }); } }
    rooms.delete(r.id);
  } else roomBroadcast(r, roomState(r));
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['cf-connecting-ip'];
  const c: Client = { id: newId('p'), name: 'אורח', ws, room: null, status: 'idle', isHost: local };
  clients.set(c.id, c);
  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    switch (m.t) {
      case 'hello': {
        const first = c.name === 'אורח';
        c.name = String(m.name ?? 'אורח').slice(0, 20) || 'אורח';
        send(c, { t: 'welcome', id: c.id, invite: publicUrl, host: c.isHost });
        if (first) sys(`${c.name} נכנס ללובי`);
        pushLobby();
        break;
      }
      case 'ping': send(c, { t: 'pong', ct: m.ct, st: Date.now() }); break;
      case 'chat': {
        const text = String(m.text ?? '').slice(0, 200);
        if (text) broadcast({ t: 'chat', from: c.name, text });
        break;
      }
      case 'createRoom': {
        leaveRoom(c);
        const r: Room = { id: newId('r'), name: String(m.name ?? `החדר של ${c.name}`).slice(0, 30), players: [c.id, null], spectators: [], state: 'waiting', picks: [null, null], stage: 0, seed: 0, rounds: Number(m.rounds ?? 2), time: Number(m.time ?? 99) };
        rooms.set(r.id, r);
        c.room = r.id; c.status = 'room';
        send(c, roomState(r));
        pushLobby();
        break;
      }
      case 'joinRoom': {
        const r = rooms.get(m.id);
        if (!r) { send(c, { t: 'error', msg: 'החדר לא קיים' }); break; }
        const slot = r.players.indexOf(null);
        if (slot < 0 || m.spectate) {
          leaveRoom(c);
          r.spectators.push(c.id);
          c.room = r.id; c.status = 'spectating';
          send(c, roomState(r));
          if (r.state === 'playing') send(c, { t: 'spectateStart', seed: r.seed, picks: r.picks, stage: r.stage, rounds: r.rounds, time: r.time });
        } else {
          leaveRoom(c);
          r.players[slot] = c.id;
          c.room = r.id; c.status = 'room';
          r.state = r.players.every((p) => p) ? 'select' : 'waiting';
          r.picks = [null, null];
          roomBroadcast(r, roomState(r));
          if (r.state === 'select') roomBroadcast(r, { t: 'select' });
        }
        pushLobby();
        break;
      }
      case 'leaveRoom': leaveRoom(c); send(c, { t: 'left' }); pushLobby(); break;
      case 'pick': {
        const r = c.room ? rooms.get(c.room) : null;
        if (!r) break;
        const i = r.players.indexOf(c.id);
        if (i < 0) break;
        r.picks[i] = { char: m.char | 0, skin: m.skin | 0, locked: !!m.locked };
        if (i === 0 && typeof m.stage === 'number') r.stage = m.stage;
        roomBroadcast(r, { t: 'pick', side: i, pick: r.picks[i], stage: r.stage }, c.id);
        if (r.picks.every((p) => p?.locked) && r.state === 'select') {
          r.state = 'playing';
          r.seed = (Math.random() * 1e9) | 0;
          for (const id of r.players) { const pc = clients.get(id!); if (pc) pc.status = 'playing'; }
          roomBroadcast(r, { t: 'start', seed: r.seed, picks: r.picks, stage: r.stage, rounds: r.rounds, time: r.time, ids: r.players });
          pushLobby();
        }
        break;
      }
      case 'signal': send(clients.get(m.to), { t: 'signal', from: c.id, data: m.data }); break;
      case 'relay': {
        // fallback transport when WebRTC can't connect: forward input packets to the other player
        const r = c.room ? rooms.get(c.room) : null;
        if (!r) break;
        const other = r.players.find((p) => p && p !== c.id);
        send(clients.get(other!), { t: 'relay', data: m.data });
        break;
      }
      case 'spec': {
        // confirmed inputs for spectators
        const r = c.room ? rooms.get(c.room) : null;
        if (!r) break;
        const side = r.players.indexOf(c.id);
        for (const s of r.spectators) send(clients.get(s), { t: 'spec', side, from: m.from, inputs: m.inputs });
        break;
      }
      case 'matchEnd': {
        const r = c.room ? rooms.get(c.room) : null;
        if (!r || r.state !== 'playing') break;
        r.state = 'select';
        r.picks = [null, null];
        for (const id of r.players) { const pc = clients.get(id!); if (pc) pc.status = 'room'; }
        const w = r.players[m.winner];
        if (w) sys(`🏆 ${clients.get(w)?.name} ניצח ב"${r.name}"`);
        roomBroadcast(r, roomState(r));
        pushLobby();
        break;
      }
      case 'rematch': {
        const r = c.room ? rooms.get(c.room) : null;
        if (r && r.players.every((p) => p)) { r.state = 'select'; r.picks = [null, null]; roomBroadcast(r, { t: 'select' }); }
        break;
      }
    }
  });
  ws.on('close', () => {
    leaveRoom(c);
    clients.delete(c.id);
    sys(`${c.name} יצא`);
    pushLobby();
  });
});

// keep-alive (cloudflare closes idle sockets)
setInterval(() => { for (const c of clients.values()) if (c.ws.readyState === WebSocket.OPEN) c.ws.ping(); }, 20000);

// ------------------------------------------------------------------ tunnel
function findCloudflared(): string | null {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(ROOT, 'tools', 'bin', exe);
  if (fs.existsSync(local)) return local;
  return null;
}

function startTunnel() {
  const bin = findCloudflared();
  if (!bin || NO_TUNNEL) {
    console.log('  (בלי מנהרה ציבורית — cloudflared לא נמצא ב-tools/bin. חברים ברשת המקומית יכולים להיכנס בכתובת ה-LAN)');
    return;
  }
  const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d: Buffer) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !publicUrl) {
      publicUrl = m[0];
      console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
      console.log('  ║  קישור לחברים (הועתק ללוח):                                  ║');
      console.log(`  ║  ${publicUrl.padEnd(60)}║`);
      console.log('  ╚══════════════════════════════════════════════════════════════╝\n');
      if (process.platform === 'win32') exec(`echo ${publicUrl}| clip`);
      pushLobby();
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('exit', (code) => { console.log('cloudflared exited', code); publicUrl = ''; pushLobby(); });
  process.on('exit', () => p.kill());
  process.on('SIGINT', () => { p.kill(); process.exit(0); });
}

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log('\n  STREAM KOMBAT 26 — השרת פועל');
  console.log(`  במחשב שלך:  http://localhost:${PORT}`);
  if (lan) console.log(`  ברשת הביתית: http://${lan}:${PORT}`);
  startTunnel();
  if (!process.argv.includes('--no-open') && process.platform === 'win32') exec(`start "" http://localhost:${PORT}`);
});

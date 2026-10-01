// Exercise the lobby server's private-room logic over real WebSockets.
import { WebSocket } from 'ws';
const URL = 'ws://localhost:7777/ws';
function client(name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const c = { ws, msgs: [], name, wait: (t, ms = 1500) => new Promise((ok, no) => {
      const hit = c.msgs.findIndex((m) => m.t === t);
      if (hit >= 0) return ok(c.msgs.splice(hit, 1)[0]);
      const to = setTimeout(() => no(new Error(name + ' timeout waiting for ' + t)), ms);
      c.on = (m) => { if (m.t === t) { clearTimeout(to); c.on = null; c.msgs.splice(c.msgs.indexOf(m), 1); ok(m); } };
    }), send: (m) => ws.send(JSON.stringify(m)), on: null };
    ws.on('open', () => { c.send({ t: 'hello', name }); });
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.msgs.push(m); c.on?.(m); if (m.t === 'welcome') res(c); });
    ws.on('error', rej);
  });
}
const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
const a = await client('Alice'), b = await client('Bob'), s = await client('Spy');
a.send({ t: 'createRoom', name: 'סודי', password: 'tekken26', hidden: true, rounds: 2, time: 99 });
const room = (await a.wait('room')).room;
ok(/^[A-Z2-9]{4}$/.test(room.code) && room.locked && room.hidden, `room created with code ${room.code}, locked+hidden`);
ok(!('password' in room), 'password is not echoed to the client');
await new Promise((r) => setTimeout(r, 200));
b.msgs.length = 0; s.msgs.length = 0;
b.send({ t: 'chat', text: 'ping' });
const lb = await b.wait('lobby', 800).catch(() => null);
b.send({ t: 'hello', name: 'Bob' });
const lobbyB = await b.wait('lobby');
ok(!lobbyB.rooms.some((r) => r.id === room.id), 'hidden room is not in another player\'s room list');
ok(lobbyB.players.find((p) => p.name === 'Alice')?.room === null, 'hidden room id is not leaked through the player list');
b.send({ t: 'joinRoom', code: room.code.toLowerCase() });
const need = await b.wait('needPassword');
ok(need.id === room.id && !need.wrong, 'joining by code without a password asks for it');
b.send({ t: 'joinRoom', id: room.id, password: 'nope' });
ok((await b.wait('needPassword')).wrong === true, 'wrong password is rejected');
s.send({ t: 'joinRoom', id: room.id, spectate: true });
ok((await s.wait('needPassword')).spectate === true, 'spectating a locked room also needs the password');
b.send({ t: 'joinRoom', code: room.code, password: 'tekken26' });
const joined = (await b.wait('room')).room;
ok(joined.players.filter(Boolean).length === 2, 'correct password lets the second player in');
ok((await a.wait('select')).t === 'select', 'both players go to character select');
for (let i = 0; i < 5; i++) { s.send({ t: 'joinRoom', id: room.id, password: 'x' + i }); await s.wait('needPassword'); }
s.send({ t: 'joinRoom', id: room.id, password: 'tekken26' });
const blocked = await s.wait('error');
ok(/ניסיונות/.test(blocked.msg), 'five wrong tries lock that client out for a minute');
s.send({ t: 'joinRoom', code: 'ZZZZ' });
ok(/קוד/.test((await s.wait('error')).msg), 'unknown code gives a clear error');
// public room without password still works as before
s.send({ t: 'createRoom', rounds: 2, time: 99 });
const pub = (await s.wait('room')).room;
ok(!pub.locked && !pub.hidden, 'default room is public and open');
for (const c of [a, b, s]) c.ws.close();

import { describe, expect, it } from 'vitest';
import { Hub, newRoomCode, parseRoomCode } from '../client/src/net/Hub';

function setup(n: number) {
  const hub = new Hub('ABCDE', () => 0, () => 0.5);
  const inbox: any[][] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    inbox.push([]);
    const box = inbox[i];
    ids.push(hub.join({ send: (m) => box.push(JSON.parse(JSON.stringify(m))) }, 'pid' + i, i === 0));
    hub.handle(ids[i], { t: 'hello', name: 'P' + i });
  }
  const last = (i: number, t: string) => [...inbox[i]].reverse().find((m) => m.t === t);
  const all = (i: number, t: string) => inbox[i].filter((m) => m.t === t);
  return { hub, ids, inbox, last, all };
}

describe('room hub', () => {
  it('seats the first two, later arrivals watch', () => {
    const { hub, last } = setup(4);
    expect(hub.view().members.map((m) => m.seat)).toEqual([0, 1, -1, -1]);
    expect(last(3, 'welcome')).toMatchObject({ host: false, code: 'ABCDE' });
    expect(last(0, 'welcome')).toMatchObject({ host: true });
    expect(last(3, 'room').room.members).toHaveLength(4);
  });

  it('only the host starts, and only with two fighters', () => {
    const { hub, ids, last } = setup(2);
    hub.handle(ids[1], { t: 'start' });
    expect(hub.state).toBe('waiting');
    hub.handle(ids[1], { t: 'seat', seat: -1 });
    hub.handle(ids[0], { t: 'start' });
    expect(hub.state).toBe('waiting');
    expect(last(0, 'error')).toBeTruthy();
    hub.handle(ids[1], { t: 'seat', seat: 1 });
    hub.handle(ids[0], { t: 'start' });
    expect(hub.state).toBe('select');
    expect(last(1, 'select').ids).toEqual([ids[0], ids[1]]);
  });

  it('starts the match when both lock in; spectators get the match and its inputs', () => {
    const { hub, ids, last, all } = setup(3);
    hub.handle(ids[0], { t: 'start' });
    hub.handle(ids[0], { t: 'pick', char: 3, skin: 0, locked: true, stage: 4 });
    expect(last(1, 'pick')).toMatchObject({ side: 0, stage: 4 });
    hub.handle(ids[1], { t: 'pick', char: 5, skin: 0, locked: true });
    expect(hub.state).toBe('playing');
    const start = last(0, 'start');
    expect(start).toMatchObject({ stage: 4, ids: [ids[0], ids[1]], pids: ['pid0', 'pid1'] });
    expect(start.picks.map((p: any) => p.char)).toEqual([3, 5]);
    expect(last(2, 'start')).toBeUndefined();
    expect(last(2, 'spectateStart')).toMatchObject({ seed: start.seed, stage: 4 });
    hub.handle(ids[0], { t: 'spec', from: 1, inputs: [1, 2, 3] });
    hub.handle(ids[1], { t: 'spec', from: 1, inputs: [4, 5, 6] });
    hub.handle(ids[0], { t: 'spec', from: 9, inputs: [7] }); // a gap: refused
    expect(all(2, 'spec')).toHaveLength(2);
    expect(all(1, 'spec')).toHaveLength(0);
    // someone who walks in mid-match is caught up from frame 1
    const late: any[] = [];
    const id = hub.join({ send: (m) => late.push(m) }, 'pidL');
    hub.handle(id, { t: 'hello', name: 'Late' });
    expect(late.find((m) => m.t === 'spectateStart')).toBeTruthy();
    expect(late.filter((m) => m.t === 'spec').map((m) => m.inputs)).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('relays game packets between the two fighters only', () => {
    const { hub, ids, last } = setup(3);
    hub.handle(ids[0], { t: 'relay', data: { k: 'in' } });
    expect(last(1, 'relay')).toEqual({ t: 'relay', data: { k: 'in' } });
    hub.handle(ids[2], { t: 'relay', data: { k: 'x' } });
    expect(last(0, 'relay')).toBeUndefined();
  });

  it('winner stays: the longest-waiting spectator takes the loser\'s seat', () => {
    const { hub, ids, last } = setup(4);
    const play = () => {
      hub.handle(ids[0], { t: 'start' });
      for (const m of hub.view().members) if (m.seat >= 0) hub.handle(m.id, { t: 'pick', char: 1, skin: 0, locked: true });
    };
    play();
    hub.handle(ids[0], { t: 'matchEnd', winner: 0 });
    hub.handle(ids[1], { t: 'matchEnd', winner: 0 }); // both players report: counted once
    expect(hub.state).toBe('waiting');
    expect(last(3, 'matchOver')).toEqual({ t: 'matchOver', winner: 0 });
    expect(hub.view().members.map((m) => m.seat)).toEqual([0, -1, 1, -1]);
    play();
    hub.handle(ids[2], { t: 'matchEnd', winner: 1 }); // P2 (seat 1) beats the host
    expect(hub.view().members.map((m) => m.seat)).toEqual([-1, -1, 1, 0]);
    hub.handle(ids[0], { t: 'opts', rotate: false });
    play();
    hub.handle(ids[2], { t: 'matchEnd', winner: 1 });
    expect(hub.view().members.map((m) => m.seat)).toEqual([-1, -1, 1, 0]);
  });

  it('a fighter leaving calls the match off; silent members are swept', () => {
    let t = 0;
    const hub = new Hub('ABCDE', () => t);
    const a: any[] = [], b: any[] = [];
    const ia = hub.join({ send: (m) => a.push(m) }, 'pa', true);
    const ib = hub.join({ send: (m) => b.push(m) }, 'pb');
    hub.handle(ia, { t: 'hello', name: 'A' });
    hub.handle(ib, { t: 'hello', name: 'B' });
    hub.handle(ia, { t: 'start' });
    t = 20000;
    hub.sweep();
    expect(hub.size).toBe(1);
    expect(hub.state).toBe('waiting');
    expect(a.find((m) => m.t === 'abort')).toBeTruthy();
  });

  it('room codes', () => {
    expect(newRoomCode()).toMatch(/^[A-Z2-9]{5}$/);
    expect(parseRoomCode(' k7qf2 ')).toBe('K7QF2');
    expect(parseRoomCode('https://streamerskombatil.online/?r=K7QF2')).toBe('K7QF2');
    expect(parseRoomCode('https://example.com/')).toBe('');
  });
});

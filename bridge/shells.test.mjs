import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { shareOut, worker } from './shells.mjs';

const OPTS = { prompt: /[#>$] ?$/, timeout: 300, settle: 30 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A shell like the box's: it echoes a command, prints its output after `delay` ms, then its prompt. */
function fakeShell({ delay = 20, outputs = {} } = {}) {
  const ch = new EventEmitter();
  ch.typed = [];
  ch.write = (d) => {
    if (d === '\x03') return void setTimeout(() => ch.emit('data', '^C\r\nadmin@BOX> '), 5);
    const cmd = d.trim();
    ch.typed.push(cmd);
    ch.emit('data', `${cmd}\r\n`);
    const out = outputs[cmd] ?? [`out of ${cmd}\r\nadmin@BOX> `];
    out.forEach((chunk, i) => chunk !== null && setTimeout(() => ch.emit('data', chunk), delay * (i + 1)));
  };
  ch.close = () => ch.emit('close');
  setTimeout(() => ch.emit('data', 'admin@BOX> '), 1);
  return ch;
}

describe('worker', () => {
  it("reads a command's output between its echo and the prompt", async () => {
    const w = worker(fakeShell(), OPTS);
    expect(await w.prompt(300)).toBe(true);
    expect(await w.output('show card')).toEqual({ raw: 'out of show card', ok: true });
  });

  it('waits for the prompt to stay quiet, so a line ending like one does not cut the output short', async () => {
    const w = worker(fakeShell({ delay: 10, outputs: { 'show assignment': ['eth 1-7-4 ->', '\r\nflexgo-1-7-5\r\nadmin@BOX> '] } }), OPTS);
    await w.prompt(300);
    expect(await w.output('show assignment')).toEqual({ raw: 'eth 1-7-4 ->\nflexgo-1-7-5', ok: true });
  });

  it('sends Ctrl-C to a command whose prompt never comes, and the next one still runs', async () => {
    const ch = fakeShell({ outputs: { hang: [null] } });
    const w = worker(ch, { ...OPTS, timeout: 80 });
    await w.prompt(300);
    expect(await w.output('hang')).toEqual({ raw: '', ok: false });
    expect(await w.output('show card')).toEqual({ raw: 'out of show card', ok: true });
  });
});

describe('shareOut', () => {
  const items = Array.from({ length: 12 }, (_, i) => `show ${i}`);
  const run = async (ws, ready) => {
    await Promise.all(ws.map((w) => w.prompt(300)));
    let now = 0;
    let most = 0;
    const done = [];
    const took = await shareOut(ws, ready, items, async (cmd, w) => {
      most = Math.max(most, ++now);
      done.push((await w.output(cmd)).raw);
      now--;
    });
    return { took, most, done };
  };

  it('runs every command once, on all the shells at once', async () => {
    const ws = Array.from({ length: 4 }, () => worker(fakeShell(), OPTS));
    const { took, most, done } = await run(ws, ws.map(() => Promise.resolve()));
    expect(done.sort()).toEqual(items.map((c) => `out of ${c}`).sort());
    expect([took.size, most]).toEqual([4, 4]);
    expect(ws.map((w) => w.ch.typed.length)).toEqual([3, 3, 3, 3]);
  });

  it('starts on the first shell; one that comes up late joins, one dropped never does', async () => {
    const ws = Array.from({ length: 3 }, () => worker(fakeShell(), OPTS));
    ws[2].open = false;
    const { took, done } = await run(ws, [Promise.resolve(), sleep(120), Promise.resolve()]);
    expect(done).toHaveLength(12);
    expect(took.has(ws[0]) && took.has(ws[1]) && !took.has(ws[2])).toBe(true);
    expect(ws[0].ch.typed.length).toBeGreaterThan(ws[1].ch.typed.length);
  });

  it('with one shell, runs them in order as before', async () => {
    const ws = [worker(fakeShell(), OPTS)];
    const { took, done } = await run(ws, [Promise.resolve()]);
    expect(took.size).toBe(1);
    expect(done).toEqual(items.map((c) => `out of ${c}`));
  });
});

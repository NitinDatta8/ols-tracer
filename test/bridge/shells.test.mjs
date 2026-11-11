import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { shareOut, worker } from '../../bridge/shells.mjs';

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

describe('worker, on a shell that misbehaves', () => {
  it('reads output through colors and stray carriage returns', async () => {
    const w = worker(fakeShell({ outputs: { 'show card': ['\x1b[1mcard 1-7\x1b[0m\r\r\nup\r\nadmin@BOX> '] } }), OPTS);
    await w.prompt(300);
    expect(await w.output('show card')).toEqual({ raw: 'card 1-7\nup', ok: true });
  });

  it('gives up at once on a shell that closes mid-command, and on one already closed', async () => {
    const ch = fakeShell({ outputs: { hang: ['half of it\r\n', null] } });
    const w = worker(ch, { ...OPTS, timeout: 5000 });
    await w.prompt(300);
    const t = Date.now();
    const out = w.output('hang');
    setTimeout(() => ch.close(), 60);
    expect(await out).toEqual({ raw: 'half of it\n', ok: false });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(w.open).toBe(false);
    expect(await w.prompt(5000)).toBe(false);
  });

  it('says no prompt came after the time it is given', async () => {
    const quiet = new EventEmitter();
    quiet.write = () => {};
    const t = Date.now();
    expect(await worker(quiet, OPTS).prompt(80)).toBe(false);
    expect(Date.now() - t).toBeGreaterThanOrEqual(75);
  });

  it('gives up on a command whose Ctrl-C brings no prompt back either, after a second timeout', async () => {
    const ch = fakeShell({ outputs: { hang: [null] } });
    const write = ch.write;
    ch.write = (d) => (d === '\x03' ? undefined : write(d)); // the box ignores Ctrl-C
    const w = worker(ch, { ...OPTS, timeout: 60 });
    await w.prompt(300);
    const t = Date.now();
    expect(await w.output('hang')).toEqual({ raw: '', ok: false });
    expect(Date.now() - t).toBeGreaterThanOrEqual(110);
  });
});

describe('shareOut, when things go wrong', () => {
  const shells = (k) => Array.from({ length: k }, () => worker(fakeShell({ delay: 5 }), OPTS));

  it('has nothing to hand out with no commands', async () => {
    const ws = shells(2);
    expect((await shareOut(ws, ws.map(() => Promise.resolve()), [], async () => {})).size).toBe(0);
  });

  it('hands nothing out once go() says stop, finishing what it already handed out', async () => {
    const ws = shells(3);
    await Promise.all(ws.map((w) => w.prompt(300)));
    const done = [];
    let go = true;
    await shareOut(ws, ws.map(() => Promise.resolve()), Array.from({ length: 30 }, (_, i) => i), async (i, w) => {
      if (done.length === 4) go = false;
      await w.output(`show ${i}`);
      done.push(i);
    }, () => go);
    expect(done.length).toBeGreaterThanOrEqual(5);
    expect(done.length).toBeLessThanOrEqual(5 + ws.length);
    expect(new Set(done).size).toBe(done.length);
  });

  it("hands a closed shell's share to the others, each command once, the one it had cut short", async () => {
    const ws = shells(3);
    await Promise.all(ws.map((w) => w.prompt(300)));
    const got = new Map();
    const items = Array.from({ length: 24 }, (_, i) => `show ${i}`);
    setTimeout(() => ws[1].ch.close(), 120);
    await shareOut(ws, ws.map(() => Promise.resolve()), items, async (cmd, w) => { got.set(cmd, (got.get(cmd) ?? []).concat([(await w.output(cmd)).ok])); });
    expect([...got.keys()].sort()).toEqual([...items].sort());
    expect([...got.values()].every((oks) => oks.length === 1)).toBe(true);
    expect([...got.values()].filter(([ok]) => !ok).length).toBeLessThanOrEqual(1);
    expect(ws[1].open).toBe(false);
  });

  it('fails with the first command that fails, so the poller can say why', async () => {
    const ws = shells(2);
    await expect(shareOut(ws, ws.map(() => Promise.resolve()), [1, 2, 3], async (i) => { if (i === 2) throw new Error('disk full'); })).rejects.toThrow('disk full');
  });
});

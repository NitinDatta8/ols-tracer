// Terminals on a box: the physical views' on its session's shell (/term), and terminal windows on shells of their own
// (/shell), by many people at once. ssh2 is the fake in test/fakes/ssh2.mjs, so no session here leaves this process
// (test/fakes/lab.mjs).
import { describe, expect, it, vi } from 'vitest';
import { connect, disconnect, fake, folder, host, hostname, index, port, prompt, sleep, socket, status, until, whole } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('terminals', () => {
  it("six physical views on one session's terminal: each gets what came before, all see what one types, and a show typed there runs again once", async () => {
    const box = fake(1);
    await connect(host(1), 'view:a');
    const { run } = await whole(folder(1));
    const views = Array.from({ length: 6 }, () => socket(`/term?host=${host(1)}`));
    await Promise.all(views.map((v) => v.opened));
    await until(() => views.every((v) => v.got.includes(`Welcome to ${hostname(1)}`)), 2000, 'the log so far');
    views[2].send(JSON.stringify({ cols: 100, rows: 40 }));
    views[0].send(JSON.stringify({ d: 'sh' }));
    views[0].send(JSON.stringify({ d: 'ow card\r' }));
    await until(() => views.every((v) => v.got.endsWith(`show card\r\nNone\r\n${prompt(1)}`)), 3000, 'everyone to see it');
    await until(() => index(folder(1), run).some((l) => l.source === 'typed'), 3000, 'the typed show to run again');
    expect(index(folder(1), run).filter((l) => l.source === 'typed').map((l) => l.cmd)).toEqual(['show card']);
    expect(box.count('show card')).toBe(3); // the snapshot's, the terminal's, and it run again on the poller's shell
    expect([...box.shells].find((s) => s.term === 'xterm-256color').size).toEqual({ rows: 40, cols: 100 });
    views.slice(1).forEach((v) => v.close());
    await sleep(100);
    expect((await status(host(1))).holders).toBe(1); // a view's terminal is not a holder
    // Once the session closes, its terminals close too.
    const closed = new Promise((ok) => views[0].once('close', ok));
    await disconnect(host(1), 'view:a');
    await closed;
  }, 40000);

  it('refuses a terminal from another page, on a box with no session, or with more than its host', async () => {
    fake(1);
    await connect(host(1), 'view:a');
    await until(async () => (await status(host(1))).state === 'connected', 3000);
    for (const [path, origin] of [
      [`/term?host=${host(1)}`, 'http://evil.example'],
      [`/term?host=${host(1)}`, `http://localhost:${port}`],
      [`/term?host=${host(2)}`, undefined],
      [`/term?host=${host(1)}&steps=x`, undefined],
      [`/elsewhere?host=${host(1)}`, undefined],
    ]) await expect(socket(path, origin).opened, `${origin} ${path}`).rejects.toThrow();
  }, 15000);

  it('terminal windows: one SSH login per box for all its windows, a shell each, the steps typed first, closed with the last', async () => {
    const [one, two] = [fake(1), fake(2)];
    const window = (h, steps = []) => socket(`/shell?host=${h}&steps=${encodeURIComponent(JSON.stringify(steps))}`);
    const wins = [window(host(1)), window(host(1)), window(host(1)), window(host(2), ['configure'])];
    await Promise.all(wins.map((w) => w.opened));
    await until(() => one.shells.size === 3 && two.count('configure') === 1, 5000, 'the windows to open, and box 2 to configure');
    expect([one.logins, one.connections.size, two.logins, two.connections.size]).toEqual([1, 1, 1, 1]);
    await until(() => wins[3].got.includes(prompt(2, '#')), 3000);
    wins[0].send(JSON.stringify({ d: 'show port\r' }));
    await until(() => wins[0].got.includes('show port\r\nNone'), 2000);
    expect(wins[1].got).not.toContain('show port'); // a window's shell is its own
    wins.slice(0, 2).forEach((w) => w.close());
    await until(() => one.shells.size === 1, 2000);
    expect(one.connections.size).toBe(1);
    wins.slice(2).forEach((w) => w.close());
    await until(() => !one.connections.size && !two.connections.size, 2000, 'the last window to take its login with it');
    // Steps that could slip in a second command never log in; nor does a box that isn't there.
    const bad = window(host(1), ['show card\nreboot ne cold']);
    await until(() => bad.got.includes('[a terminal needs a box IP and its steps, one line each]'), 2000);
    const nobody = window(host(9));
    await until(() => nobody.got.includes(`[could not log in to ${host(9)}: getaddrinfo ENOTFOUND ${host(9)}]`), 2000);
    expect(one.logins).toBe(1);
  }, 20000);
});

// A box that misbehaves while people hold its session: it refuses the login, drops the connection, never answers a
// command, or is slow to show its prompt; and a session closed before it took anything. ssh2 is the fake in
// test/fakes/ssh2.mjs, so no session here leaves this process (test/fakes/lab.mjs).
import { describe, expect, it, vi } from 'vitest';
import { allRuns, call, connect, disconnect, fake, folder, host, index, sleep, socket, status, TIMEOUT, until, whole, WORKERS } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('a box that misbehaves', () => {
  it('refusing the login: the session says why and tries again, until its holder leaves', async () => {
    const box = fake(1, { refuse: 'All configured authentication methods failed' });
    await connect(host(1), 'view:a');
    await until(async () => (await status(host(1))).error.includes('authentication'), 2000, 'the error');
    for (const [path, body] of [['/show', 'show card'], ['/pull', 'F01'], ['/baseline', '']]) {
      expect(await call('POST', `${path}?host=${host(1)}`, body), path).toMatchObject({ status: 409, body: expect.stringMatching(/^Connect to the box first/) });
    }
    await until(() => box.logins >= 2, 3000, 'a retry');
    expect((await status(host(1))).state).not.toBe('connected');
    await disconnect(host(1), 'view:a');
    const tries = box.logins;
    await sleep(2500);
    expect(box.logins).toBe(tries); // its retry was cancelled
  }, 15000);

  it('logging in keyboard-interactive, as RADIUS or TACACS+ does: it answers with BOX_PASSWORD', async () => {
    fake(1, { password: 'fake-pw' });
    fake(2, { password: 'another' });
    await connect(host(1), 'view:a');
    await connect(host(2), 'view:a');
    await until(async () => (await status(host(1))).state === 'connected', 3000, 'box 1 to connect');
    await until(async () => (await status(host(2))).error === 'All configured authentication methods failed', 3000, 'box 2 to refuse');
  }, 15000);

  it('dropping the connection: it is opened again with its holders and a new connect run, and the other box never notices', async () => {
    const [one, two] = [fake(1), fake(2)];
    await Promise.all([connect(host(1), 'view:a'), connect(host(1), 'codex:1'), connect(host(2), 'view:a')]);
    await Promise.all([whole(folder(1)), whole(folder(2))]);
    const views = [socket(`/term?host=${host(1)}`), socket(`/term?host=${host(1)}`)];
    await Promise.all(views.map((v) => v.opened));
    one.drop();
    await until(async () => (await status(host(1))).state !== 'connected', 2000, 'the drop to show');
    await until(() => views.every((v) => v.got.includes('[session closed: read ECONNRESET: opening it again]')), 2000, 'the views to hear');
    await whole(folder(1), 'connect', 2);
    expect(await status(host(1), 'codex:1')).toMatchObject({ state: 'connected', holders: 2, held: true });
    expect([one.logins, two.logins, two.connections.size]).toEqual([2, 1, 1]);
    views.forEach((v) => v.close());
  }, 40000);

  it('never answering a command: it gets a Ctrl-C after BOX_TIMEOUT, and the snapshot goes on', async () => {
    const box = fake(1, { hang: ['show inventory'] });
    await connect(host(1), 'view:a');
    const { run, snapshot } = await whole(folder(1));
    expect(snapshot).toMatchObject({ done: 57, of: 57 });
    expect(index(folder(1), run).filter((l) => !l.ok).map((l) => l.cmd)).toEqual(['show inventory']);
    expect(box.interrupts).toBe(1);
    const { body } = await call('GET', `/state?host=${host(1)}`);
    expect(body.live).toBe(true);
    expect(body.commands['show inventory']).toMatchObject({ error: `no prompt within ${TIMEOUT / 1000} s` });
    expect(body.commands['show card']).toMatchObject({ raw: 'None' });
  }, 40000);

  it('slow to show its prompt after login, as within BOX_TIMEOUT: every poller shell is still used', async () => {
    const box = fake(1, { welcome: TIMEOUT / 2 });
    await connect(host(1), 'view:a');
    const { snapshot } = await whole(folder(1));
    expect(snapshot).toMatchObject({ done: 57, of: 57, workers: WORKERS });
    expect(box.count('configure')).toBe(WORKERS);
  }, 40000);

  it('closed before its first snapshot: no run is left behind', async () => {
    const box = fake(1);
    const before = allRuns();
    await connect(host(1), 'view:a');
    await until(() => box.shells.size === 1 + WORKERS, 2000, 'the shells to open');
    await disconnect(host(1), 'view:a');
    await sleep(2500); // past the login's quiet time
    expect(allRuns()).toEqual(before);
    expect(box.count('show system')).toBe(0);
  }, 15000);
});

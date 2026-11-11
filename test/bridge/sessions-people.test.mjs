// Six people on one box at once (physical views and Codex sessions): one session, shared, as notes.md item 1 asks.
// ssh2 is the fake in test/fakes/ssh2.mjs, so no session here leaves this process (test/fakes/lab.mjs).
import { describe, expect, it, vi } from 'vitest';
import { call, connect, disconnect, fake, folder, host, hostname, index, q, runs, sessions, sleep, status, until, whole, WORKERS } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

const people = ['view:a', 'view:b', 'view:c', 'codex:1', 'codex:2', 'codex:3'];

describe('six people on one box', () => {
  it('share one session: one SSH login, one connect snapshot, and it closes with the last of them', async () => {
    const box = fake(1);
    expect(await call('POST', `/connect?host=${host(1)}`)).toEqual({ status: 400, body: 'by: who connects\n' });
    expect(box.logins).toBe(0);
    const joined = await Promise.all(people.map((by) => connect(host(1), by)));
    expect(joined.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(joined.map((r) => r.body.holders).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(joined[0].body).toMatchObject({ host: host(1), error: '', snapshot: null });
    const meta = await whole(folder(1));
    expect(meta).toMatchObject({ box: folder(1), host: host(1), hostname: hostname(1), release: 'CSP-2.10.100.10_20261013', snapshot: { done: 57, of: 57, workers: WORKERS } });
    expect(meta.prereqs.every((p) => p.ok)).toBe(true);
    expect([box.logins, box.connections.size, box.shells.size]).toEqual([1, 1, 1 + WORKERS]); // the terminal and the poller's
    expect([box.count('show card'), box.count('configure'), box.overlaps]).toEqual([1, WORKERS, 0]); // once a box, not a person
    expect(await sessions()).toEqual([{ state: 'connected', host: host(1), box: folder(1), error: '', snapshot: null, holders: 6 }]);
    for (const by of people) expect((await status(host(1), by)).held, by).toBe(true);
    expect((await status(host(1), 'codex:4')).held).toBe(false);
    expect((await runs(folder(1))).map((m) => m.trigger)).toEqual(['connect']);
    expect((await call('GET', `/state?host=${host(1)}`)).body).toMatchObject({ live: true, host: host(1), commands: { 'show card': { raw: 'None' } } });

    // Someone who doesn't hold it leaves nothing; each holder that leaves is one fewer; the last one closes it.
    expect((await disconnect(host(1), 'codex:4')).body).toEqual({ left: false, holders: 6 });
    for (const [i, by] of people.entries()) {
      expect((await disconnect(host(1), by)).body).toEqual({ left: true, holders: 5 - i });
      if (i < 5) expect(box.connections.size, `after ${by} left`).toBe(1);
    }
    await until(() => !box.connections.size && !box.shells.size, 2000, 'the session to close');
    expect(await sessions()).toEqual([]);
    expect((await disconnect(host(1), 'view:a')).body).toEqual({ left: false, holders: 0 }); // twice
    // Closed, the box's state is its last run on disk, and the next to connect opens a new session.
    expect(await call('GET', `/state?host=${host(1)}`)).toMatchObject({ status: 200, body: { live: false, run: meta.run, host: host(1) } });
    await connect(host(1), 'view:a');
    await until(() => box.logins === 2, 2000, 'a second login');
  }, 40000);

  it('hold it once each, however often each one connects', async () => {
    fake(1);
    for (let i = 0; i < 3; i++) expect((await connect(host(1), 'view:a')).body.holders).toBe(1);
    expect((await connect(host(1), 'codex:1')).body.holders).toBe(2);
    expect((await disconnect(host(1), 'view:a')).body).toEqual({ left: true, holders: 1 });
    expect((await disconnect(host(1), 'view:a')).body).toEqual({ left: false, holders: 1 });
  });

  it("each get their own show answered, one at a time on the poller's shell, saved in the run with who asked", async () => {
    const cmds = ['show card', 'show och 1-7-5', 'show port', 'show transceiver 1-7-4', 'show eth 1-7-4', 'show inventory'];
    const box = fake(1, { delay: 15, answers: Object.fromEntries(cmds.map((c) => [c, (cmd) => `${cmd} answered by ${hostname(1)}`])) });
    await Promise.all(people.map((by) => connect(host(1), by)));
    const { run } = await whole(folder(1));
    const got = await Promise.all(people.map((by, i) => call('POST', `/show?${q(host(1), by)}`, `  ${cmds[i].replace(' ', '   ')} `)));
    for (const [i, r] of got.entries()) {
      expect(r.status, people[i]).toBe(200);
      expect(r.body).toMatchObject({ host: host(1), cmd: cmds[i], ok: true, raw: `${cmds[i]} answered by ${hostname(1)}` });
    }
    expect(box.overlaps).toBe(0); // never two commands at once on a poller's shell
    const asked = index(folder(1), run).filter((l) => l.source === 'mcp');
    expect(asked.map(({ cmd, by }) => `${by} ${cmd}`).sort()).toEqual(people.map((by, i) => `${by} ${cmds[i]}`).sort());

    // A line that may not run, or from someone not named in one line, is refused before anything reaches the box.
    const typed = box.typed.length;
    for (const line of ['show alarm | save x', 'show och ?', 'set och 1-7-5 target-output-power 0', 'reboot ne cold', 'show card\nreboot ne cold', 'show card\x15reboot ne cold', 'show flux-capacitor', '']) {
      expect((await call('POST', `/show?${q(host(1), 'codex:1')}`, line)).status, JSON.stringify(line)).toBe(400);
    }
    for (const by of ['', 'x'.repeat(201), 'codex:é', 'codex:\n']) expect((await call('POST', `/show?${q(host(1), by)}`, 'show card')).status, JSON.stringify(by)).toBe(400);
    expect(box.typed.length).toBe(typed);
  }, 40000);

  it('are each answered when the session closes with their shows still waiting', async () => {
    const box = fake(1, { hang: ['show och 1-7-9'] });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const first = call('POST', `/show?${q(host(1), 'codex:1')}`, 'show och 1-7-9'); // hangs the poller's shell
    await until(() => box.count('show och 1-7-9') === 1, 3000, 'the first show to reach the box');
    const waiting = people.slice(1).map((by) => call('POST', `/show?${q(host(1), by)}`, 'show card'));
    await sleep(100);
    await disconnect(host(1), 'view:a');
    expect((await first).body).toMatchObject({ cmd: 'show och 1-7-9', ok: false });
    for (const r of await Promise.all(waiting)) expect(r).toEqual({ status: 409, body: 'Disconnected before it ran\n' });
    expect(box.count('show card')).toBe(1); // the snapshot's
  }, 40000);
});

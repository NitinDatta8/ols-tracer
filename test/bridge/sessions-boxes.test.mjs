// Six boxes at once, each with its own session, as notes.md item 1 asks: one box's people never touch another's
// (notes.md item 5). ssh2 is the fake in test/fakes/ssh2.mjs, so no session here leaves this process
// (test/fakes/lab.mjs).
import { describe, expect, it, vi } from 'vitest';
import { call, connect, disconnect, fake, folder, host, hostname, open, q, runs, sessions, sleep, until, whole, WORKERS } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

const six = [1, 2, 3, 4, 5, 6];

describe('six boxes at once', () => {
  it('a session each, each run in its own box, a show answered by its own box, and one leaving never touches another', async () => {
    const fakes = six.map((i) => fake(i));
    await Promise.all(six.flatMap((i) => [connect(host(i), `view:${i}`), connect(host(i), 'codex:everywhere')]));
    const metas = await Promise.all(six.map((i) => whole(folder(i))));
    expect(metas.map((m) => [m.box, m.host, m.hostname])).toEqual(six.map((i) => [folder(i), host(i), hostname(i)]));
    expect(fakes.map((b) => [b.logins, b.connections.size, b.shells.size, b.count('show card')])).toEqual(six.map(() => [1, 1, 1 + WORKERS, 1]));
    const shows = await Promise.all(six.map((i) => call('POST', `/show?${q(host(i), 'codex:everywhere')}`, 'show system')));
    expect(shows.map((r) => r.body.raw.split('\n')[0])).toEqual(six.map((i) => `hostname ${hostname(i)}`));

    // The one Codex session on all six leaves box 3, then box 3's view leaves too: only box 3's session closes.
    expect((await disconnect(host(3), 'codex:everywhere')).body).toEqual({ left: true, holders: 1 });
    expect((await disconnect(host(3), 'view:3')).body).toEqual({ left: true, holders: 0 });
    await until(() => !fakes[2].connections.size, 2000, "box 3's session to close");
    expect(fakes.map((b) => b.connections.size)).toEqual([1, 1, 0, 1, 1, 1]);
    expect((await sessions()).map((s) => `${s.host} ${s.state} ${s.holders}`).sort()).toEqual([1, 2, 4, 5, 6].map((i) => `${host(i)} connected 2`));
    expect(fakes.map((b) => b.logins)).toEqual(six.map(() => 1));
    for (const i of six) for (const m of await runs(folder(i))) expect(m.host).toBe(host(i));
  }, 60000);

  it('each held by six people is six SSH logins and six snapshots, the bridge quick to answer, and nothing left once all leave', async () => {
    const fakes = six.map((i) => fake(i, { delay: 5 }));
    const people = ['view:a', 'view:b', 'view:c', 'codex:1', 'codex:2', 'codex:3'];
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = timers();
    const joined = await Promise.all(six.flatMap((i) => people.map((by) => connect(host(i), by))));
    expect(joined.every((r) => r.status === 200)).toBe(true);
    // While the six snapshots are taken, the bridge still answers at once.
    const slowest = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      await Promise.all([call('GET', '/status'), call('GET', `/state?host=${host((i % 6) + 1)}`), call('GET', `/status?${q(host(1), 'view:a')}`)]);
      slowest.push(performance.now() - t);
      await sleep(50);
    }
    expect(Math.max(...slowest)).toBeLessThan(500);
    await Promise.all(six.map((i) => whole(folder(i))));
    expect(fakes.map((b) => [b.logins, b.connections.size, b.shells.size, b.count('show card'), b.overlaps])).toEqual(six.map(() => [1, 1, 1 + WORKERS, 1, 0]));
    expect((await sessions()).map((s) => s.holders)).toEqual(Array(6).fill(6));
    await Promise.all(six.flatMap((i) => people.map((by) => disconnect(host(i), by))));
    await until(() => !open(), 3000, 'every connection and shell to close');
    await sleep(1200); // a poller asleep between polls wakes once to find its session closed
    expect(timers()).toBeLessThanOrEqual(before); // none of the sessions' left: no retry, no poll, no prompt waiting
  }, 60000);
});

// A step that restarts the box (a reboot, an activate) on its session: the waits after it can't pass until the box has
// dropped the session, and a wait that tells the box back as it was reads it before the first step. ssh2 is the fake
// in test/fakes/ssh2.mjs, so no session here leaves this process. Apart from sessions-drops so each file stays short.
import { describe, expect, it, vi } from 'vitest';
import { connect, fake, folder, host, hostname, whole } from '../fakes/lab.mjs';
import { approve, ask, over, typed } from '../fakes/procedures.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('restarts', () => {
  it('a wait reads before the first step, and once the box is back compares with it', async () => {
    const box = fake(1, { answers: { 'show flag': 'up', 'restart ne': () => { setTimeout(() => box.drop(), 20); return 'Restarting'; } } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const asked = (await ask(host(1), 'restart', 'view:a')).body;
    expect(asked.plan.before).toEqual([{ check: 'again', shows: ['show flag'] }]);
    expect((await approve(host(1), asked.ref, hostname(1))).status).toBe(200);
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'done', sent: ['restart ne'] });
    expect(end.log.map((e) => [e.step, e.line ?? e.check ?? null])).toEqual([['before', 'again'], ['drop', 'restart ne'], ['back', null], ['wait', 'again']]);
    expect(typed(folder(1), end.runs[0]).slice(-3)).toEqual(['show flag', 'configure', 'restart ne']); // read before the line
  }, 60000);

  it('a box that never drops the session where a step expects it: the wait after it cannot pass, and it fails saying so', async () => {
    const box = fake(1, { answers: { 'show flag': 'up', 'restart ne': 'Restarting' } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const asked = (await ask(host(1), 'restart', 'view:a')).body;
    expect((await approve(host(1), asked.ref, hostname(1))).status).toBe(200);
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'failed', why: 'again: still not so after 3 s: the box has not dropped the session since restart ne. Left on the box: restart ne' });
    expect(end.log.map((e) => [e.step, e.line ?? e.check ?? null])).toEqual([['before', 'again'], ['send', 'restart ne']]);
    expect([box.count('restart ne'), box.logins]).toEqual([1, 1]);
  }, 40000);
});

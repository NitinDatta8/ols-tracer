// Procedures on a box's session (procedures.mjs, through the bridge): each on a shell of its own, into a run of its own
// and recorded as its own, one at a time on a box, holding the session; cancelled, a reversible one restores; and what
// can't run is refused. The procedures are the tests' (test/fakes/procedures.mjs). ssh2 is the fake in
// test/fakes/ssh2.mjs, so no session here leaves this process (test/fakes/lab.mjs).
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { call, connect, disconnect, fake, folder, host, index, q, runs, sessions, status, until, whole, WORKERS } from '../fakes/lab.mjs';
import { ask, current, over, PROCEDURES, saved, SETUP, typed } from '../fakes/procedures.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('procedures', () => {
  it('a read procedure runs on a shell of its own, into a procedure run, with its lines recorded as its own', async () => {
    const box = fake(1, { answers: { 'show flag': 'up' } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const list = (await call('GET', `/procedure?host=${host(1)}`)).body;
    expect(list).toMatchObject({ host: host(1), stream: 'csp', current: null });
    expect(list.procedures.map((p) => p.id)).toEqual(PROCEDURES.map((p) => p.id));
    expect(await ask(host(1), 'look', 'view:a')).toMatchObject({ status: 200, body: { id: 'look', tier: 'read', state: 'running', by: 'view:a' } });
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'done', why: null, sent: [] });
    expect(end.log.map((e) => [e.step, e.line ?? e.check, e.ok])).toEqual([['send', 'show card', true], ['send', 'show software', true], ['verify', 'flag', true]]);
    // A run of its own, a fast snapshot first, with its lines and its procedure.json.
    const [run] = end.runs;
    expect(end.runs).toEqual([run]); // a read one takes no snapshot after it
    expect((await runs(folder(1))).find((m) => m.run === run)).toMatchObject({ trigger: 'procedure', snapshot: { fast: true } });
    expect(typed(folder(1), run)).toEqual([...SETUP, 'exit', 'show card', 'show software', 'show flag']);
    expect(index(folder(1), run).filter((l) => l.source === 'procedure').every((l) => l.by === 'procedure:look')).toBe(true);
    expect(saved(folder(1), run)).toMatchObject({ id: 'look', state: 'done', by: 'view:a', definition: PROCEDURES[0] });
    // The run as its snapshot read it leaves them out.
    expect((await call('GET', `/run?box=${folder(1)}&run=${run}`)).body.commands).not.toHaveProperty('show flag');
    // Its shell is closed, and the session is the view's alone again.
    expect(box.shells.size).toBe(1 + WORKERS);
    expect(await status(host(1), 'view:a')).toMatchObject({ holders: 1, held: true });
  }, 40000);

  it("one at a time on a box, another box's meanwhile; it holds the session the view left; cancelled, a reversible one restores", async () => {
    const box = fake(1, { answers: { 'show flag': 'down' } });
    fake(2, { answers: { 'show flag': 'up' } });
    await Promise.all([connect(host(1), 'view:a'), connect(host(2), 'view:b')]);
    await Promise.all([whole(folder(1)), whole(folder(2))]);
    const hold = (await ask(host(1), 'hold', 'view:a')).body;
    await until(async () => (await current(host(1)))?.waiting?.what === 'flag', 10000, 'Hold to wait for the flag');
    expect(await ask(host(1), 'look', 'codex:x')).toEqual({ status: 409, body: 'Hold is running on this box: one at a time\n' });
    expect((await ask(host(2), 'look', 'view:b')).status).toBe(200);
    expect(await over(host(2))).toMatchObject({ state: 'done' });
    // The view that asked for it leaves: the procedure still holds the session.
    await disconnect(host(1), 'view:a');
    expect(await status(host(1))).toMatchObject({ state: 'connected', holders: 1 });
    const { runs: [run] } = await current(host(1));
    expect(await call('POST', `/procedure/cancel?${q(host(1), 'codex:x')}&ref=${randomUUID()}`)).toEqual({ status: 409, body: 'Nothing with that ref is running or waiting on this box\n' });
    expect((await call('POST', `/procedure/cancel?${q(host(1), 'codex:x')}&ref=${hold.ref}`)).status).toBe(200);
    // Over, it lets go of the session, which closes: no one else holds it.
    await until(async () => !(await sessions()).some((s) => s.host === host(1)), 15000, "box 1's session to close");
    const end = saved(folder(1), run);
    expect(end).toMatchObject({ state: 'cancelled', why: 'cancelled by codex:x', cancelledBy: 'codex:x', sent: ['set led on'] });
    expect(end.log.map((e) => [e.step, e.line ?? e.check, e.ok])).toEqual([['send', 'set led on', true], ['restore', 'set led off', true]]);
    // Its lines: its shell set up, the step, the wait's looks, one a second, and the restore, each in configure.
    const lines = typed(folder(1), run);
    expect(lines.slice(0, 8)).toEqual([...SETUP, 'set cli confirmation-required no', 'exit', 'configure', 'set led on', 'exit']);
    expect(lines.slice(-3)).toEqual(['configure', 'set led off', 'exit']);
    expect(new Set(lines.slice(8, -3))).toEqual(new Set(['show flag']));
    // A reversible one takes a snapshot after it, into a second procedure run.
    expect(end.runs).toHaveLength(2);
    expect((await runs(folder(1))).filter((m) => m.trigger === 'procedure').map((m) => m.run)).toEqual(end.runs);
    expect(box.count('set led off')).toBe(1);
  }, 60000);

  it('refuses what it cannot run, saying why', async () => {
    fake(1);
    expect(await ask(host(1), 'look', 'view:a')).toEqual({ status: 409, body: 'Connect to the box first: a procedure runs on its session\n' });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    expect(await call('POST', `/procedure?host=${host(1)}&id=look`)).toEqual({ status: 400, body: 'by: who asks\n' });
    expect(await ask(host(1), 'nope', 'view:a')).toEqual({ status: 404, body: "id: one of the box's procedures, from GET /procedure\n" });
    expect(await ask(host(1), 'Bad_Id', 'view:a')).toEqual({ status: 400, body: "id: a procedure's id\n" });
    expect(await ask(host(1), 'reboot', 'view:a', { mode: 'hot' })).toEqual({ status: 400, body: 'mode: one of cold, warm\n' });
    expect(await call('POST', `/procedure?${q(host(1), 'view:a')}&id=reboot`, '{mode')).toEqual({ status: 400, body: 'params: a JSON object\n' });
    expect(await call('POST', `/procedure/cancel?${q(host(1), 'view:a')}&ref=nope`)).toEqual({ status: 400, body: 'ref: the ref of a procedure asked for\n' });
    expect((await current(host(1)))).toBeNull();
  }, 40000);

  it('a box whose prerequisite fails is not polled: a show, a baseline or a procedure is refused, never left waiting', async () => {
    fake(1, { answers: { 'set cli length 0': 'Error: unknown command' } });
    await connect(host(1), 'view:a');
    // Its run stays in the default box's folder: it never got as far as show system, which names the box.
    await until(async () => (await runs('start')).some((m) => m.host === host(1) && m.prereqs.length === 4), 15000, 'the prerequisites to be tried');
    // A show asked for meanwhile is answered once the poller stops, not left waiting; after that each is refused.
    const refused = 'Connect to the box first: a show runs on the session\n';
    await until(async () => (await call('POST', `/show?${q(host(1), 'codex:c')}`, 'show card')).body === refused, 15000, 'a show to be refused');
    expect(await status(host(1))).toMatchObject({ state: 'connected' });
    expect(await call('POST', `/baseline?host=${host(1)}`)).toEqual({ status: 409, body: 'Connect to the box first: a baseline is recorded in a snapshot\n' });
    expect(await ask(host(1), 'look', 'view:a')).toEqual({ status: 409, body: 'Connect to the box first: a procedure runs on its session\n' });
  }, 40000);
});

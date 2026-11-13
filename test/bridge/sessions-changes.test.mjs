// A change on a box's session (procedures.mjs): it waits for Approve from the tracer UI, the box's hostname typed; a line
// the box refuses stops it; cancelled while it waits, or approved by nobody, it never runs. And a drop no step expects
// stops any procedure. ssh2 is the fake in test/fakes/ssh2.mjs, so no session here leaves this process.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { call, connect, fake, folder, host, hostname, q, status, whole } from '../fakes/lab.mjs';
import { approve, ask, over, SETUP, typed } from '../fakes/procedures.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('changes', () => {
  it('a change waits for Approve from the tracer UI with the hostname typed; a line the box refuses stops it, out of configure', async () => {
    const box = fake(1, { answers: { 'set bogus 1': 'Error: invalid input' } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const asked = (await ask(host(1), 'set-bad', 'codex:c')).body;
    expect(asked).toMatchObject({ state: 'pending', by: 'codex:c', plan: { steps: [{ send: 'set thing on' }, { send: 'set bogus 1' }, { send: 'set never 1' }] } });
    expect(await approve(host(1), asked.ref, hostname(1), { origin: null })).toEqual({ status: 403, body: 'Approve only from the tracer UI\n' });
    expect(await approve(host(1), asked.ref, hostname(1), { origin: 'http://elsewhere.test' })).toEqual({ status: 403, body: 'Approve only from the tracer UI\n' });
    expect(await approve(host(1), asked.ref, 'BOX-9')).toEqual({ status: 400, body: `Type the box's hostname, ${hostname(1)}, to approve\n` });
    expect(await approve(host(1), randomUUID(), hostname(1))).toEqual({ status: 409, body: 'Nothing with that ref is waiting for Approve on this box\n' });
    expect(box.count('set thing on')).toBe(0); // nothing runs while it waits
    expect(await approve(host(1), asked.ref, hostname(1).toLowerCase())).toMatchObject({ status: 200, body: { state: 'running', approvedBy: 'view:a' } });
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'failed', why: 'set bogus 1: the box refused it: Error: invalid input. Left on the box: set thing on', sent: ['set thing on'] });
    expect(box.count('set never 1')).toBe(0);
    const [run] = end.runs;
    expect(typed(folder(1), run)).toEqual([...SETUP, 'set cli confirmation-required no', 'exit', 'configure', 'set thing on', 'set bogus 1', 'exit']);
  }, 40000);

  it('a change cancelled while it waits never runs, and one nobody approves expires and lets go of the session', async () => {
    const box = fake(1);
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const first = (await ask(host(1), 'set-bad', 'codex:c')).body;
    expect(await call('POST', `/procedure/cancel?${q(host(1), 'codex:c')}&ref=${first.ref}`)).toMatchObject({ status: 200, body: { state: 'cancelled', why: 'cancelled by codex:c' } });
    const second = (await ask(host(1), 'set-bad', 'codex:c')).body;
    expect(await status(host(1))).toMatchObject({ holders: 2 }); // the view, and the change waiting
    expect(await over(host(1))).toMatchObject({ ref: second.ref, state: 'expired', why: 'nobody approved it within 4 s' });
    expect(await status(host(1))).toMatchObject({ state: 'connected', holders: 1 }); // it let go of the session
    expect(box.count('set thing on')).toBe(0);
  }, 40000);

  it('a drop where no step expects one stops it, saying to check the box', async () => {
    const box = fake(1, { answers: { 'show drop': () => { setTimeout(() => box.drop(), 20); return 'x'; } } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    await ask(host(1), 'look-drop', 'view:a');
    expect(await over(host(1))).toMatchObject({ state: 'failed', why: 'the box dropped the session at show drop: check the box' });
    expect(box.count('show drop')).toBe(1);
  }, 40000);
});

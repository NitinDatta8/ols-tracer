// The box drops the session where a procedure's step expects it (a reboot, an activate): the runner waits for the box to
// come back and its connect snapshot, then goes on, typing no line twice. ssh2 is the fake in test/fakes/ssh2.mjs, so no
// session here leaves this process.
import { describe, expect, it, vi } from 'vitest';
import { connect, fake, folder, host, hostname, index, whole } from '../fakes/lab.mjs';
import { approve, ask, over, SETUP, typed } from '../fakes/procedures.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('drops', () => {
  it('a drop where a step expects it: once the box is back and its connect snapshot whole, the runner goes on, typing no line twice', async () => {
    const box = fake(1, { answers: { 'show flag': 'up', 'reboot ne cold': () => { setTimeout(() => box.drop(), 20); return 'The system is going down'; } } });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const asked = (await ask(host(1), 'reboot', 'view:a')).body;
    expect(asked.plan.steps[0]).toEqual({ send: 'reboot ne cold', drops: true, timeout: 60 });
    expect((await approve(host(1), asked.ref, hostname(1))).status).toBe(200);
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'done', why: null, sent: ['reboot ne cold'] });
    expect(end.log.map((e) => [e.step, e.line ?? e.check ?? null])).toEqual([['drop', 'reboot ne cold'], ['back', null], ['wait', 'flag'], ['verify', 'flag']]);
    expect([box.count('reboot ne cold'), box.logins]).toEqual([1, 2]);
    // It went on in the reconnect's connect run, once that run's snapshot was whole.
    const second = await whole(folder(1), 'connect', 2);
    expect(end.runs).toEqual([end.runs[0], second.run, end.runs[2]]);
    const lines = index(folder(1), second.run);
    expect(lines.findIndex((l) => l.source === 'procedure')).toBeGreaterThan(lines.findLastIndex((l) => l.source === 'snapshot'));
    expect(typed(folder(1), second.run)).toEqual([...SETUP, 'set cli confirmation-required no', 'exit', 'show flag', 'show flag']);
  }, 60000);

  it('a drop in the wait after a step that expects one: the wait runs again once the box is back, the line typed once', async () => {
    let shown = 0;
    const box = fake(1, {
      answers: {
        'activate sw': 'Activating',
        'show flag': () => {
          if (++shown === 2) setTimeout(() => box.drop(), 20); // the switch, during the second look
          return shown < 3 ? 'switching' : 'up';
        },
      },
    });
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const asked = (await ask(host(1), 'activate', 'view:a')).body;
    expect((await approve(host(1), asked.ref, hostname(1))).status).toBe(200);
    const end = await over(host(1));
    expect(end).toMatchObject({ state: 'done', sent: ['activate sw'] });
    expect(end.log.map((e) => [e.step, e.line ?? e.check ?? null, e.tries ?? null])).toEqual([['send', 'activate sw', null], ['drop', 'activate sw', null], ['back', null, null], ['wait', 'flag', 1]]);
    expect([box.count('activate sw'), box.logins, shown]).toEqual([1, 2, 3]);
  }, 60000);
});

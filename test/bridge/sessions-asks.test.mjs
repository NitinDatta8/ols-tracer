// What people ask a box's session for, besides a show: a pull marked, a healthy baseline, and the polls that notice an
// alarm change. ssh2 is the fake in test/fakes/ssh2.mjs, so no session here leaves this process (test/fakes/lab.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { call, connect, disconnect, fake, folder, host, root, runs, sleep, status, until, whole } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

describe('what people ask the session for', () => {
  it('a pull of a wiring.csv strand gets a snapshot of its own, with its answer; one not in wiring.csv is refused', async () => {
    fake(1);
    mkdirSync(join(root, folder(1)), { recursive: true });
    writeFileSync(join(root, folder(1), 'wiring.csv'), 'strand,from,to,via,length_km,loss_db,notes\nF01,1-7-5,1-1-ad11,,,,line Tx into the mux\nF02,1-7-4,BERT:P1,,,,patch, to the BERT\n');
    await connect(host(1), 'view:a');
    await whole(folder(1));
    expect((await call('GET', `/wiring?host=${host(1)}`)).body.map((s) => [s.strand, s.notes])).toEqual([['F01', 'line Tx into the mux'], ['F02', 'patch, to the BERT']]);
    expect(await call('POST', `/pull?host=${host(1)}`, 'F99')).toEqual({ status: 400, body: 'A strand from wiring.csv\n' });
    expect((await call('POST', `/pull?host=${host(1)}`, 'F02')).status).toBe(200);
    const pull = await whole(folder(1), 'pull');
    expect(pull).toMatchObject({ state: 'fault', snapshot: { fast: true } });
    expect(pull.snapshot.done).toBe(pull.snapshot.of);
    expect(JSON.parse(readFileSync(join(root, folder(1), 'runs', pull.run, 'answer.json'), 'utf8'))).toMatchObject({ fault: 'pull', strand: 'F02', from: '1-7-4', to: 'BERT:P1', detectable: false });
    const read = await call('GET', `/run?box=${folder(1)}&run=${pull.run}`);
    expect(read.body.wiring.map((s) => s.strand)).toEqual(['F01', 'F02']); // the strands it was taken with
    expect(JSON.stringify(read.body)).not.toMatch(/"(fault|detectable|markedAt)":/);
  }, 40000);

  it('a baseline is a snapshot of its own, healthy once whole and read; one cut short or with a read missing is not', async () => {
    const box = fake(1, { answers: { 'show alarm': '{"alarms": {}}' } }); // a box with none parses so, not as None
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const ok = await call('POST', `/baseline?host=${host(1)}`);
    expect(ok).toMatchObject({ status: 200, body: { trigger: 'baseline', state: 'healthy', snapshot: { fast: true } } });
    expect(ok.body.snapshot.done).toBe(ok.body.snapshot.of);
    box.hang.add('show port'); // one of the fast snapshot's commands never answers: the snapshot is whole, the read is not
    expect(await call('POST', `/baseline?host=${host(1)}`)).toMatchObject({ status: 409, body: expect.stringMatching(/^show port got no prompt back or didn't parse, so \S+ is not a baseline: try again\n$/) });
    box.hang.delete('show port');
    box.delay = 400;
    const cut = call('POST', `/baseline?host=${host(1)}`);
    await until(async () => (await status(host(1))).snapshot?.done >= 1, 5000, 'the baseline snapshot to start');
    await disconnect(host(1), 'view:a');
    expect(await cut).toMatchObject({ status: 409, body: expect.stringMatching(/^The session closed during the snapshot, so \S+ is cut short and not a baseline\n$/) });
    expect((await runs(folder(1))).filter((m) => m.state === 'healthy')).toHaveLength(1);
  }, 40000);

  it('polls notice an alarm change: a loss of signal starts a fast snapshot, a threshold warning does not', async () => {
    // Two boxes polled side by side: on one a warning comes up, on the other a loss of signal.
    const alarms = { 1: {}, 2: {} };
    for (const i of [1, 2]) fake(i, { answers: { 'show alarm': () => JSON.stringify({ alarms: alarms[i] }) } });
    await Promise.all([connect(host(1), 'view:a'), connect(host(2), 'view:a')]);
    await Promise.all([whole(folder(1)), whole(folder(2))]);
    alarms[1] = { 1: { resource: 'port 1-1-ad11', 'alarm-abbreviate': 'IN_OPTICAL_HIGH_WARNING', severity: 'MAJOR' } };
    alarms[2] = { 1: { resource: 'port 1-1-ad11', 'alarm-abbreviate': 'IN_LOS', severity: 'CRITICAL' } };
    const fast = await whole(folder(2), 'alarms');
    expect(fast.snapshot).toMatchObject({ fast: true });
    expect(fast.snapshot.of).toBeLessThan(57);
    const polled = async () => (await call('GET', `/state?host=${host(1)}`)).body.commands['show alarm']?.data?.alarms?.[1];
    await until(polled, 15000, 'a poll of box 1 to see the warning');
    await sleep(1500);
    expect((await runs(folder(1))).map((m) => m.trigger)).toEqual(['connect']);
  }, 60000);
});

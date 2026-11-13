// A box's history (history.mjs): its alarm and config logs gathered from every run once, at wall time; the episodes
// cut from them; and the alarms up at a time. On runs written here by hand, and on events made up for each rule.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alarmsAt, episodes, history, record } from '../../bridge/history.mjs';
import { iso } from '../../bridge/recorder.mjs';

const alarm = (box, action, name, resource, sa = 'true') => ({ 'time-stamp': box, action, 'alarm-abbreviate': name, resource, severity: 'CRITICAL', direction: 'rx', 'service-affect': sa });
const config = (box, type, details) => ({ 'time-stamp': box, 'user-name': 'admin', 'user-ip': 'ws-1.test', type, details });

/** A run of `dir`: meta.json, and `show log alarm` and `show log configuration` parses, as a snapshot or as polls. */
function run(dir, name, meta, { events = [], entries = [], polls = [] } = {}) {
  const r = join(dir, 'runs', name);
  mkdirSync(join(r, 'raw'), { recursive: true });
  mkdirSync(join(r, 'parsed'), { recursive: true });
  writeFileSync(join(r, 'meta.json'), JSON.stringify({ run: name, ...meta }));
  writeFileSync(join(r, 'raw', 'index.jsonl'), ['000_show-log-alarm--l-200.txt', '001_show-log-configuration--l-200.txt', '002_show-card.txt']
    .map((file, n) => `${JSON.stringify({ n, cmd: ['show log alarm -l 200', 'show log configuration -l 200', 'show card'][n], file })}\n`).join(''));
  writeFileSync(join(r, 'parsed', '000_show-log-alarm--l-200.json'), JSON.stringify({ events }));
  writeFileSync(join(r, 'parsed', '001_show-log-configuration--l-200.json'), JSON.stringify({ entries }));
  if (polls.length) writeFileSync(join(r, 'poll.jsonl'), polls.map((p) => `${JSON.stringify(p)}\n`).join(''));
}

describe('history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ols-history-'));
  const los = alarm('2021-08-01T01:00:00+00:00', 'CREATE', 'IN_LOS', 'port 1-1-ad11');
  const clear = alarm('2021-08-01T01:05:00+00:00', 'CLEAR', 'IN_LOS', 'port 1-1-ad11');
  const channel = alarm('2021-08-01T01:01:00+00:00', 'CREATE', 'REACH_MAX_ATT_SRC_TO_DEST', 'mediach-ch-6', 'false');
  const set = config('2021-08-01T00:59:00+00:00', 'set', 'set media-channel 2 admin-state in-service');
  // Kept from a run deleted since.
  const old = { at: '2026-10-01T09:00:00-04:00', box: '2021-07-01T00:00:00+00:00', kind: 'config', type: 'rpc', user: 'admin', ip: 'ws-1.test', details: 'reboot ne cold' };
  writeFileSync(join(dir, 'history.jsonl'), `${JSON.stringify(old)}\n`);
  run(dir, '20261101-100000-connect', { trigger: 'connect', started: '2026-11-01T10:00:00-04:00', boxClockOffsetSec: -100 }, {
    events: [los, channel], entries: [config('2021-08-01T00:58:00+00:00', 'rpc', 'set cli length 0'), config('2021-08-01T00:58:00+00:00', 'rpc', 'set cli width 1024'), set],
  });
  // The same loss in a later run, with another clock offset, and its clear in a poll.
  run(dir, '20261101-101000-alarms', { trigger: 'alarms', started: '2026-11-01T10:10:00-04:00', boxClockOffsetSec: -200 }, {
    events: [los], polls: [{ at: '2026-11-01T10:11:00-04:00', cmd: 'show log alarm -l 50', data: { events: [clear, los] } }],
  });
  // A hand capture from before them, whose offset can be minutes out, and a run with no clock read.
  run(dir, 'hand/20261101-090000-hand', { trigger: 'hand', started: '2026-11-01T09:00:00-04:00', boxClockOffsetSec: -50 }, { events: [los] });
  run(dir, '20261101-110000-connect', { trigger: 'connect', started: '2026-11-01T11:00:00-04:00', boxClockOffsetSec: null }, { events: [alarm('2021-08-01T02:00:00+00:00', 'CREATE', 'IN_LOS', 'port 1-1-ad2')] });
  const wall = (box, offset) => iso(Date.parse(box) - offset * 1000);

  it("takes each event once, at the wall time of the first run that logged it, a hand capture's last", () => {
    const h = history(dir);
    expect(h.map((e) => `${e.kind} ${e.action ?? e.type} ${e.alarm ?? e.details}`)).toEqual([
      'config rpc reboot ne cold', 'config set set media-channel 2 admin-state in-service', 'alarm CREATE IN_LOS', 'alarm CREATE REACH_MAX_ATT_SRC_TO_DEST', 'alarm CLEAR IN_LOS',
    ]);
    expect(h.find((e) => e.alarm === 'IN_LOS' && e.action === 'CREATE').at).toBe(wall(los['time-stamp'], -100));
    expect(h.find((e) => e.action === 'CLEAR').at).toBe(wall(clear['time-stamp'], -200));
    expect(h[0]).toEqual(old);
  });

  it("names a media channel's resource as show alarm does, and leaves out the recorder's own cli settings", () => {
    const h = history(dir);
    expect(h.find((e) => e.alarm === 'REACH_MAX_ATT_SRC_TO_DEST')).toMatchObject({ resource: 'ch-6', sa: false, severity: 'CRITICAL', direction: 'rx' });
    expect(h.find((e) => e.alarm === 'IN_LOS')).toMatchObject({ resource: 'port 1-1-ad11', sa: true });
    expect(h.filter((e) => /^set cli/.test(e.details ?? ''))).toEqual([]);
    expect(h.find((e) => e.type === 'set')).toEqual({ at: wall(set['time-stamp'], -100), box: set['time-stamp'], kind: 'config', type: 'set', user: 'admin', ip: 'ws-1.test', details: set.details });
    expect(h.some((e) => e.resource === 'port 1-1-ad2')).toBe(false); // its run read no clock
  });

  it('writes it to history.jsonl, which keeps it once the runs are gone', () => {
    const h = record(dir);
    expect(readFileSync(join(dir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).toEqual(h);
    expect(history(dir)).toEqual(h);
  });
});

describe('episodes', () => {
  const t0 = Date.parse('2026-11-02T12:00:00Z');
  const at = (s) => new Date(t0 + s * 1000).toISOString();
  const loss = (s, action, resource = 'port 1-1-ad11', name = 'IN_LOS', sa = true) => ({ at: at(s), kind: 'alarm', action, alarm: name, resource, sa });
  const did = (s, type, details) => ({ at: at(s), kind: 'config', type, details, ip: 'ws-1.test' });

  it('puts an outage down to the restart before it, with when traffic came back and its first alarms', () => {
    expect(episodes([did(0, 'rpc', 'reboot ne cold'), loss(120, 'CREATE'), loss(130, 'CREATE', 'och 1-7-5', 'RX_LOS'), loss(300, 'CLEAR', 'och 1-7-5', 'RX_LOS'), loss(300, 'CLEAR')])).toEqual([{
      at: at(0), cause: 'reboot', what: 'reboot ne cold', ip: 'ws-1.test', lossAt: at(120), backAt: at(300),
      first: ['IN_LOS@port 1-1-ad11', 'RX_LOS@och 1-7-5'], outageSec: 180, backSec: 300,
    }]);
  });

  it('takes a reboot typed in any case as a reboot', () => {
    expect(episodes([did(0, 'rpc', 'Reboot ne cold'), loss(150, 'CREATE'), loss(200, 'CLEAR')]).map((e) => [e.cause, e.what, e.lossAt])).toEqual([['reboot', 'Reboot ne cold', at(150)]]);
  });

  it("puts an outage up to 30 min after an activate, rollback or database clear down to it, a restart, and a reboot's up to 10 min", () => {
    for (const what of ['activate candidate-sw-image', 'Rollback', 'clear database keep-networking']) {
      expect(episodes([did(0, 'rpc', what), loss(1182, 'CREATE'), loss(1300, 'CLEAR')]).map((e) => [e.cause, e.what, e.lossAt, e.backSec])).toEqual([['restart', what, at(1182), 1300]]);
      expect(episodes([did(0, 'rpc', what), loss(1801, 'CREATE')]).map((e) => [e.cause, e.lossAt])).toEqual([['restart', null], [null, at(1801)]]);
    }
    expect(episodes([did(0, 'rpc', 'reboot ne cold'), loss(601, 'CREATE')]).map((e) => [e.cause, e.lossAt])).toEqual([['reboot', null], [null, at(601)]]);
    // A commit takes a second and restarts nothing.
    expect(episodes([did(0, 'rpc', 'commit active-sw-image'), loss(601, 'CREATE')]).map((e) => [e.cause, e.lossAt])).toEqual([['config', null], [null, at(601)]]);
  });

  it("takes a missing card's alarm that a restart raises again as no card taken out", () => {
    const out = episodes([did(0, 'rpc', 'activate candidate-sw-image'), { ...loss(1200, 'CREATE', 'card 1-1', 'EQPT_ABSENCE'), sa: false }, loss(1210, 'CREATE'), loss(1500, 'CLEAR')]);
    expect(out.map((e) => [e.cause, e.what, e.lossAt])).toEqual([['restart', 'activate candidate-sw-image', at(1210)]]);
  });

  it('leaves an outage nothing explains for a person to label, and one long after a change too', () => {
    expect(episodes([loss(0, 'CREATE'), loss(60, 'CLEAR')])).toEqual([{ at: at(0), cause: null, what: 'IN_LOS@port 1-1-ad11', lossAt: at(0), backAt: at(60), first: ['IN_LOS@port 1-1-ad11'], outageSec: 60, backSec: 60 }]);
    const late = episodes([did(0, 'set', 'set media-channel 2 center-frequency 193600000'), loss(601, 'CREATE')]);
    expect(late.map((e) => [e.cause, e.lossAt])).toEqual([['config', null], [null, at(601)]]);
    expect(late[1]).not.toHaveProperty('outageSec'); // not back yet
  });

  it('takes a card that goes missing within seconds of its light as the cause, but not one a restart takes out', () => {
    const out = episodes([loss(0, 'CREATE'), { ...loss(2, 'CREATE', 'card 1-1', 'EQPT_ABSENCE'), sa: false }, loss(100, 'CLEAR')]);
    expect(out).toEqual([{ at: at(0), cause: 'card out', what: 'card 1-1', lossAt: at(0), backAt: at(100), first: ['IN_LOS@port 1-1-ad11', 'EQPT_ABSENCE@card 1-1'], outageSec: 100, backSec: 100 }]);
    const restart = episodes([did(0, 'rpc', 'reboot ne warm'), { ...loss(60, 'CREATE', 'card 1-1', 'EQPT_ABSENCE'), sa: false }, loss(90, 'CREATE'), loss(200, 'CLEAR')]);
    expect(restart.map((e) => [e.cause, e.what, e.lossAt])).toEqual([['reboot', 'reboot ne warm', at(90)]]);
  });

  it('counts an outage until every loss on it clears, and a loss of frame as one, but not an alarm that hits no traffic', () => {
    const out = episodes([loss(0, 'CREATE'), loss(10, 'CREATE', 'och 1-7-5', 'LOF'), loss(20, 'CLEAR'), loss(40, 'CLEAR', 'och 1-7-5', 'LOF')]);
    expect(out.map((e) => [e.lossAt, e.backAt, e.outageSec])).toEqual([[at(0), at(40), 40]]);
    expect(episodes([loss(0, 'CREATE', 'port 1-1-line', 'IN_LOS', false), loss(5, 'CLEAR', 'port 1-1-line', 'IN_LOS', false)])).toEqual([]);
  });

  it('marks what was done last before traffic came back as what restored it', () => {
    const out = episodes([loss(0, 'CREATE'), did(30, 'set', 'set media-channel 2 admin-state in-service'), loss(35, 'CLEAR')]);
    expect(out.map((e) => [e.cause, e.lossAt, e.backAt, e.restores])).toEqual([[null, at(0), at(35), undefined], ['config', null, null, true]]);
  });
});

describe('alarmsAt', () => {
  const h = [
    { at: '2026-11-02T12:00:00Z', kind: 'alarm', action: 'CREATE', alarm: 'IN_LOS', resource: 'port 1-1-ad11', severity: 'CRITICAL', direction: 'rx' },
    { at: '2026-11-02T12:00:30Z', kind: 'config', type: 'set', details: 'set och 1-7-5 laser enabled' },
    { at: '2026-11-02T12:01:00Z', kind: 'alarm', action: 'CLEAR', alarm: 'IN_LOS', resource: 'port 1-1-ad11', severity: 'CRITICAL', direction: 'rx' },
  ];

  it('lists the alarms up at a time as show alarm parses them, a clear at that very time taken', () => {
    expect(alarmsAt(h, '2026-11-02T11:59:59Z')).toEqual({});
    expect(alarmsAt(h, '2026-11-02T12:00:59Z')).toEqual({ 'IN_LOS@port 1-1-ad11': { resource: 'port 1-1-ad11', 'alarm-abbreviate': 'IN_LOS', severity: 'CRITICAL', direction: 'rx' } });
    expect(alarmsAt(h, '2026-11-02T12:01:00Z')).toEqual({});
    expect(alarmsAt([], '2026-11-02T12:01:00Z')).toEqual({});
  });
});

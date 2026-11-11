// Box history: every alarm and configuration change a box logged, gathered from the `show log alarm` and
// `show log configuration` of all its runs into data/boxes/<box>/history.jsonl, which keeps them after the runs are
// deleted. The box keeps its own log, so a change made while nothing was connected is found at the next connect, as
// long as the log still reaches back that far. Times are the box's, and the wall clock's from the run's clock offset.
//   node bridge/history.mjs data/boxes/paho-gs2000-03     writes history.jsonl and prints its episodes
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iso, lines, metaOf, runsIn } from './recorder.mjs';

/** A `show log alarm` or `show log configuration` parse (snapshot or poll) as history events, at box time. */
function events(cmd, data) {
  if (/^show log alarm/.test(cmd)) {
    return (data?.events ?? []).map((e) => ({
      box: e['time-stamp'], kind: 'alarm', action: e.action, alarm: e['alarm-abbreviate'],
      resource: e.resource.replace(/^mediach-/, ''), // `show alarm` names media channel 6 `ch-6`, its log `mediach-ch-6`
      severity: e.severity, direction: e.direction, sa: e['service-affect'] === 'true',
    }));
  }
  if (/^show log configuration/.test(cmd)) {
    return (data?.entries ?? []).filter((e) => !/^set cli (length|width) /.test(e.details)) // the recorder's own, every session
      .map((e) => ({ box: e['time-stamp'], kind: 'config', type: e.type, user: e['user-name'], ip: e['user-ip'], details: e.details }));
  }
  return [];
}

const key = (e) => [e.box, e.kind, e.action, e.alarm, e.resource, e.details].join('|');

/**
 * The box's history: history.jsonl and every run's logs, one event once, oldest first. An event's wall time comes from
 * the clock offset of the first run that logged it, a hand capture's last (its offset can be minutes out).
 */
export function history(boxDir) {
  const all = new Map(lines(join(boxDir, 'history.jsonl')).map((e) => [key(e), e]));
  const runs = runsIn(join(boxDir, 'runs')).flatMap((dir) => { const meta = metaOf(dir); return meta ? [{ dir, meta }] : []; })
    .sort((a, b) => (a.meta.trigger === 'hand') - (b.meta.trigger === 'hand') || Date.parse(a.meta.started) - Date.parse(b.meta.started));
  for (const { dir, meta } of runs) {
    if (meta.boxClockOffsetSec == null) continue;
    const found = [
      ...lines(join(dir, 'raw', 'index.jsonl')).flatMap(({ cmd, file }) => {
        const f = join(dir, 'parsed', file.replace(/\.txt$/, '.json'));
        return existsSync(f) ? events(cmd, JSON.parse(readFileSync(f, 'utf8'))) : [];
      }),
      ...lines(join(dir, 'poll.jsonl')).flatMap(({ cmd, data }) => events(cmd, data)),
    ];
    for (const e of found) {
      if (!all.has(key(e))) all.set(key(e), { at: iso(Date.parse(e.box) - meta.boxClockOffsetSec * 1000), ...e });
    }
  }
  return [...all.values()].sort((a, b) => Date.parse(a.box) - Date.parse(b.box));
}

/** Writes the box's history.jsonl, and returns it. */
export function record(boxDir) {
  const h = history(boxDir);
  writeFileSync(join(boxDir, 'history.jsonl'), h.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return h;
}

/** A loss of signal or frame that hits traffic: an outage while any is up. */
const isLoss = (e) => e.kind === 'alarm' && e.sa && /LOS|LOF/.test(e.alarm);
/** What the box itself says was done: a reboot, another configuration change, or a card taken out. */
function cause(e) {
  if (e.kind === 'config') return { cause: e.type === 'rpc' && /^reboot /.test(e.details) ? 'reboot' : 'config', what: e.details };
  if (e.kind === 'alarm' && e.action === 'CREATE' && e.alarm === 'EQPT_ABSENCE') return { cause: 'card out', what: e.resource };
  return null;
}
/** How long after something was done its outage may start and still be put down to it, in s. */
const REACH = 600;
/** How long a card's light can go before the box notices the card is missing (2 s on box 3's C1125), in s. */
const NOTICE = 5;
/** The first alarms of an outage, kept as its evidence: those raised within this long of its start, in s. */
const FIRST = 30;

/**
 * The history cut into episodes: each thing the box says was done, with the outage that followed it (`lossAt`, when
 * traffic came back, `backAt`, and the first alarms raised), and each outage nothing explains, with `cause: null` for a
 * person to label (a pulled fiber, say). The box's logs label everything else themselves. `outageSec` runs from the
 * loss to traffic back, `backSec` from what was done (a reboot's loss is only raised once the box is up again).
 * `restores` marks what was done last before traffic came back. An outage is any traffic-hitting LOS or LOF up.
 */
export function episodes(h) {
  const out = [];
  const up = new Set();
  let last = null; // what was done last
  let open = null; // the episode whose outage is going on
  for (const e of h) {
    const t = Date.parse(e.at);
    let c = cause(e);
    // A reboot raises the standing alarms again, a missing card's among them: that card wasn't just taken out.
    if (c?.cause === 'card out' && last?.cause === 'reboot' && t - Date.parse(last.at) <= REACH * 1000) c = null;
    // A card taken out takes its light with it before the box says the card is missing: the loss is the card's.
    if (c?.cause === 'card out' && open?.cause === null && t - Date.parse(open.lossAt) <= NOTICE * 1000) Object.assign((last = open), c);
    else if (c) out.push((last = { at: e.at, ...c, ...(e.ip ? { ip: e.ip } : {}), lossAt: null, backAt: null, first: [] }));
    if (!isLoss(e)) continue;
    const id = `${e.alarm}@${e.resource}`;
    const was = up.size;
    if (e.action === 'CREATE') up.add(id);
    else up.delete(id);
    if (!was && up.size) {
      const fresh = last && !last.lossAt && !last.restores && t - Date.parse(last.at) <= REACH * 1000;
      if (!fresh) out.push((last = { at: e.at, cause: null, what: id, lossAt: null, backAt: null, first: [] }));
      (open = last).lossAt = e.at;
    }
    if (was && !up.size && open) {
      open.backAt = e.at;
      if (last !== open) last.restores = true;
      open = null;
    }
  }
  for (const ep of out.filter((x) => x.lossAt)) {
    const from = Date.parse(ep.lossAt);
    ep.first = h.filter((e) => e.kind === 'alarm' && e.action === 'CREATE' && Date.parse(e.at) >= from && Date.parse(e.at) - from <= FIRST * 1000)
      .map((e) => `${e.alarm}@${e.resource}`);
    if (ep.backAt) [ep.outageSec, ep.backSec] = [(Date.parse(ep.backAt) - from) / 1000, (Date.parse(ep.backAt) - Date.parse(ep.at)) / 1000];
  }
  return out;
}

/** The alarms up at `at` (an ISO time), from the history: what `show alarm` would have listed, as its parse has them. */
export function alarmsAt(h, at) {
  const up = new Map();
  for (const e of h) {
    if (e.kind !== 'alarm' || Date.parse(e.at) > Date.parse(at)) continue;
    const id = `${e.alarm}@${e.resource}`;
    if (e.action === 'CREATE') up.set(id, { resource: e.resource, 'alarm-abbreviate': e.alarm, severity: e.severity, direction: e.direction });
    else up.delete(id);
  }
  return Object.fromEntries(up);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? 'data/boxes/paho-gs2000-03');
  const h = record(dir);
  console.log(`${h.length} events → ${join(dir, 'history.jsonl')}\n`);
  for (const ep of episodes(h)) {
    const outage = ep.outageSec !== undefined ? `back ${ep.backSec} s` : ep.lossAt ? 'not back' : ep.restores ? 'restores' : '';
    console.log([ep.at.slice(5, 19).replace('T', ' '), (ep.cause ?? '?').padEnd(8), outage.padEnd(10), ep.what].join('  '));
  }
}

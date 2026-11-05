// Recorder: writes what the bridge's poller reads into data/boxes/<box>/runs/, so a session with the box leaves its runs
// on disk without anyone capturing them. A run is one snapshot (every command in poll.json once on connect, the fast
// ones on an alarm change or a pull) and the polls after it, until the next snapshot. A run goes to the box `show system`
// names. The layout and meta.json are described in docs/plans/box3-capture.md.
// On its own it parses a run's raw output again into parsed/, e.g. after a template changed:
//   node bridge/recorder.mjs data/boxes/box3/runs/run-01-healthy
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { commandFor } from './cli-index.mjs';

const env = process.env;
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const REPO_ROOT = here('..');
const BOX = (env.BOX_DATA_BOX ?? 'box3').trim() || 'box3';
const BOX_DATA_ROOT = resolve(REPO_ROOT, env.BOX_DATA_ROOT ?? join('data', 'boxes', BOX));
const TEMPLATES_DIR = join(BOX_DATA_ROOT, 'ttp', 'templates');
const RUNS_DIR = join(BOX_DATA_ROOT, 'runs');
/** Every box's folder, and the box the session's runs go to: BOX until `show system` names another. */
const BOXES = dirname(BOX_DATA_ROOT);
let current = basename(BOX_DATA_ROOT);
export const PYTHON = env.PYTHON ?? here('.venv/bin/python');
/** The CLI index's commands. A command's template is named after its id. */
const COMMANDS = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'cli', 'csp', 'cli-index.source.json'), 'utf8')).commands;
/** What the box prints when it rejects a command. */
const REJECTED = /invalid|error|problem parsing/i;

const exec = promisify(execFile);
const WIRING_COLUMNS = ['strand', 'from', 'to', 'via', 'length_km', 'loss_db', 'notes'];
const DARK = -35;
const LOCAL = /^\d+-\d+-[a-z0-9]+$/i;

/** A time as local ISO 8601 with its offset, as meta.json has it: 2026-10-31T10:52:10-04:00. */
export function iso(t) {
  const off = -new Date(t).getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${new Date(t + off * 60000).toISOString().slice(0, 19)}${off < 0 ? '-' : '+'}${pad(off / 60)}:${pad(off % 60)}`;
}

/** A command as a file name, as scripts/split-session-log.mjs makes it: spaces become -, * all and ? help. */
const slug = (cmd) => cmd.replace(/\*/g, 'all').replace(/\?/g, 'help').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');

/** A command's output as JSON with its TTP template: { template, data }, { template, error }, or {} with no template. */
export async function parse(cmd, raw) {
  const id = commandFor(COMMANDS, cmd)?.commandId;
  if (!id || !existsSync(join(TEMPLATES_DIR, `${id}.ttp`))) return {};
  try {
    const p = exec(PYTHON, [here('parse.py'), join(TEMPLATES_DIR, `${id}.ttp`)], { timeout: 10000 });
    p.child.stdin.end(raw);
    return { template: id, data: JSON.parse((await p).stdout) };
  } catch (e) {
    return { template: id, error: e.message };
  }
}

/** A poll.jsonl line: { at, cmd, data }, or { at, cmd, raw } (and its error) so a failed parse can be redone. */
const pollLine = (at, cmd, raw, { template, data, error }) => ({ at: typeof at === 'string' ? at : iso(at), cmd, ...(template && !error ? { data } : { raw, error }) });

/** Writes a parse into the run's parsed/, named after its raw file: the data, or { error }. */
function keep(dir, file, { data, error }) {
  mkdirSync(join(dir, 'parsed'), { recursive: true });
  writeFileSync(join(dir, 'parsed', file.replace(/\.txt$/, '.json')), `${JSON.stringify(data ?? { error }, null, 2)}\n`);
}

/** The box a hostname belongs to: the one whose setup.md has it in a table cell, else a folder named after it. */
export const boxOf = (hostname) => (existsSync(BOXES) ? readdirSync(BOXES) : [])
  .find((b) => existsSync(join(BOXES, b, 'setup.md')) && readFileSync(join(BOXES, b, 'setup.md'), 'utf8').includes(`| ${hostname} |`))
  ?? hostname.toLowerCase();

const rootOf = (box = current) => join(BOXES, box);
const wiringFile = (box = current) => join(rootOf(box), 'wiring.csv');
const clean = (text = '') => String(text).replace(/\r?\n/g, ' ').replace(/,/g, ';').trim();

const readWiring = (box = current) => {
  const f = wiringFile(box);
  if (!existsSync(f)) return [];
  const [head, ...rows] = readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const keys = head.split(',');
  // The last column, notes, may hold commas.
  return rows.map((r) => Object.fromEntries(keys.map((k, i, all) => [k, (i < all.length - 1 ? r.split(',')[i] : r.split(',').slice(i).join(',')) ?? ''])));
};

const writeWiring = (strands, box = current) => {
  mkdirSync(rootOf(box), { recursive: true });
  const csv = [
    WIRING_COLUMNS.join(','),
    ...strands.map((s) => WIRING_COLUMNS.map((k) => clean(s[k])).join(',')),
  ].join('\n');
  writeFileSync(wiringFile(box), `${csv}\n`);
};

const local = (at = '') => at.replace(/^port-/i, '').trim().toLowerCase();
const hasLight = (v) => typeof v === 'number' && Number.isFinite(v) && v > DARK;

/** Rows with source/destination ports from show internal/external-connection output (raw table). */
function connectionsFrom(raw, cmd) {
  if (!raw || /^\s*none\s*$/im.test(raw)) return [];
  const found = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/^\[|^id\s|^-{2,}|^state\s|^config\s/i.test(line)) continue;
    const ports = line.match(/port-[a-z0-9-]+/gi) ?? line.match(/\b\d+-\d+-[a-z0-9]+\b/gi);
    if (!ports || ports.length < 2) continue;
    const via = line.split(/\s+/)[0] ?? '';
    found.push({ from: local(ports[0]), to: local(ports[1]), via, notes: `auto: ${cmd}` });
  }
  const seen = new Set();
  return found.filter((f) => {
    const key = `${f.from}->${f.to}|${f.via}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const stat = (data, key) => {
  const v = data?.state?.stats?.[key]?.instant;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** Address -> { tx, rx } from parsed show commands. */
function powers(commands) {
  const map = new Map();
  const set = (at, tx, rx) => {
    if (!LOCAL.test(at)) return;
    const got = map.get(at) ?? {};
    if (tx !== undefined && got.tx === undefined) got.tx = tx;
    if (rx !== undefined && got.rx === undefined) got.rx = rx;
    map.set(at, got);
  };
  for (const [cmd, out] of Object.entries(commands ?? {})) {
    const data = out?.data;
    if (!data) continue;
    const och = cmd.match(/^show och (\d+-\d+-\w+)$/i);
    if (och) set(och[1].toLowerCase(), stat(data, 'output-power'), stat(data, 'total-input-power'));
    const xcvr = cmd.match(/^show transceiver (\d+-\d+-\w+)$/i);
    if (xcvr) set(xcvr[1].toLowerCase(), stat(data, 'output-power'), stat(data, 'input-power'));
    if (cmd === 'show optical-port') {
      for (const [id, port] of Object.entries(data?.state?.ports ?? {})) {
        set(local(id), port?.out?.['optical-power'], port?.in?.['optical-power']);
      }
    }
  }
  return map;
}

/** Conservative fallback: pair Tx and Rx by unique nearest power levels, then keep only mutual matches. */
function powerWires(commands) {
  const p = powers(commands);
  const tx = [...p.entries()].filter(([, v]) => hasLight(v.tx));
  const rx = [...p.entries()].filter(([, v]) => hasLight(v.rx));
  if (!tx.length || !rx.length) return [];

  const candidates = tx.flatMap(([from, a]) => rx.map(([to, b]) => {
    const loss = (a.tx ?? 0) - (b.rx ?? 0);
    return { from, to, loss, score: Math.abs(loss) };
  }).filter((c) => c.loss >= -25 && c.loss <= 70));

  const best = (key) => {
    const by = new Map();
    for (const c of candidates) {
      const id = c[key];
      const list = by.get(id) ?? [];
      list.push(c);
      by.set(id, list);
    }
    const one = new Map();
    for (const [id, list] of by.entries()) {
      const sorted = list.sort((a, b) => a.score - b.score);
      if (sorted[1] && sorted[1].score - sorted[0].score <= 1) continue; // ambiguous
      one.set(id, sorted[0]);
    }
    return one;
  };

  const out = best('from');
  const into = best('to');
  const strands = [];
  for (const c of out.values()) {
    if (into.get(c.to)?.from !== c.from) continue;
    strands.push({
      from: c.from,
      to: c.to,
      via: 'power',
      loss_db: c.loss.toFixed(2),
      notes: 'auto: power fallback (low confidence)',
    });
  }
  const seen = new Set();
  return strands.filter((s) => {
    const key = `${s.from}->${s.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Strands inferred first from connection commands, else from power as a low-confidence fallback. */
export function inferWiring(commands = {}) {
  const byConnections = ['show internal-connection', 'show external-connection']
    .flatMap((cmd) => connectionsFrom(commands[cmd]?.raw, cmd));
  if (byConnections.length) return { source: 'connections', strands: byConnections };
  const byPower = powerWires(commands);
  return byPower.length ? { source: 'power', strands: byPower } : { source: 'none', strands: [] };
}

/** Existing wiring.csv, or one generated from command output; with `refresh`, rewrites it when inference changed. */
export function ensureWiring(commands = {}, box = current, { refresh = false } = {}) {
  const existing = readWiring(box);
  if (existing.length && !refresh) return existing;
  const { strands } = inferWiring(commands);
  if (!strands.length) return existing.length ? existing : [];
  const rows = strands.map((s, i) => ({
    strand: `F${String(i + 1).padStart(2, '0')}`,
    from: s.from,
    to: s.to,
    via: s.via ?? '',
    length_km: '',
    loss_db: s.loss_db ?? '',
    notes: s.notes ?? '',
  }));
  const same = existing.length === rows.length && existing.every((row, i) => WIRING_COLUMNS.every((k) => (row[k] ?? '') === (rows[i][k] ?? '')));
  if (same) return existing;
  writeWiring(rows, box);
  return rows;
}

/** A run folder, named after when its snapshot started and why: <YYYYMMDD-HHMMSS>-connect, -alarms or -pull. */
export class Run {
  constructor(trigger, host) {
    const at = Date.now();
    const name = `${iso(at).slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${trigger}`;
    const runs = join(BOXES, current, 'runs');
    let run = name;
    for (let k = 2; existsSync(join(runs, run)); k++) run = `${name}-${k}`;
    this.dir = join(runs, run);
    this.n = 0;
    this.polled = {}; // command → its last poll, so an unchanged one isn't written again
    this.meta = {
      run, box: current, host, hostname: null, release: null, trigger, started: iso(at), ended: null,
      boxClock: null, boxClockOffsetSec: null, prereqs: [], state: 'unknown', notes: '',
    };
    mkdirSync(join(this.dir, 'raw'), { recursive: true });
    this.save();
  }

  /** Writes meta.json, its end moved to now: a run lasts until the last thing recorded in it. */
  save() {
    this.meta.ended = iso(Date.now());
    writeFileSync(join(this.dir, 'meta.json'), `${JSON.stringify(this.meta, null, 2)}\n`);
  }

  /**
   * One of the snapshot's commands, run at `at`: its output in raw/NNN_<slug>.txt, its line in raw/index.jsonl, its
   * parse in parsed/, and what meta.json takes from it. `ok` is whether the prompt came back. Returns the parse.
   */
  async record(cmd, at, raw, ok, source) {
    const n = this.n++;
    const file = `${String(n).padStart(3, '0')}_${slug(cmd)}.txt`;
    writeFileSync(join(this.dir, 'raw', file), `${raw}\n`);
    appendFileSync(join(this.dir, 'raw', 'index.jsonl'), `${JSON.stringify({ n, cmd, at: iso(at), source, file, ok })}\n`);
    const m = this.meta;
    if (source === 'prereq') m.prereqs.push({ cmd, ok: ok && !REJECTED.test(raw) });
    if (cmd === 'show system') m.hostname = raw.match(/^hostname\s+(\S+)/m)?.[1] ?? m.hostname;
    if (cmd === 'show system' && m.hostname) this.place(m.hostname);
    if (cmd === 'show software') m.release = raw.match(/^active\s+(\S+)/m)?.[1] ?? m.release;
    const clock = cmd === 'date-time' && raw.match(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d) UTC/);
    if (clock) [m.boxClock, m.boxClockOffsetSec] = [`${clock[1]}+00:00`, Math.round((Date.parse(`${clock[1]}Z`) - at) / 1000)];
    this.save();
    const parsed = await parse(cmd, raw);
    if (parsed.template) keep(this.dir, file, parsed);
    return parsed;
  }

  /**
   * Moves the run to the box `hostname` is, if it isn't this one, so one box's runs never land in another's. Every
   * later run of the session starts there.
   */
  place(hostname) {
    current = boxOf(hostname);
    if (current === this.meta.box) return;
    const dir = join(BOXES, current, 'runs', this.meta.run);
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(this.dir, dir);
    console.log(`${this.meta.run} is ${hostname}, not ${this.meta.box}: moved to ${dir}`);
    [this.dir, this.meta.box] = [dir, current];
  }

  /**
   * A poll, run at `at`: its parse appended to poll.jsonl, and its output too when it has no template or the parse
   * failed. A poll that reads the same as the last one of its command isn't written again. Returns the parse.
   */
  async poll(cmd, at, raw) {
    const parsed = await parse(cmd, raw);
    const line = pollLine(at, cmd, raw, parsed);
    const same = JSON.stringify(line.data ?? line.raw);
    if (this.polled[cmd] !== same) appendFileSync(join(this.dir, 'poll.jsonl'), `${JSON.stringify(line)}\n`);
    this.polled[cmd] = same;
    this.save();
    return parsed;
  }

  /**
   * Labels the run as the pull of `strand` (a wiring.csv row), marked in the UI at `at`: its answer.json, for scoring
   * only (the agent never reads it), and `state: fault`. The box can see a pull only when the strand's Rx end is one of
   * its ports, so a strand into the BERT is not `detectable`, and "insufficient evidence" is its right answer.
   */
  answer({ strand, from, to, via }, at) {
    const answer = { fault: 'pull', strand, from, to, via, markedAt: iso(at), detectable: /^\d+-\d+-\w+$/.test(to) };
    writeFileSync(join(this.dir, 'answer.json'), `${JSON.stringify(answer, null, 2)}\n`);
    this.meta.state = 'fault';
    this.save();
  }
}

/** The box's strands, from its wiring.csv: [{ strand, from, to, via, length_km, loss_db, notes }], or none. */
export function wiring(box = current) {
  return readWiring(box);
}

/** A JSON-lines file's lines, or none. */
export const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * The last state on disk, for /bridge/state while no box is connected: the latest run's snapshot, each command updated
 * by its last poll. { host, run, at, commands: { [cmd]: { at, data } | { at, error } | { at, raw } } }, times in ms;
 * raw for a command with no template, or whose poll failed to parse. Null with no runs. A run whose snapshot was cut
 * short (meta.json's `snapshot.done` < `of`: the session closed, or a prerequisite failed) is skipped, so it never hides
 * the whole run before it. A fast snapshot has only what changes, so it goes over the last full one and the fast ones
 * since. `name` picks a run instead of the latest, whole or not.
 */
export function latest(name) {
  const metas = (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : [])
    .filter((r) => (!name || r === name) && existsSync(join(RUNS_DIR, r, 'meta.json')))
    .map((r) => ({ ...JSON.parse(readFileSync(join(RUNS_DIR, r, 'meta.json'), 'utf8')), run: r })) // a folder renamed by hand keeps its old name in meta.json
    .filter((m) => name || !m.snapshot || m.snapshot.done === m.snapshot.of)
    .sort((a, b) => Date.parse(a.ended) - Date.parse(b.ended));
  if (!metas.length) return null;
  const commands = {};
  for (const meta of metas.slice(Math.max(0, metas.findLastIndex((m) => !m.snapshot?.fast)))) {
    const dir = join(RUNS_DIR, meta.run);
    for (const { cmd, at, file } of lines(join(dir, 'raw', 'index.jsonl'))) {
      const t = Date.parse(at ?? meta.ended); // a hand capture has no per-command times
      const parsed = join(dir, 'parsed', file.replace(/\.txt$/, '.json'));
      if (!existsSync(parsed)) commands[cmd] = { at: t, raw: readFileSync(join(dir, 'raw', file), 'utf8') };
      else {
        const data = JSON.parse(readFileSync(parsed, 'utf8'));
        commands[cmd] = Object.keys(data).join() === 'error' ? { at: t, error: data.error } : { at: t, data };
      }
    }
    for (const { at, cmd, data, error, raw } of lines(join(dir, 'poll.jsonl'))) {
      commands[cmd] = { at: Date.parse(at), ...(raw !== undefined ? { raw } : error ? { error } : { data }) };
    }
  }
  const meta = metas.at(-1);
  return { host: meta.host, run: meta.run, at: Date.parse(meta.ended), commands };
}

if (process.argv[1] && resolve(process.argv[1]) === here('recorder.mjs')) {
  const dir = resolve(process.argv[2] ?? '');
  let count = 0;
  for (const line of readFileSync(join(dir, 'raw', 'index.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const { cmd, file } = JSON.parse(line);
    const parsed = await parse(cmd, readFileSync(join(dir, 'raw', file), 'utf8'));
    if (!parsed.template) continue;
    keep(dir, file, parsed);
    count++;
  }
  // Polls kept as raw (no template then, or a failed parse) are parsed again too.
  const polls = [];
  for (const line of lines(join(dir, 'poll.jsonl'))) {
    if (line.raw === undefined) { polls.push(line); continue; }
    const parsed = await parse(line.cmd, line.raw);
    polls.push(parsed.template ? pollLine(line.at, line.cmd, line.raw, parsed) : line);
    if (parsed.template && !parsed.error) count++;
  }
  if (polls.length) writeFileSync(join(dir, 'poll.jsonl'), polls.map((l) => `${JSON.stringify(l)}\n`).join(''));
  console.log(`${count} outputs parsed → ${join(dir, 'parsed')} and poll.jsonl`);
}

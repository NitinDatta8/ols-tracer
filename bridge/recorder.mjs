// Recorder: writes what the bridge's poller reads into data/boxes/<box>/runs/, so a session with the box leaves its runs
// on disk without anyone capturing them. A run is one snapshot (every command in poll.json, once) and the polls after
// it, until the next snapshot. The layout and meta.json are described in docs/plans/box3-capture.md.
// On its own it parses a run's raw output again into parsed/, e.g. after a template changed:
//   node bridge/recorder.mjs data/boxes/box3/runs/run-01-healthy
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
export const PYTHON = env.PYTHON ?? here('.venv/bin/python');
/** The CLI index's commands. A command's template is named after its id. */
const COMMANDS = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'cli', 'csp', 'cli-index.source.json'), 'utf8')).commands;
/** What the box prints when it rejects a command. */
const REJECTED = /invalid|error|problem parsing/i;

const exec = promisify(execFile);

/** A time as local ISO 8601 with its offset, as meta.json has it: 2026-10-31T10:52:10-04:00. */
function iso(t) {
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

/** A run folder, named after when its snapshot started and why: <YYYYMMDD-HHMMSS>-connect or -alarms. */
export class Run {
  constructor(trigger, host) {
    const at = Date.now();
    const name = `${iso(at).slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${trigger}`;
    let run = name;
    for (let k = 2; existsSync(join(RUNS_DIR, run)); k++) run = `${name}-${k}`;
    this.dir = join(RUNS_DIR, run);
    this.n = 0;
    this.meta = {
      run, box: BOX, host, hostname: null, release: null, trigger, started: iso(at), ended: null,
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
    if (cmd === 'show software') m.release = raw.match(/^active\s+(\S+)/m)?.[1] ?? m.release;
    const clock = cmd === 'date-time' && raw.match(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d) UTC/);
    if (clock) [m.boxClock, m.boxClockOffsetSec] = [`${clock[1]}+00:00`, Math.round((Date.parse(`${clock[1]}Z`) - at) / 1000)];
    this.save();
    const parsed = await parse(cmd, raw);
    if (parsed.template) keep(this.dir, file, parsed);
    return parsed;
  }

  /** A poll, run at `at`: its parse appended to poll.jsonl, and its output too when it has no template or the parse failed. Returns the parse. */
  async poll(cmd, at, raw) {
    const parsed = await parse(cmd, raw);
    appendFileSync(join(this.dir, 'poll.jsonl'), `${JSON.stringify(pollLine(at, cmd, raw, parsed))}\n`);
    this.save();
    return parsed;
  }
}

/** A JSON-lines file's lines, or none. */
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * The last state on disk, for /bridge/state while no box is connected: the latest run's snapshot, each command updated
 * by its last poll. { host, run, at, commands: { [cmd]: { at, data } | { at, error } | { at, raw } } }, times in ms;
 * raw for a command with no template, or whose poll failed to parse. Null with no runs. `name` picks a run instead of the latest.
 */
export function latest(name) {
  const metas = (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : [])
    .filter((r) => (!name || r === name) && existsSync(join(RUNS_DIR, r, 'meta.json')))
    .map((r) => JSON.parse(readFileSync(join(RUNS_DIR, r, 'meta.json'), 'utf8')));
  const meta = metas.sort((a, b) => Date.parse(a.ended) - Date.parse(b.ended)).at(-1);
  if (!meta) return null;
  const dir = join(RUNS_DIR, meta.run);
  const commands = {};
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

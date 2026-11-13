// Procedures: the box workflows people did by hand (an ops MOP each), as steps the bridge runs on a shell of its own on
// the box's session. Defined once in catalog/common/procedures.json, kept by hand, where a stream's
// catalog/<stream>/procedures.json overrides one by id. Tiered by risk: a read procedure only reads, a reversible one
// undoes itself (`restore`), and a change waits for a person to Approve it in the tracer UI. The runner types each line
// once, waits on the box's own state between lines, and records every line in the session's current run (source
// procedure). The model, and why, is in docs/procedures-plan.md#procedures.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillStep } from './fill.mjs';
import { accepted, iso } from './recorder.mjs';

/** Where the definitions are read from: catalog/, or BRIDGE_CATALOG (the tests' own). */
const CATALOG = process.env.BRIDGE_CATALOG ?? fileURLToPath(new URL('../catalog', import.meta.url));
const TIERS = ['read', 'reversible', 'change'];
const LEVELS = ['chassis', 'card', 'port'];
/** A param's value: one word of printable text, so it can never add a second command to a line. */
const WORD = /^[\x21-\x7e]{1,64}$/;
/** A step's line: one line of printable text, with nothing around it. */
const LINE = /^[\x21-\x7e](?:[\x20-\x7e]{0,298}[\x21-\x7e])?$/;
const isShow = (line) => /^show(\s|$)/.test(line);
/** Lines that would move the shell to another mode: the runner enters and leaves configure itself, and nothing else. */
const MODES = /^(configure|exit|end|\^\^\^|bash|kgdb|cliclient)(\s|$)/;
/**
 * The runner's shell is set up as the poller's, so nothing pages or wraps. One that may change the box also turns the
 * CLI's confirmation prompts off, which `cli confirmation-required` does for that CLI session only.
 */
const SETUP = ['configure', 'set cli length 0', 'set cli width 1024'];
const QUIET = 'set cli confirmation-required no';

/**
 * The named checks a procedure's `pre`, `wait` and `verify` use, each { shows(args), test(out, args) }: `shows` lists
 * the show lines it reads, and `test` judges what they printed, `out[line]` being { raw, data } (`data` the parse,
 * when the command has a template), as { ok: true } or { ok: false, why }. Small functions over the box's own output,
 * not a language. They come with the procedures that use them; a test may add its own.
 */
export const CHECKS = {};

const words = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && WORD.test(x));
const seconds = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const holes = (line) => [...line.matchAll(/\{(\w+)(?:\*\d+)?\}/g)].map((m) => m[1]);

/** Why `p` is no procedure definition (docs/procedures-plan.md#procedures), or null when it is one. */
function problem(p) {
  if (!p || typeof p !== 'object') return 'not an object';
  const known = ['id', 'label', 'level', 'tier', 'params', 'pre', 'steps', 'verify', 'restore'];
  const extra = Object.keys(p).find((k) => !known.includes(k));
  if (extra) return `${extra}: not a field of a procedure`;
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(p.id)) return 'id: lowercase letters, digits and -';
  if (typeof p.label !== 'string' || !p.label.trim()) return 'label: missing';
  if (!LEVELS.includes(p.level)) return `level: one of ${LEVELS.join(', ')}`;
  if (!TIERS.includes(p.tier)) return `tier: one of ${TIERS.join(', ')}`;
  const params = p.params ?? {};
  if (typeof params !== 'object' || Array.isArray(params)) return 'params: an object';
  for (const [name, spec] of Object.entries(params)) {
    if (!/^\w{1,40}$/.test(name) || !spec || typeof spec !== 'object') return `params.${name}: { enum } or { pattern }`;
    if (Object.keys(spec).some((k) => !['enum', 'pattern', 'default', 'label'].includes(k))) return `params.${name}: only enum, pattern, default and label`;
    if ((spec.enum === undefined) === (spec.pattern === undefined)) return `params.${name}: an enum or a pattern, one of them`;
    if (spec.enum !== undefined && !words(spec.enum)) return `params.${name}.enum: a list of words`;
    if (spec.pattern !== undefined) {
      try { new RegExp(spec.pattern); } catch { return `params.${name}.pattern: not a regex`; }
    }
    if (spec.default !== undefined && !fits(spec, spec.default)) return `params.${name}.default: not one of its values`;
  }
  const check = (name, where) => (typeof name === 'string' && Object.hasOwn(CHECKS, name) ? null : `${where}: ${name} is not a check`);
  const fills = (line, where) => holes(line).map((h) => (Object.hasOwn(params, h) ? null : `${where}: {${h}} is not a param`)).find(Boolean) ?? null;
  const line = (v, where) => (typeof v !== 'string' || !LINE.test(v) ? `${where}: one line of printable text`
    : MODES.test(v) ? `${where}: the runner enters and leaves configure itself, and no line may change its mode` : fills(v, where));
  if (!Array.isArray(p.pre ?? [])) return 'pre: a list of checks';
  for (const name of p.pre ?? []) { const why = check(name, 'pre'); if (why) return why; }
  if (p.verify !== undefined) { const why = check(p.verify, 'verify'); if (why) return why; }
  if (!Array.isArray(p.steps) || (!p.steps.length && p.verify === undefined)) return 'steps: a list, or none with a verify';
  for (const [i, s] of p.steps.entries()) {
    const at = `steps[${i}]`;
    if (!s || typeof s !== 'object') return `${at}: { send } or { wait }`;
    if (s.send !== undefined) {
      if (Object.keys(s).some((k) => !['send', 'drops', 'timeout'].includes(k))) return `${at}: only send, drops and timeout`;
      const bad = line(s.send, `${at}.send`);
      if (bad) return bad;
      if (p.tier === 'read' && !isShow(s.send)) return `${at}.send: a read procedure sends only show lines`;
      if (s.drops !== undefined && s.drops !== true) return `${at}.drops: true or left out`;
      if (s.drops && p.tier !== 'change') return `${at}.drops: only a change may drop the session`;
      if (s.drops && p.steps[i + 1]?.wait === undefined) return `${at}: a step that drops the session is followed by a wait for the box`;
      if (s.timeout !== undefined && !seconds(s.timeout)) return `${at}.timeout: seconds`;
    } else if (s.wait !== undefined) {
      if (Object.keys(s).some((k) => !['wait', 'args', 'every', 'timeout'].includes(k))) return `${at}: only wait, args, every and timeout`;
      const why = check(s.wait, `${at}.wait`);
      if (why) return why;
      if (s.args !== undefined && (typeof s.args !== 'object' || Array.isArray(s.args) || !Object.values(s.args).every((v) => typeof v === 'string'))) return `${at}.args: an object of strings`;
      for (const v of Object.values(s.args ?? {})) { const w = fills(v, `${at}.args`); if (w) return w; }
      if (s.every !== undefined && !seconds(s.every)) return `${at}.every: seconds`;
      if (!seconds(s.timeout)) return `${at}.timeout: seconds`;
    } else return `${at}: { send } or { wait }`;
  }
  if ((p.tier === 'reversible') !== (p.restore !== undefined)) return 'restore: a reversible procedure has one, and only it';
  if (!Array.isArray(p.restore ?? [])) return 'restore: a list of { send }';
  for (const [i, s] of (p.restore ?? []).entries()) {
    if (!s || Object.keys(s).join() !== 'send') return `restore[${i}]: { send }`;
    const why = line(s.send, `restore[${i}].send`);
    if (why) return why;
  }
  if (p.tier === 'reversible' && !p.restore.length) return 'restore: at least one line';
  return null;
}

/** Whether `v` is one of the values a param takes. */
function fits(spec, v) {
  if (typeof v !== 'string' || !WORD.test(v)) return false;
  return spec.enum ? spec.enum.includes(v) : new RegExp(`^(?:${spec.pattern})$`).test(v);
}

/** One folder's procedures.json, each definition checked: none when it has no such file. Throws with why on a bad one. */
function read(folder) {
  const f = join(CATALOG, folder, 'procedures.json');
  if (!existsSync(f)) return [];
  const { procedures } = JSON.parse(readFileSync(f, 'utf8'));
  if (!Array.isArray(procedures)) throw new Error(`${folder}/procedures.json: no procedures list`);
  const ids = new Set();
  for (const p of procedures) {
    const why = problem(p) ?? (ids.has(p.id) ? 'a second definition of it' : null);
    if (why) throw new Error(`${folder}/procedures.json: ${p?.id ?? 'a procedure'}: ${why}`);
    ids.add(p.id);
  }
  return procedures;
}

/** The procedures of `stream` (csp): common/'s, each replaced by the stream's own of the same id, then the stream's others. */
export function definitions(stream) {
  const common = read('common');
  const own = new Map((typeof stream === 'string' && /^[a-z0-9]+$/.test(stream) && stream !== 'common' ? read(stream) : []).map((p) => [p.id, p]));
  return [...common.map((p) => own.get(p.id) ?? p), ...[...own.values()].filter((p) => !common.some((c) => c.id === p.id))];
}

/** The params of `def` from `given` (a request's JSON), each checked, defaults filled in: { params } or { why }. */
export function paramsOf(def, given = {}) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { why: 'params: a JSON object' };
  const specs = def.params ?? {};
  const extra = Object.keys(given).find((k) => !Object.hasOwn(specs, k));
  if (extra) return { why: `${extra}: not a param of ${def.id}` };
  const params = {};
  for (const [name, spec] of Object.entries(specs)) {
    const v = typeof given[name] === 'number' && Number.isFinite(given[name]) ? String(given[name]) : given[name] ?? spec.default;
    if (v === undefined) return { why: `${name}: missing` };
    if (!fits(spec, v)) return { why: `${name}: ${spec.enum ? `one of ${spec.enum.join(', ')}` : `one word matching ${spec.pattern}`}` };
    params[name] = v;
  }
  return { params };
}

/** A wait's args, filled in from the params: the procedure's params, overridden by the step's own. */
const argsOf = (s, params) => ({ ...params, ...Object.fromEntries(Object.entries(s.args ?? {}).map(([k, v]) => [k, fillStep(v, params)])) });

/**
 * What `def` does with `params`, every line filled in, as the panel and Approve show it: the checks first (each with the
 * shows it reads), each step's line or wait, the verify and the restore.
 */
export function planOf(def, params) {
  const reads = (name, args) => ({ check: name, shows: CHECKS[name].shows(args) });
  return {
    pre: (def.pre ?? []).map((name) => reads(name, params)),
    steps: def.steps.map((s) => (s.send !== undefined
      ? { send: fillStep(s.send, params), ...(s.drops ? { drops: true } : {}), ...(s.timeout ? { timeout: s.timeout } : {}) }
      : { wait: s.wait, shows: CHECKS[s.wait].shows(argsOf(s, params)), args: argsOf(s, params), every: s.every ?? 10, timeout: s.timeout })),
    verify: def.verify === undefined ? null : reads(def.verify, params),
    restore: (def.restore ?? []).map((s) => fillStep(s.send, params)),
  };
}

/** Why a procedure stopped: it failed (`why`), was cancelled, or its shell closed under it (`Dropped`). */
class Stop extends Error {
  constructor(state, why) { super(why); this.state = state; }
}
class Dropped extends Error {}

/**
 * One procedure asked for on a box: `def` with `params` (checked by paramsOf), asked by `by`. A change waits, pending,
 * for approve() until `pendingMs` has passed; the others start at once. `timeout` is how long a line may take, in ms,
 * unless its step says. `hooks` is what it needs of the bridge's session with the box:
 * - `connected()`: whether the session is connected now;
 * - `shell()`: a shell of its own on the session's connection, logged in, as a worker (shells.mjs), or null;
 * - `epoch()`: how many connect snapshots the session has taken whole so far, so a new one says the box is back;
 * - `snapshot()`: a fast snapshot into a new `procedure` run, answered with that Run, or null if the session closed;
 * - `record(line, at, raw, ok)`: the line recorded in the session's current run, answered with { run, parsed };
 * - `end()`: called once when it is over, to let go of the session.
 * `status()` is what GET /procedure shows; `procedure.json`, in its procedure run, has that and the definition.
 */
export class Procedure {
  constructor(def, params, { by, hooks, timeout, pendingMs }) {
    Object.assign(this, { def, params, by, hooks, timeout, pendingMs });
    this.ref = randomUUID();
    this.plan = planOf(def, params);
    this.state = def.tier === 'change' ? 'pending' : 'running';
    this.askedAt = iso(Date.now());
    this.log = []; // what it did, in order: { at, step, line?, check?, ok, why? }
    this.sent = []; // the lines that changed the box, as the box took them
    this.runs = []; // the runs it recorded into, its procedure run first
    this.waiting = null; // the wait going on: { what, tries, why, until }, `what` a check or the box coming back
    this.wake = () => {}; // cuts a wait short, for cancel
  }

  get over() { return !['pending', 'running'].includes(this.state); }

  /** Starts it, or has it wait for approve(): a pending change expires once `pendingMs` has passed. */
  start() {
    if (this.state === 'running') return void this.run();
    this.expiry = setTimeout(() => {
      if (this.state !== 'pending') return;
      const ms = this.pendingMs;
      this.finish('expired', `nobody approved it within ${ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${ms / 1000} s`}`);
    }, this.pendingMs);
  }

  /** A person approved it from the tracer UI (the bridge checked how): it runs. */
  approve(by) {
    clearTimeout(this.expiry);
    Object.assign(this, { approvedBy: by, approvedAt: iso(Date.now()), state: 'running' });
    void this.run();
  }

  /** Stops it: a pending one at once; a running one at its next step, or at once in a wait; not once it is winding up. */
  cancel(by) {
    if (this.winding) return;
    this.cancelledBy = by;
    if (this.state === 'pending') {
      clearTimeout(this.expiry);
      return this.finish('cancelled', `cancelled by ${by}`);
    }
    this.wake();
  }

  status() {
    const { def, ref, params, plan, state, by, askedAt, approvedBy, approvedAt, startedAt, endedAt, why, log, sent, runs, waiting } = this;
    return {
      id: def.id, label: def.label, tier: def.tier, ref, params, plan, state, by, askedAt,
      ...(approvedBy ? { approvedBy, approvedAt } : {}), ...(this.cancelledBy ? { cancelledBy: this.cancelledBy } : {}),
      startedAt: startedAt ?? null, endedAt: endedAt ?? null, why: why ?? null, waiting, log, sent, runs,
    };
  }

  /** Writes procedure.json into its procedure run: how far it got, so a bridge restart that abandons it leaves that. */
  save() {
    if (this.home) writeFileSync(join(this.home.dir, 'procedure.json'), `${JSON.stringify({ ...this.status(), definition: this.def }, null, 2)}\n`);
  }

  note(entry) {
    this.log.push({ at: iso(Date.now()), ...entry });
    this.save();
  }

  /** Over: its state and why, saved, and the session let go of; once. */
  finish(state, why) {
    if (this.endedAt) return;
    Object.assign(this, { state, why: why ?? null, endedAt: iso(Date.now()), waiting: null });
    this.save();
    this.hooks.end();
  }

  /** Stops it at a step's boundary if it was cancelled. */
  boundary() {
    if (this.cancelledBy) throw new Stop('cancelled', `cancelled by ${this.cancelledBy}`);
  }

  /** Waits `ms`, or less if it is cancelled meanwhile. */
  sleep(ms) {
    return new Promise((done) => {
      const t = setTimeout(done, ms);
      this.wake = () => { clearTimeout(t); done(); };
    }).finally(() => { this.wake = () => {}; });
  }

  /** A shell of its own, set up: no paging and, unless it only reads, no confirmation prompts. */
  async open() {
    const w = await this.hooks.shell();
    if (!w) throw new Stop('failed', 'no shell of its own on the box');
    this.w = w;
    this.configure = false;
    this.epoch = this.hooks.epoch();
    for (const line of [...SETUP, ...(this.def.tier === 'read' ? [] : [QUIET]), 'exit']) {
      const r = await this.type(line);
      if (!accepted(r)) throw new Stop('failed', `its shell could not be set up: "${line}" printed ${r.raw.trim() || 'nothing'}`);
    }
  }

  /** Types `line` on its shell and records it, in the session's current run. Throws Dropped if the shell closed. */
  async type(line, ms = this.timeout) {
    const at = Date.now();
    const out = await this.w.output(line, ms);
    const { run, parsed } = await this.hooks.record(line, at, out.raw, out.ok);
    if (!this.runs.includes(run)) this.runs.push(run);
    if (!this.w.open) throw new Dropped(line);
    if (['configure', 'exit'].includes(line) && accepted(out)) this.configure = line === 'configure';
    return { ...out, parsed };
  }

  /** Puts its shell in configure for a line that changes the box, else at the operational prompt. */
  async mode(configure) {
    if (this.configure === configure) return;
    const line = configure ? 'configure' : 'exit';
    const r = await this.type(line);
    if (!accepted(r)) throw new Stop('failed', `"${line}" printed ${r.raw.trim() || 'nothing'}`);
  }

  /** Runs check `name` with `args`: its shows on its shell, then its test. */
  async check(name, args) {
    const c = CHECKS[name];
    const out = {};
    for (const line of c.shows(args)) {
      if (!isShow(line)) throw new Stop('failed', `${name} would type ${line}: a check only reads`);
      await this.mode(false);
      const r = await this.type(line);
      if (!r.ok) return { ok: false, why: `${line}: no prompt within ${this.timeout / 1000} s` };
      out[line] = { raw: r.raw, data: r.parsed?.data };
    }
    return c.test(out, args);
  }

  /** A step's line, typed once: in configure if it changes the box, where the box has to take it. */
  async send(step) {
    const ms = (step.timeout ?? this.timeout / 1000) * 1000;
    const change = !isShow(step.send);
    await this.mode(change);
    if (change) this.touched = true;
    let r;
    try {
      r = await this.type(step.send, ms);
    } catch (e) {
      if (e instanceof Dropped && change) this.sent.push(step.send); // typed as the session dropped: the box may have taken it
      throw e;
    }
    if (!r.ok) throw new Stop('failed', `${step.send}: no prompt within ${ms / 1000} s`);
    if (change && !accepted(r)) throw new Stop('failed', `${step.send}: the box refused it: ${r.raw.trim()}`);
    if (change) this.sent.push(step.send);
    this.note({ step: 'send', line: step.send, ok: true });
  }

  /** A wait: its check every `every` s until it passes, for `timeout` s at most. */
  async wait(step) {
    const until = Date.now() + step.timeout * 1000;
    for (let tries = 1; ; tries++) {
      const r = await this.check(step.wait, step.args);
      if (r.ok) return this.note({ step: 'wait', check: step.wait, ok: true, tries });
      this.boundary();
      if (Date.now() + step.every * 1000 > until) throw new Stop('failed', `${step.wait}: still not so after ${step.timeout} s: ${r.why}`);
      this.waiting = { what: step.wait, tries, why: r.why ?? null, until: iso(until) };
      await this.sleep(step.every * 1000);
      this.boundary();
    }
  }

  /**
   * After the session dropped where it was expected to (`drop`, from a step that drops it): waits until the box is back
   * and its connect snapshot is whole, so its shell is never in configure while the poller sets up, then opens it again.
   */
  async back(drop) {
    this.note({ step: 'drop', line: drop.line, ok: true });
    while (!(this.hooks.epoch() > this.epoch && this.hooks.connected())) {
      this.boundary();
      if (Date.now() >= drop.until) throw new Stop('failed', `the box was not back within ${drop.timeout} s of ${drop.line}: check the box`);
      this.waiting = { what: 'back', tries: 0, why: `the box is coming back from ${drop.line}`, until: iso(drop.until) };
      await this.sleep(1000);
    }
    this.waiting = null;
    this.note({ step: 'back', ok: true });
    await this.open();
  }

  /**
   * Runs it, with a fast snapshot first, into a procedure run that keeps its procedure.json, and one after a reversible
   * or change: its checks, its steps in order, its verify. A step that drops the session expects it, and while it reads
   * (that step, or a wait or the verify after it) the runner waits for the box to come back and goes on: a wait or the
   * verify runs again, a line sent never is. A drop anywhere else stops it, saying to check the box. However it ends, a
   * reversible one restores and the shell leaves configure.
   */
  async run() {
    this.startedAt = iso(Date.now());
    let state = 'done';
    let why = null;
    try {
      this.home = await this.hooks.snapshot();
      if (!this.home) throw new Stop('failed', 'the session closed before it began');
      this.runs.push(this.home.meta.run);
      this.save();
      await this.open();
      let drop = null; // the step that is to drop the session, until the box is back
      const reading = (fn) => async () => {
        try {
          return await fn();
        } catch (e) {
          if (!(e instanceof Dropped) || !drop) throw e;
          await this.back(drop);
          drop = null;
          return reading(fn)();
        }
      };
      for (const name of this.def.pre ?? []) {
        this.boundary();
        const r = await this.check(name, this.params);
        this.note({ step: 'pre', check: name, ok: r.ok, ...(r.ok ? {} : { why: r.why }) });
        if (!r.ok) throw new Stop('failed', `${name}: ${r.why}`);
      }
      for (const step of this.plan.steps) {
        this.boundary();
        if (step.send === undefined) {
          await reading(() => this.wait(step))();
          continue;
        }
        if (step.drops) drop = { line: step.send, timeout: step.timeout ?? this.timeout / 1000, until: Date.now() + (step.timeout ?? this.timeout / 1000) * 1000 };
        try {
          await this.send(step);
        } catch (e) {
          // Only a drop as its own line is typed is the one it expects: not one while the shell goes into configure.
          if (!(e instanceof Dropped) || !step.drops || e.message !== step.send) throw e;
          await this.back(drop);
          drop = null;
        }
      }
      if (this.plan.verify) {
        this.boundary();
        const r = await reading(() => this.check(this.plan.verify.check, this.params))();
        this.note({ step: 'verify', check: this.plan.verify.check, ok: r.ok, ...(r.ok ? {} : { why: r.why }) });
        if (!r.ok) throw new Stop('failed', `${this.plan.verify.check}: ${r.why}`);
      }
    } catch (e) {
      [state, why] = e instanceof Stop ? [e.state, e.message]
        : e instanceof Dropped ? ['failed', `the box dropped the session at ${e.message}: check the box`]
          : ['failed', e.message];
    }
    this.waiting = null;
    this.winding = true;
    why = await this.wind(state, why);
    this.finish(state, why);
  }

  /**
   * However it ended: a reversible one's restore lines, each typed once, and its shell out of configure and closed. A
   * change that stopped says what it left on the box. Then a fast snapshot of the box after a reversible or change.
   * Returns why it ended, with what restoring or leaving found.
   */
  async wind(state, why) {
    const notes = why ? [why] : [];
    if (this.def.tier === 'reversible' && this.touched) {
      const left = [];
      for (const line of this.plan.restore) {
        try {
          if (!this.w?.open) throw new Dropped(line);
          await this.mode(true);
          const r = await this.type(line);
          if (!r.ok || !accepted(r)) throw new Error(r.raw.trim() || 'no prompt');
          this.note({ step: 'restore', line, ok: true });
        } catch (e) {
          left.push(line);
          this.note({ step: 'restore', line, ok: false, why: e instanceof Dropped ? 'no shell' : e.message });
        }
      }
      if (left.length) notes.push(`Not restored: ${left.join('; ')}: check the box`);
    } else if (this.def.tier === 'change' && state !== 'done' && this.sent.length) notes.push(`Left on the box: ${this.sent.join('; ')}`);
    try {
      if (this.w?.open) await this.mode(false);
    } catch { notes.push('Its shell may be left in configure'); }
    this.w?.ch.close();
    if (this.def.tier !== 'read' && this.home && this.hooks.connected()) {
      const after = await this.hooks.snapshot();
      if (after && !this.runs.includes(after.meta.run)) this.runs.push(after.meta.run);
    }
    return notes.join('. ') || null;
  }
}

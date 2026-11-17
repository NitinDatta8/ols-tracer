// The procedures a box offers (bridge/procedures.mjs, through GET /bridge/procedure), for the physical view's
// Procedures panel and its right-click menu: which can be asked for where, the params each starts with, and what it
// will type.
import { fillStep, fits } from '../bridge/fill.mjs';

export type Tier = 'read' | 'reversible' | 'change';
export type Level = 'chassis' | 'card' | 'port';
/** A param: one word, one of its `enum`'s values or matching its `pattern`; `example` a value shown as a hint. */
export interface ParamSpec { enum?: string[]; pattern?: string; default?: string; label?: string; example?: string }
export type Step = { send: string; drops?: boolean; timeout?: number } | { wait: string; args?: Record<string, string>; every?: number; timeout: number };
/** A procedure as catalog procedures.json defines it. */
export interface ProcedureDef {
  id: string; label: string; level: Level; tier: Tier; params?: Record<string, ParamSpec>;
  pre?: string[]; steps: Step[]; verify?: string; restore?: { send: string }[];
}
/** A check as the bridge will run it: its name, and the shows it reads. */
export interface Reads { check: string; shows: string[] }
/** A step as the bridge will run it, every line filled in, and a wait with the shows its check reads. */
export type Planned = { send: string; drops?: boolean; timeout?: number } | { wait: string; shows: string[]; every: number; timeout: number };
/** One asked for on a box, as the bridge tells it: waiting for Approve, running, or over. */
export interface Asked {
  id: string; label: string; tier: Tier; ref: string; params: Record<string, string>;
  plan: { pre: Reads[]; before?: Reads[]; steps: Planned[]; verify: Reads | null; restore: string[] };
  state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'expired';
  by: string; askedAt: string; approvedBy?: string; approvedAt?: string; cancelledBy?: string;
  startedAt: string | null; endedAt: string | null; why: string | null;
  waiting: { what: string; tries: number; why: string | null; until: string } | null;
  log: { at: string; step: string; line?: string; check?: string; ok: boolean; why?: string; tries?: number }[];
  sent: string[]; runs: string[];
}
/** GET /bridge/procedure: the box's procedures, for its stream, and the one asked for on its session now, or last. */
export interface BoxProcedures { host: string; stream: string | null; procedures: ProcedureDef[]; current: Asked | null }

/** Whether `p` is still to end: waiting for Approve, or running. */
export const active = (p?: Asked | null): p is Asked => p?.state === 'pending' || p?.state === 'running';

/** A procedure of the box's, and `why` it can't be asked for here and now, if it can't. */
export interface ProcedureItem { def: ProcedureDef; why?: string }

/** Why `def` isn't for `level` (the chassis, or a card), and where to go for it; undefined when it is. */
export const levelWhy = (def: ProcedureDef, level: Level) => (def.level === level ? undefined
  : def.level === 'chassis' ? 'A chassis procedure: go back to the chassis for it' : `A ${def.level} procedure: open the ${def.level} for it`);

/**
 * What the view offers at `level` (the chassis, or a card shown or right-clicked): each of the box's procedures, greyed
 * out for test equipment, a box not connected, one already waiting or running (one at a time), or another level.
 */
export function procedureItems(list: BoxProcedures | null, { level, tester, connected }: { level: Level; tester: boolean; connected: boolean }): ProcedureItem[] {
  const now = list?.current;
  return (list?.procedures ?? []).map((def) => {
    const why = tester ? 'Test equipment: no procedures'
      : !connected ? 'Connect to the box first'
        : active(now) ? `${now.label} is ${now.state === 'pending' ? 'waiting for Approve' : 'running'}: one at a time`
          : levelWhy(def, level);
    return why ? { def, why } : { def };
  });
}

/** The params `def` starts with where the view is: each one's default, and `card` the card shown (1-7). */
export function startParams(def: ProcedureDef, { chassis, slot }: { chassis: number; slot?: string | null }): Record<string, string> {
  const here: Record<string, string> = slot ? { card: `${chassis}-${slot}` } : {};
  return Object.fromEntries(Object.entries(def.params ?? {}).map(([name, spec]) => [name, here[name] ?? spec.default ?? '']));
}

/** Why `v` is not a value of param `spec`, as the bridge would refuse it; null when it is one. */
export function paramProblem(spec: ParamSpec, v: string) {
  if (fits(spec, v)) return null;
  return spec.enum ? `one of ${spec.enum.join(', ')}` : `one word matching ${spec.pattern}`;
}

/** How the panel names each tier, over its procedures in the list. */
export const TIERS: Record<Tier, string> = { read: 'Read: only looks', reversible: 'Reversible: undoes itself', change: 'Change: a person approves it' };

/** `s` seconds as a person reads a timeout: 30 s, 5 min, 2 h. */
export const span = (s: number) => (s >= 3600 && s % 3600 === 0 ? `${s / 3600} h` : s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`);

/**
 * One line of a procedure's steps as the panel lists them: a check before it begins (`pre`), what a wait reads before
 * it begins (`before`), a line it types (`send`), a wait, its verify, or a line that undoes it (`restore`); and how far
 * it got there.
 */
export interface Row {
  kind: 'pre' | 'before' | 'send' | 'wait' | 'verify' | 'restore';
  /** What it does, in words. */
  what: string;
  /** The line it types, or the shows a check reads; null for a line with a param missing, or a check not asked yet. */
  code: string | null;
  /** How often a wait looks and for how long, or that a line drops the session. */
  more?: string;
  state: 'todo' | 'now' | 'ok' | 'bad';
  /** When it passed or failed. */
  at?: string;
  /** What happened on the way: a wait's tries, the session dropping and coming back, why a check failed. */
  note?: string;
}
const row = (kind: Row['kind'], what: string, code: string | null, more?: string): Row => ({ kind, what, code, ...(more ? { more } : {}), state: 'todo' });
const waits = (every: number, timeout: number) => `every ${span(every)}, up to ${span(timeout)}`;
const DROPS = 'drops the session';

/** What `def` will do with `params`, before it is asked for: each line filled in (null while a param is missing). */
export const draft = (def: ProcedureDef, params: Record<string, string>): Row[] => [
  ...(def.pre ?? []).map((c) => row('pre', `check ${c}`, null)),
  ...def.steps.map((s) => ('send' in s ? row('send', 'type', fillStep(s.send, params), s.drops ? DROPS : undefined) : row('wait', `wait for ${s.wait}`, null, waits(s.every ?? 10, s.timeout)))),
  ...(def.verify ? [row('verify', `verify ${def.verify}`, null)] : []),
  ...(def.restore ?? []).map((s) => row('restore', 'undo', fillStep(s.send, params))),
];

/**
 * What one asked for did, step by step: its plan as rows, each marked from its log, the next one `now` while it runs,
 * or `bad` where it stopped when it failed; and what its verify found. A step that drops the session as it is typed
 * logs only the drop, and a drop in a wait after it is noted on that wait.
 */
export function timeline(p: Asked): { rows: Row[]; findings: string[] } {
  const shows = (c: Reads) => c.shows.join('; ');
  const rows = [
    ...p.plan.pre.map((c) => row('pre', `check ${c.check}`, shows(c))),
    ...(p.plan.before ?? []).map((c) => row('before', `read ${c.check} before it begins`, shows(c))),
    ...p.plan.steps.map((s) => ('send' in s ? row('send', 'type', s.send, s.drops ? DROPS : undefined) : row('wait', `wait for ${s.wait}`, s.shows.join('; '), waits(s.every, s.timeout)))),
    ...(p.plan.verify ? [row('verify', `verify ${p.plan.verify.check}`, shows(p.plan.verify))] : []),
    ...p.plan.restore.map((l) => row('restore', 'undo', l)),
  ];
  const steps = rows.filter((r) => r.kind === 'send' || r.kind === 'wait');
  const next = { pre: 0, before: 0, steps: 0, verify: 0, restore: 0 };
  const add = (r: Row | undefined, note: string) => { if (r) r.note = r.note ? `${r.note}; ${note}` : note; };
  const mark = (r: Row | undefined, e: Asked['log'][number], note?: string) => {
    if (!r) return;
    Object.assign(r, { state: e.ok ? 'ok' : 'bad', at: e.at });
    const n = note ?? e.why ?? (e.tries && e.tries > 1 ? `passed on try ${e.tries}` : undefined);
    if (n) add(r, n);
  };
  const findings: string[] = [];
  let dropped: Row | undefined;
  for (const e of p.log) {
    if (e.step === 'send' || e.step === 'wait') mark(steps[next.steps++], e);
    else if (e.step === 'pre' || e.step === 'before' || e.step === 'verify' || e.step === 'restore') mark(rows.filter((r) => r.kind === e.step)[next[e.step]++], e);
    else if (e.step === 'finding') findings.push(e.why ?? '');
    else if (e.step === 'drop') {
      dropped = steps[next.steps];
      if (dropped?.kind === 'send' && dropped.code === e.line) mark(steps[next.steps++], e, 'the box dropped the session, as expected');
      else add(dropped, 'the box dropped the session');
    } else if (e.step === 'back') add(dropped, 'it came back');
  }
  const todo = rows.find((r) => r.state === 'todo' && r.kind !== 'restore');
  if (todo && p.state === 'running') todo.state = 'now';
  if (todo && p.state === 'failed' && !rows.some((r) => r.state === 'bad')) todo.state = 'bad';
  return { rows, findings };
}

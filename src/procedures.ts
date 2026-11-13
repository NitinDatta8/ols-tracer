// The procedures a box offers (bridge/procedures.mjs, through GET /bridge/procedure), for the physical view's
// Procedures panel and its right-click menu: which can be asked for where, the params each starts with, and what it
// will type.
import { fillStep, fits } from '../bridge/fill.mjs';

export type Tier = 'read' | 'reversible' | 'change';
export type Level = 'chassis' | 'card' | 'port';
/** A param: one word, one of its `enum`'s values or matching its `pattern`. */
export interface ParamSpec { enum?: string[]; pattern?: string; default?: string; label?: string }
export type Step = { send: string; drops?: boolean; timeout?: number } | { wait: string; args?: Record<string, string>; every?: number; timeout: number };
/** A procedure as catalog procedures.json defines it. */
export interface ProcedureDef {
  id: string; label: string; level: Level; tier: Tier; params?: Record<string, ParamSpec>;
  pre?: string[]; steps: Step[]; verify?: string; restore?: { send: string }[];
}
/** A step as the bridge will run it, every line filled in, and a wait with the shows its check reads. */
export type Planned = { send: string; drops?: boolean; timeout?: number } | { wait: string; shows: string[]; every: number; timeout: number };
/** One asked for on a box, as the bridge tells it: waiting for Approve, running, or over. */
export interface Asked {
  id: string; label: string; tier: Tier; ref: string; params: Record<string, string>;
  plan: { pre: { check: string; shows: string[] }[]; steps: Planned[]; verify: { check: string; shows: string[] } | null; restore: string[] };
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

/** What `def` will type with `params`: each step's line filled in (null while a param is missing) or its wait. */
export const stepsOf = (def: ProcedureDef, params: Record<string, string>) => def.steps.map((s) => ('send' in s
  ? { send: fillStep(s.send, params), drops: !!s.drops }
  : { wait: s.wait, every: s.every ?? 10, timeout: s.timeout }));

/** The lines a reversible `def` types to undo itself, filled in. */
export const restoreOf = (def: ProcedureDef, params: Record<string, string>) => (def.restore ?? []).map((s) => fillStep(s.send, params));

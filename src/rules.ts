import { byId, endAt } from './catalog';
import { canLoopback } from './ports';
import type { Alarm, Catalog, ChassisDef, Device, End, Link, Topology } from './types';

/** Look up the catalog card, port and pluggable at an endpoint. Any of them may be missing; `fixed` = built-in Tx/Rx, no pluggable. */
export function resolve(t: Topology, cat: Catalog, e: End) {
  const slot = byId(t.devices, e.device)?.slots[e.slot];
  const card = byId(cat.linecards, slot?.linecard);
  const port = byId(card?.ports ?? [], e.port);
  const pluggable = port && byId(cat.pluggables, slot?.ports[e.port]?.pluggable);
  return { card, port, pluggable, fixed: !!port && !port.allowedPluggables.length };
}

/** Can the port take a fiber: it has a pluggable or fixed Tx/Rx. */
export const fiberable = (t: Topology, cat: Catalog, e: End) => {
  const { pluggable, fixed } = resolve(t, cat, e);
  return !!pluggable || fixed;
};

/** Port path for labels, e.g. Site-A/2/L1. */
export const path = (t: Topology, e: End) => `${byId(t.devices, e.device)?.name ?? e.device}/${e.slot}/${e.port}`;

/** Does the link end at `at`? Fields left out match anything. */
export const touches = (l: Link, at: Partial<End>) =>
  [l.a, l.b].some((e) => (Object.keys(at) as (keyof End)[]).every((k) => at[k] === undefined || e[k] === at[k]));

export const sameEnd = (a: End, b: End) => a.device === b.device && a.slot === b.slot && a.port === b.port;

/** The fibers on a port: out of its Tx, into its Rx (the same one for a loopback). */
export const fibersAt = (t: Topology, e: End) => ({ tx: t.links.find((l) => sameEnd(l.a, e)), rx: t.links.find((l) => sameEnd(l.b, e)) });

/** The slots a card of `width` takes from `slotId` rightwards, or null if they run off the row. */
export function span(chassis: ChassisDef, slotId: string, width = 1) {
  const i = chassis.slots.findIndex((s) => s.id === slotId);
  const columns = chassis.columns ?? chassis.slots.length;
  return i < 0 || (i % columns) + width > columns ? null : chassis.slots.slice(i, i + width).map((s) => s.id);
}

/** Slot id → the slot whose card covers it (a wide card also covers its right neighbours). */
export function coverage(cat: Catalog, d: Device, except?: string) {
  const chassis = byId(cat.chassis, d.chassis);
  const covered = new Map<string, string>();
  for (const [slot, s] of Object.entries(d.slots)) {
    if (slot === except) continue;
    const slots = chassis && span(chassis, slot, byId(cat.linecards, s.linecard)?.width);
    for (const id of slots ?? [slot]) covered.set(id, slot);
  }
  return covered;
}

// Allowed lists

export function linecardError(cat: Catalog, d: Device, slotId: string, linecardId: string) {
  const chassis = byId(cat.chassis, d.chassis);
  const slot = byId(chassis?.slots ?? [], slotId);
  const card = byId(cat.linecards, linecardId);
  if (!chassis || !slot || !card) return `Unknown chassis, slot or linecard (${d.chassis} / ${slotId} / ${linecardId})`;
  if (!slot.allowedLinecards.includes(card.id)) return `${card.name} is not allowed in slot ${slotId} of ${chassis.name}`;
  const slots = span(chassis, slotId, card.width);
  if (!slots) return `${card.name} needs ${card.width} slots side by side from slot ${slotId}`;
  const taken = coverage(cat, d, slotId);
  const clash = slots.find((s) => taken.has(s));
  return clash ? `Slot ${clash} is taken by the card in slot ${taken.get(clash)}` : null;
}

export function pluggableError(cat: Catalog, linecardId: string, portId: string, pluggableId: string) {
  const card = byId(cat.linecards, linecardId);
  const port = byId(card?.ports ?? [], portId);
  const pluggable = byId(cat.pluggables, pluggableId);
  if (!card || !port || !pluggable) return `Unknown linecard, port or pluggable (${linecardId} / ${portId} / ${pluggableId})`;
  if (!port.allowedPluggables.length) return `Port ${portId} of ${card.name} has fixed Tx/Rx and takes no pluggable`;
  const fits = port.allowedPluggables.some((a) => a === pluggable.id || a === pluggable.formFactor);
  return fits ? null : `${pluggable.name} is not allowed in port ${portId} of ${card.name}`;
}

// Fiber rules for a fiber from a's Tx to b's Rx: each returns a refusal reason or null. New rule types plug into the list.

type FiberRule = (t: Topology, cat: Catalog, a: End, b: End) => string | null;

const is800mx = (id?: string, name?: string) => /^lc-800mx(?:-|$)/i.test(id ?? '') || /\b800MX\b/i.test(name ?? '');
const isLr4 = (...values: (string | undefined)[]) => values.some((value) => /LR4/i.test(value ?? ''));

const sameCardDaisyChain = (t: Topology, cat: Catalog, a: End, b: End) => {
  if (a.device !== b.device || a.slot !== b.slot || sameEnd(a, b)) return false;
  const [left, right] = [resolve(t, cat, a), resolve(t, cat, b)];
  if (!is800mx(left.card?.id, left.card?.name) || !is800mx(right.card?.id, right.card?.name)) return false;
  return isLr4(left.pluggable?.id, left.pluggable?.name, left.pluggable?.part)
    && isLr4(right.pluggable?.id, right.pluggable?.name, right.pluggable?.part);
};

/** A rule that refuses when either end fails `ok`. */
const bothEnds = (ok: (t: Topology, cat: Catalog, e: End) => boolean, why: string): FiberRule => (t, cat, a, b) => {
  const bad = [a, b].find((e) => !ok(t, cat, e));
  return bad ? `${path(t, bad)} ${why}` : null;
};

export const fiberRules: FiberRule[] = [
  bothEnds(fiberable, 'has no pluggable'),
  bothEnds((t, cat, e) => resolve(t, cat, e).fixed || resolve(t, cat, e).pluggable?.fiber === 'SMF', 'is not single-mode (SMF)'),
  (t, _cat, a, b) => (fibersAt(t, a).tx ? `${path(t, a)} Tx already has a fiber`
    : fibersAt(t, b).rx ? `${path(t, b)} Rx already has a fiber` : null),
  (t, cat, a, b) => (a.device !== b.device || a.slot !== b.slot || (sameEnd(a, b) && canLoopback(resolve(t, cat, a).port)) || sameCardDaisyChain(t, cat, a, b) ? null
    : 'Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)'),
];

export const fiberError = (t: Topology, cat: Catalog, a: End, b: End) =>
  fiberRules.map((rule) => rule(t, cat, a, b)).find((err) => err) ?? null;

/** Whether a fiber came in from a box's strands, as wired() names them: F03, or F03@PAHO-GS2000-04. */
export const isStrand = (l: Link) => /^F\d+(@|$)/.test(l.id);

/**
 * Device `d`'s fibers from the box's strands (its wiring.csv, ends as CLI addresses), each named by its strand. A box's
 * strand names are its own, so one another device's fiber has already is named after the box too: F03@PAHO-GS2000-04.
 * A strand with an end off the box (the BERT) is left out, as is one a fiber of `d` has the name of; one the fiber rules
 * refuse is listed with why.
 */
export function wired(cat: Catalog, t: Topology, d: Device, strands: { strand: string; from: string; to: string }[]) {
  const t2 = { ...t, devices: t.devices.map((x) => (x.id === d.id ? d : x)), links: [...t.links] };
  const refused: string[] = [];
  for (const { strand, from, to } of strands) {
    const [a, b] = [endAt(cat, d, from), endAt(cat, d, to)];
    const other = byId(t2.links, strand);
    const id = other && !touches(other, { device: d.id }) ? `${strand}@${d.name}` : strand;
    if (!a || !b || byId(t2.links, id)) continue;
    const err = fiberError(t2, cat, a, b);
    if (err) refused.push(`${id}: ${err}`);
    else t2.links.push({ id, type: 'smf', a, b });
  }
  return { links: t2.links.slice(t.links.length), refused };
}

/** Re-check a whole topology, e.g. an opened file. Throws if the file is malformed. */
export function validate(t: Topology, cat: Catalog): string[] {
  const errors: (string | null)[] = [];
  for (const d of t.devices) {
    const at = (err: string | null) => err && `${d.name}: ${err}`;
    errors.push(at(byId(cat.chassis, d.chassis) ? null : `unknown chassis ${d.chassis}`));
    for (const [slot, s] of Object.entries(d.slots)) {
      errors.push(at(linecardError(cat, d, slot, s.linecard)));
      for (const [port, p] of Object.entries(s.ports)) errors.push(at(pluggableError(cat, s.linecard, port, p.pluggable)));
    }
  }
  for (const l of t.links) {
    const err = fiberError({ ...t, links: t.links.filter((x) => x !== l) }, cat, l.a, l.b);
    errors.push(err && `Fiber ${l.id}: ${err}`);
  }
  return errors.filter((e): e is string => !!e);
}

// Alarms: raised from the topology the way the hardware would, so they come and go as it is built.

/** Back bay ids: PSU1…PSUn or FAN1…FANn. */
export const bays = (kind: 'PSU' | 'FAN', n = 0) => Array.from({ length: n }, (_, i) => `${kind}${i + 1}`);

/** LOS on every pluggable or fixed port without a fiber into its Rx, and one alarm per empty PSU or fan bay. */
export function alarms(t: Topology, cat: Catalog, d: Device): Alarm[] {
  const chassis = byId(cat.chassis, d.chassis);
  const empty = (kind: 'PSU' | 'FAN', n?: number) => bays(kind, n).filter((bay) => d.emptyBays?.includes(bay));
  return [
    ...Object.entries(d.slots).flatMap(([slot, s]) => (byId(cat.linecards, s.linecard)?.ports ?? [])
      .filter((p) => (s.ports[p.id] || !p.allowedPluggables.length) && !fibersAt(t, { device: d.id, slot, port: p.id }).rx)
      .map((p): Alarm => ({ severity: 'critical', slot, port: p.id, text: 'LOS · loss of signal, no fiber into Rx' }))),
    ...empty('PSU', chassis?.psus).map((bay): Alarm => ({ severity: 'major', bay, text: 'Power supply missing · no redundancy' })),
    ...empty('FAN', chassis?.fans).map((bay): Alarm => ({ severity: 'major', bay, text: 'Fan tray missing · less cooling' })),
  ];
}

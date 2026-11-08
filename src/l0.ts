// L0: the catalog's picture of a card's insides (`l0` on a linecard) joined with what the box reports. Read, never
// modelled: nothing here predicts a power. A number shown is the box's, or the difference of two of the box's.
import { tables } from '../bridge/tables.mjs';
import { byId, cliAddress } from './catalog';
import { fibersAt, resolve } from './rules';
import type { BoxState } from './live';
import type { Catalog, Device, End, L0InternalPathDef, L0Range, LinecardDef, Link, PortDef, Topology } from './types';

type Dir = 'in' | 'out';

// Readings

/** Where the box has nothing to measure it prints -99.99, on a port and on an amplifier alike. */
const lit = (v?: number) => (v !== undefined && v > -99 ? v : undefined);

/** An L0 port's total power one way, from `show optical-port <at>` or its list form: its dBm (none when dark) and flag. */
export function portPower(s: BoxState, at: string, dir: Dir) {
  const port = (cmd: string) => s.commands[cmd]?.data?.state?.ports?.[`port-${at}`]?.[dir];
  const p: { 'optical-power'?: number; flag?: string } | undefined = port(`show optical-port ${at}`) ?? port('show optical-port');
  const v = p?.['optical-power'];
  return v === undefined ? undefined : { dBm: lit(v), flag: p?.flag, dark: lit(v) === undefined };
}

export type BoxAlarm = { resource?: string; severity: string; 'alarm-abbreviate': string; text: string; direction?: string };

export const allAlarms = (s: BoxState) => Object.values<BoxAlarm>(s.commands['show alarm']?.data?.alarms ?? {});

/** The active alarms on an address. A resource names it last: "port 1-1-ad1", "och 1-7-5", "flexgo-1-7-5". */
export const alarmsAt = (s: BoxState, at: string) => allAlarms(s).filter((a) => a.resource?.match(/(\d+-\d+(?:-\w+)?)$/)?.[1] === at);

// Thresholds

export type Level = 'warning' | 'failure';
type Side = 'high' | 'low';

/** One threshold: past `declare` it is raised, and once raised it stands until past `clear` the other way. */
export interface Limit { name: string; level: Level; side: Side; declare: number; clear: number }

/** How a reading stands against its limits. `fill`, 0 to 1, is how far it is from the warning to the failure. */
export interface Verdict { level: Level; side: Side; fill: number; why: string }

const SIDES: Side[] = ['high', 'low'];
const LEVELS: Level[] = ['warning', 'failure'];
/** dB from warning to failure on every L0 port so far (3 to 6, 22 to 25), for a limit with no failure level above it. */
const SPAN = 3;

const thresholdsOf = (s: BoxState, resource: string): Record<string, { 'declare-threshold': number; 'clear-hysteresis'?: number }> | undefined =>
  s.commands['show profile-threshold']?.data?.thresholds?.[resource];

/** The box's own alarm thresholds on a port: IN_OPTICAL_HIGH_WARNING, declared at 3, cleared 0.5 below it. */
const alarmLimits = (s: BoxState, at: string, dir: Dir) => SIDES.flatMap((side) => LEVELS.flatMap((level): Limit[] => {
  const name = `${dir === 'in' ? 'IN' : 'OUT'}_OPTICAL_${side.toUpperCase()}_${level.toUpperCase()}`;
  const t = thresholdsOf(s, `PORT-${at.toUpperCase()}`)?.[name];
  if (!t) return [];
  const [declare, hysteresis] = [t['declare-threshold'], t['clear-hysteresis'] ?? 0];
  return [{ name, level, side, declare, clear: side === 'high' ? declare - hysteresis : declare + hysteresis }];
}));

/** The same from the catalog, for when the box's aren't in: a pair there is [declare, clear]. */
const catalogLimits = (card: LinecardDef | undefined, port: string, dir: Dir) => SIDES.flatMap((side) => LEVELS.flatMap((level): Limit[] => {
  const v = card?.l0?.opticalThresholdEnvelopes?.[port]?.[`${dir === 'in' ? 'input' : 'output'}-optical-${side}-${level}-threshold`];
  if (v === undefined) return [];
  const [declare, clear] = Array.isArray(v) ? v : [v, v];
  return [{ name: `${dir === 'in' ? 'IN' : 'OUT'}_OPTICAL_${side.toUpperCase()}_${level.toUpperCase()}`, level, side, declare, clear }];
}));

/**
 * The 15-minute TCA limits, the only ones the box has for an OCH, a transceiver or an amplifier. A TCA counts over its
 * period and the catalog has none, so a reading against one is at most a warning.
 */
function tcaLimits(s: BoxState, at: string, dir: Dir): Limit[] {
  const io = dir === 'in' ? 'INPUT' : 'OUTPUT';
  for (const [kind, power] of [['OCH', `OPT_${io}`], ['TRANSCEIVER', `OPT_TOTAL_${io}`], ['AMPLIFIER', `OPT_${io}`]]) {
    const limits = SIDES.flatMap((side): Limit[] => {
      const name = `TCA_${power}_POWER_${side === 'high' ? 'H' : 'L'}_15MIN`;
      const t = thresholdsOf(s, `${kind}-${at.toUpperCase()}`)?.[name];
      return t ? [{ name, level: 'warning', side, declare: t['declare-threshold'], clear: t['declare-threshold'] }] : [];
    });
    if (limits.length) return limits;
  }
  return [];
}

/** The limits on a reading at `at`: the box's alarm thresholds, else the catalog's for that port, else the box's TCAs. */
export function limitsAt(s: BoxState, card: LinecardDef | undefined, port: string | undefined, at: string, dir: Dir) {
  const alarm = alarmLimits(s, at, dir);
  if (alarm.length) return alarm;
  const catalog = port ? catalogLimits(card, port, dir) : [];
  return catalog.length ? catalog : tcaLimits(s, at, dir);
}

/**
 * `v` against `limits`, or null when it is within them. Between clear and declare the box's own alarm decides, in
 * `raised`: AD1 read 2.81 under a warning declared at 3 and the alarm stood, because it clears at 2.5.
 */
export function judge(v: number, limits: Limit[], raised: string[]): Verdict | null {
  const past = (l: Limit, edge: number) => (l.side === 'high' ? v > edge : v < edge);
  const hit = limits.filter((l) => past(l, l.declare) || (raised.includes(l.name) && past(l, l.clear)))
    .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level))[0];
  if (!hit) return null;
  const same = limits.filter((l) => l.side === hit.side);
  const [from, to] = [same.find((l) => l.level === 'warning') ?? hit, same.find((l) => l.level === 'failure')];
  const room = to && to !== from ? Math.abs(to.declare - from.declare) : SPAN;
  const over = hit.side === 'high' ? v - from.declare : from.declare - v;
  const edge = hit.side === 'high' ? ['over', 'under'] : ['under', 'over'];
  return {
    level: hit.level, side: hit.side, fill: Math.min(1, Math.max(0, over / room)),
    why: `${hit.name}: ${v.toFixed(2)} dBm ${past(hit, hit.declare) ? `is ${edge[0]} ${hit.declare.toFixed(2)}` : `stands, declared ${edge[0]} ${hit.declare.toFixed(2)}, clears ${edge[1]} ${hit.clear.toFixed(2)}`}`,
  };
}

/** A reading at an address against its limits, with the box's alarms there. */
export const verdictAt = (s: BoxState, card: LinecardDef | undefined, port: string | undefined, at: string, dir: Dir, v?: number) =>
  (v === undefined ? null : judge(v, limitsAt(s, card, port, at, dir), alarmsAt(s, at).map((a) => a['alarm-abbreviate'])));

/** The worse of two verdicts: a failure over a warning, then the further past. */
export function worst(a: Verdict | null, b: Verdict | null) {
  if (!a || !b) return a ?? b;
  const rank = (v: Verdict) => 2 * LEVELS.indexOf(v.level) + v.fill;
  return rank(b) > rank(a) ? b : a;
}

// Media channels

export { tables };

/** A media channel: the light through the WSS between a line port and an add/drop port, set by `set media-channel`. */
export interface MediaChannel { id: string; line?: string; addDrop?: string; up: boolean; cols: Record<string, string> }

const portAddress = (v?: string) => v?.toLowerCase().replace(/^port-/, '') || undefined;

/**
 * The box's media channels, or null when they aren't known: not captured yet, or not printed as a table. It reads the
 * raw output by column name, because no run has this command yet; once one does, it can have a template like the rest.
 */
export function mediaChannels(s: BoxState | null): MediaChannel[] | null {
  const raw = s?.commands['show media-channel']?.raw;
  if (raw === undefined) return null;
  if (raw.trim() === 'None') return [];
  const rows = tables(raw);
  return rows.length ? rows.map(({ id, cols }) => ({ id, cols, line: portAddress(cols['line-port']), addDrop: portAddress(cols['add-drop-port']), up: cols['admin-state'] !== 'out-of-service' })) : null;
}

/** The ports of a card that carry light, as addresses, and how we know: its media channels, else the ports showing power. */
export function activePorts(s: BoxState | null, card: LinecardDef | undefined, no: number, slot: string) {
  const here = `${no}-${slot}-`;
  const channels = mediaChannels(s)?.filter((c) => c.up && c.addDrop?.startsWith(here));
  if (channels) return { from: 'media-channel' as const, ports: new Set(channels.map((c) => c.addDrop!)) };
  const shows = (p: PortDef) => !!s && (['in', 'out'] as const).some((d) => portPower(s, cliAddress(no, slot, p.id), d)?.dBm !== undefined);
  return { from: 'light' as const, ports: new Set((card?.ports ?? []).filter(shows).map((p) => cliAddress(no, slot, p.id))) };
}

// The light path

/** Where light passes through a card, as the catalog has it: its internal paths, else each amplifier's two ports. */
export const routesOf = (card?: LinecardDef): L0InternalPathDef[] => (card?.l0?.internalPaths?.length ? card.l0.internalPaths
  : (card?.l0?.amplifiers ?? []).flatMap((a) => (a.ingressPort && a.egressPort ? [{ fromPort: a.ingressPort, toPort: a.egressPort, via: [`amplifier:${a.id}`] }] : [])));

/** One step of the light: a port it crosses, a fiber, a WSS (`blocked` with no media channel through it), an amplifier. */
export type Hop =
  | { kind: 'port'; at: string; dir: Dir }
  | { kind: 'fiber'; id: string }
  | { kind: 'wss'; at: string; name: string; blocked?: boolean }
  | { kind: 'amp'; at: string; id: string };
type CardHop = Extract<Hop, { kind: 'wss' | 'amp' }>;

const chassisNo = (t: Topology, e: End) => byId(t.devices, e.device)?.chassisNo ?? 1;
const addressOf = (t: Topology, e: End) => cliAddress(chassisNo(t, e), e.slot, e.port);

/** A catalog `via` entry as a hop: "wss:mux", "wss", "amplifier:BA". */
const viaHop = (via: string, no: number, slot: string): CardHop => {
  const [kind, name] = via.split(':');
  return kind === 'amplifier' ? { kind: 'amp', at: cliAddress(no, slot, name), id: name } : { kind: 'wss', at: cliAddress(no, slot), name: name ?? 'wss' };
};

/**
 * The light from `head`, fiber by fiber through each card, until it leaves the known path: a card with no route on, a
 * WSS with no media channel through it, or a loop. Inside a card it takes the route to a port with a fiber out, the
 * active one when several have.
 */
export function trace(t: Topology, cat: Catalog, s: BoxState | null, head: Link): Hop[] {
  const hops: Hop[] = [{ kind: 'port', at: addressOf(t, head.a), dir: 'out' }];
  const seen = new Set<string>();
  for (let link: Link | undefined = head; link && !seen.has(link.id);) {
    seen.add(link.id);
    hops.push({ kind: 'fiber', id: link.id }, { kind: 'port', at: addressOf(t, link.b), dir: 'in' });
    const landing: End = link.b;
    const { card } = resolve(t, cat, landing);
    const no = chassisNo(t, landing);
    const active = activePorts(s, card, no, landing.slot);
    const isActive = (r: L0InternalPathDef) => [r.fromPort, r.toPort].some((p) => active.ports.has(cliAddress(no, landing.slot, p)));
    const routes = routesOf(card).filter((r) => r.fromPort === landing.port)
      .map((r) => ({ r, next: fibersAt(t, { ...landing, port: r.toPort }).tx }))
      .filter((o) => o.next && !seen.has(o.next.id));
    const pick = routes.find((o) => isActive(o.r)) ?? routes[0];
    if (!pick) break;
    const through = pick.r.via.map((v) => viaHop(v, no, landing.slot));
    const wss = through.find((h) => h.kind === 'wss');
    if (wss && active.from === 'media-channel' && !isActive(pick.r)) {
      hops.push(...through.slice(0, through.indexOf(wss)), { ...wss, blocked: true });
      break;
    }
    hops.push(...through, { kind: 'port', at: cliAddress(no, landing.slot, pick.r.toPort), dir: 'out' });
    link = pick.next;
  }
  return hops;
}

/** The fibers light starts on: those leaving a port no route of its card leads to, such as a transponder's line port. */
export const heads = (t: Topology, cat: Catalog) => t.links.filter((l) => !routesOf(resolve(t, cat, l.a).card).some((r) => r.toPort === l.a.port));

/** The whole light paths through slot `slot` of device `d`. */
export const pathsThrough = (t: Topology, cat: Catalog, s: BoxState | null, d: Device, slot: string) => {
  const here = cliAddress(d.chassisNo ?? 1, slot);
  return heads(t, cat).map((l) => trace(t, cat, s, l)).filter((hops) => hops.some((h) => h.kind !== 'fiber' && (h.at === here || h.at.startsWith(`${here}-`))));
};

/** The ch-N alarms on a WSS: the add direction's on a mux, the drop direction's on a demux. N is the media channel. */
const channelAlarms = (s: BoxState, name: string) => allAlarms(s).filter((a) => /^ch-\d+$/.test(a.resource ?? '')
  && !(name === 'mux' && a['alarm-abbreviate'].includes('DEST_TO_SRC')) && !(name === 'demux' && a['alarm-abbreviate'].includes('SRC_TO_DEST')));

/** The box's alarms on one hop. A port's are the ones of its direction: an IN_LOS is on the light landing there. */
export function alarmsOn(s: BoxState, hop: Hop) {
  if (hop.kind === 'fiber') return [];
  if (hop.kind === 'wss') return channelAlarms(s, hop.name);
  const here = alarmsAt(s, hop.at);
  return hop.kind === 'amp' ? here : here.filter((a) => a.direction !== (hop.dir === 'in' ? 'tx' : 'rx'));
}

/** The first hop along the path with a loss of signal or frame, and that alarm: the most upstream one, or null. */
export function firstLoss(s: BoxState, hops: Hop[]) {
  for (const hop of hops) {
    const alarm = alarmsOn(s, hop).find((a) => /LOS|LOF/.test(a['alarm-abbreviate']));
    if (alarm) return { hop, alarm };
  }
  return null;
}

/** A hop in a word or two, for the path written out. */
export const hopName = (hop: Hop) => (hop.kind === 'fiber' ? hop.id
  : hop.kind === 'port' ? `${hop.at} ${hop.dir}`
    : hop.kind === 'amp' ? hop.id : `${hop.name}${hop.blocked ? ' (no media channel)' : ''}`);

// A card's insides

export interface PortCell { id: string; at: string; dir: Dir; dBm?: number; flag?: string; dark: boolean; heat: Verdict | null; alarms: string[] }
export interface Fact { label: string; value: string; heat?: Verdict | null }
export type Stage =
  | { kind: 'ports'; cells: PortCell[]; idle: string[] }
  | { kind: 'wss' | 'amp'; id: string; facts: Fact[]; alarms: string[] };
/** One way through a card, in the order light takes it. `back` when it is the way back over an earlier row's ports. */
export interface Row { stages: Stage[]; back: boolean }

const dB = (v: number) => `${v.toFixed(2)} dB`;
const dBm = (v?: number) => (v === undefined ? 'no light' : `${v.toFixed(2)} dBm`);
const range = (r?: L0Range) => (r && r.min !== undefined && r.max !== undefined ? `${r.min} to ${r.max}` : undefined);
const alarmText = (a: BoxAlarm) => `${a.severity} ${a['alarm-abbreviate']}: ${a.text}`;
const ampState = (s: BoxState | null, at: string) => s?.commands['show amplifier']?.data?.state?.amplifiers?.[at];

/** Routes with one end in common are one row, the fan of ports at the other: AD1…AD11 → LINE, then LINE → AD1…AD11. */
function fans(routes: L0InternalPathDef[]) {
  const fanned = new Set<L0InternalPathDef>();
  const group = (key: (r: L0InternalPathDef) => string, rest: L0InternalPathDef[]) => Object.values(Object.groupBy(rest, key)) as L0InternalPathDef[][];
  const rows = group((r) => `${r.via.join()}>${r.toPort}`, routes).filter((g) => g.length > 1).map((g) => {
    g.forEach((r) => fanned.add(r));
    return { from: g.map((r) => r.fromPort), to: [g[0].toPort], via: g[0].via };
  });
  return [...rows, ...group((r) => `${r.via.join()}<${r.fromPort}`, routes.filter((r) => !fanned.has(r))).map((g) => ({ from: [g[0].fromPort], to: g.map((r) => r.toPort), via: g[0].via }))];
}

/**
 * What is inside the card in slot `slot` of `d`, way by way: its ports, WSS and amplifiers with what the box reports at
 * each. Of a fan of ports only those with a fiber or light are shown, the rest counted as idle. The step over a WSS is
 * the difference of the readings either side of it; nothing else is worked out.
 */
export function inside(t: Topology, cat: Catalog, s: BoxState | null, d: Device, slot: string): Row[] {
  const card = byId(cat.linecards, d.slots[slot]?.linecard);
  const no = d.chassisNo ?? 1;
  const address = (port?: string) => cliAddress(no, slot, port);
  const active = activePorts(s, card, no, slot);
  const channels = mediaChannels(s) ?? [];

  const cell = (id: string, dir: Dir): PortCell => {
    const at = address(id);
    const p = s ? portPower(s, at, dir) : undefined;
    return {
      id, at, dir, dBm: p?.dBm, flag: p?.flag, dark: !!p?.dark,
      heat: s ? verdictAt(s, card, id, at, dir, p?.dBm) : null,
      alarms: s ? alarmsOn(s, { kind: 'port', at, dir }).map(alarmText) : [],
    };
  };
  const ports = (ids: string[], dir: Dir): Stage => {
    const used = (id: string) => ids.length === 1 || active.ports.has(address(id)) || !!fibersAt(t, { device: d.id, slot, port: id })[dir === 'in' ? 'rx' : 'tx'];
    return { kind: 'ports', cells: ids.filter(used).map((id) => cell(id, dir)), idle: ids.filter((id) => !used(id)) };
  };
  const amp = (id: string): Stage => {
    const at = address(id);
    const def = card?.l0?.amplifiers?.find((a) => a.id === id);
    const b = ampState(s, at);
    const stat = (key: string) => lit(b?.stats?.[key]?.instant);
    /** A setting or state the box prints as a string, unless it is nothing to show: 0.00, or -99.99 while dark. */
    const shown = (key: string, label: string): Fact[] => { const v = lit(Number(b?.[key]) || undefined); return v === undefined ? [] : [{ label, value: dB(v) }]; };
    const power = (key: string, dir: Dir, label: string): Fact[] => (b ? [{ label, value: dBm(stat(key)), heat: s && verdictAt(s, card, undefined, at, dir, stat(key)) }] : []);
    const gain = stat('actual-gain');
    return {
      kind: 'amp', id, alarms: s ? alarmsOn(s, { kind: 'amp', at, id }).map(alarmText) : [],
      facts: [
        ...power('input-power', 'in', 'In'),
        ...(b ? [{ label: 'Gain', value: gain === undefined ? 'none' : `${dB(gain)} of ${b['target-gain']}` }] : []),
        ...power('output-power', 'out', 'Out'),
        ...shown('actual-voa-attenuation', 'VOA'),
        ...shown('ingress-span-loss', 'Span loss'),
        ...(range(def?.gainRange) ? [{ label: 'Gain range', value: `${range(def?.gainRange)} dB` }] : []),
      ],
    };
  };
  const wss = (name: string, ids: string[]): Stage => {
    const through = channels.filter((c) => c.addDrop && ids.some((id) => address(id) === c.addDrop));
    const way = name === 'demux' ? 'drop' : 'add';
    return {
      kind: 'wss', id: name, alarms: s ? alarmsOn(s, { kind: 'wss', at: address(), name }).map(alarmText) : [],
      facts: through.flatMap((c) => [
        { label: 'Channel', value: `${c.id}${c.cols['center-frequency'] ? ` · ${c.cols['center-frequency']} MHz` : ''}${c.cols.bandwidth ? ` · ${c.cols.bandwidth} MHz wide` : ''}` },
        ...(c.cols[`actual-${way}-voa-attenuation`] ? [{ label: 'VOA', value: `${c.cols[`actual-${way}-voa-attenuation`]} dB` }] : []),
      ]),
    };
  };

  /** The power light has leaving or reaching a stage, when the box has one reading for it. */
  const read = (stage: Stage, dir: Dir) => {
    if (stage.kind === 'ports') return stage.cells.length === 1 ? { name: stage.cells[0].id, v: stage.cells[0].dBm } : undefined;
    if (stage.kind === 'wss') return undefined;
    return { name: stage.id, v: lit(ampState(s, address(stage.id))?.stats?.[dir === 'in' ? 'input-power' : 'output-power']?.instant) };
  };

  const ways = fans(routesOf(card));
  return ways.map(({ from, to, via }, i) => {
    const stages: Stage[] = [ports(from, 'in'), ...via.map((v) => {
      const hop = viaHop(v, no, slot);
      return hop.kind === 'amp' ? amp(hop.id) : wss(hop.name, [...from, ...to]);
    }), ports(to, 'out')];
    stages.forEach((stage, k) => {
      if (stage.kind !== 'wss') return;
      const [a, b] = [read(stages[k - 1], 'out'), read(stages[k + 1], 'in')];
      if (a?.v !== undefined && b?.v !== undefined) stage.facts.push({ label: `${a.name} to ${b.name}`, value: dB(a.v - b.v) });
    });
    const back = ways.slice(0, i).some((w) => w.from.includes(to[0]) && w.to.includes(from[0]));
    return { stages, back };
  });
}

// Range checks

const AMP_RANGES = [
  ['target-gain', 'gainRange', 'target gain'],
  ['target-gain-tilt', 'targetGainTiltRange', 'target tilt'],
  ['target-voa-attenuation', 'ingressVoaAttenRange', 'target VOA'],
  ['target-span-loss-offset', 'targetSpanLossOffsetRange', 'span loss offset'],
] as const;

const outside = (v: number, r?: L0Range) => !!r && ((r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max));

/**
 * What the box has set outside what the catalog allows on device `d`, and what the fibers and the media channels
 * disagree on: amplifier targets against their ranges, media channels against the channel plan, and a fiber on an
 * add/drop port with no media channel, or a media channel on a port with no fiber.
 */
export function l0Problems(t: Topology, cat: Catalog, s: BoxState, d: Device): string[] {
  const no = d.chassisNo ?? 1;
  const problems: string[] = [];
  const channels = mediaChannels(s);
  for (const [slot, state] of Object.entries(d.slots)) {
    const card = byId(cat.linecards, state.linecard);
    for (const def of card?.l0?.amplifiers ?? []) {
      const at = cliAddress(no, slot, def.id);
      const box = ampState(s, at);
      for (const [key, rangeKey, label] of AMP_RANGES) {
        const v = Number(box?.[key]);
        if (box?.[key] !== undefined && Number.isFinite(v) && outside(v, def[rangeKey])) {
          problems.push(`${d.name}: ${at} ${label} ${v} dB is outside ${range(def[rangeKey])} dB`);
        }
      }
    }
    const here = `${cliAddress(no, slot)}-`;
    for (const c of channels?.filter((x) => x.addDrop?.startsWith(here)) ?? []) {
      const plan = card?.l0?.channelPlan;
      const [frequency, width] = [Number(c.cols['center-frequency']), Number(c.cols.bandwidth)];
      if (frequency && outside(frequency, plan?.frequencyRange)) problems.push(`${d.name}: media channel ${c.id} at ${frequency} MHz is outside ${card?.name}'s ${range(plan?.frequencyRange)} MHz`);
      if (width && outside(width, plan?.bandwidthRange)) problems.push(`${d.name}: media channel ${c.id} is ${width} MHz wide, outside ${card?.name}'s ${range(plan?.bandwidthRange)} MHz`);
      const port = card?.ports.find((p) => cliAddress(no, slot, p.id) === c.addDrop);
      if (port && !Object.values(fibersAt(t, { device: d.id, slot, port: port.id })).some(Boolean)) problems.push(`${d.name}: media channel ${c.id} uses ${c.addDrop}, which has no fiber`);
    }
    if (!channels) continue;
    for (const port of card?.ports.filter((p) => p.role === 'adddrop') ?? []) {
      const at = cliAddress(no, slot, port.id);
      const fiber = Object.values(fibersAt(t, { device: d.id, slot, port: port.id })).find(Boolean);
      if (fiber && !channels.some((c) => c.addDrop === at)) problems.push(`${d.name}: fiber ${fiber.id} is on ${at}, which has no media channel`);
    }
  }
  return problems;
}

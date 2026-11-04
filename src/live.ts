// The box's light on the fibers, from what the CLI bridge read (GET /bridge/state, bridge/server.mjs): the poller's
// results while a box is connected, else the last run on disk. Never saved in the .olst.json, like the alarms.
import { byId, cliAddress, linecardFor } from './catalog';
import { alarmsAt, portPower, verdictAt, worst, type Verdict } from './l0';
import { resolve } from './rules';
import type { Catalog, Device, End, Link, SlotState, Topology } from './types';

/** One command's latest result: its TTP parse, its parse error, or its output when it has no template. Times in ms. */
export interface Result { at: number; data?: any; error?: string; raw?: string }

/** What /bridge/state answers: `live` while connected to `host`, else the last run recorded from it. */
export interface BoxState { live: boolean; host?: string; run?: string | null; at?: number; commands: Record<string, Result> }

/**
 * A strand as the box sees it: dark or not, the dBm where it leaves (tx) and lands (rx), the worse of those two against
 * their thresholds (`heat`, none within them), and the rest as notes.
 */
export interface Light { dark: boolean; tx?: number; rx?: number; heat?: Verdict | null; notes: string[] }

/** The box state, if it is this device's box. */
export const stateFor = (s: BoxState | null, d?: Device) => (s && d?.host && s.host === d.host ? s : null);

type Stat = { instant: number; avg?: number; min?: number; max?: number; unit?: string };
/**
 * A command's statistics, or none while the box has no reading: right after a reboot an OCH and its transceiver read
 * 0 in every cell (0 MHz, 0.00 dBm, 0.00 dB), and 0 dBm would show a dark strand as lit.
 */
const stats = (s: BoxState, cmd: string): Record<string, Stat | undefined> => {
  const all: Record<string, Stat | undefined> = s.commands[cmd]?.data?.state?.stats ?? {};
  return Object.values(all).every((v) => !v || [v.instant, v.avg, v.min, v.max].every((x) => !x)) ? {} : all;
};
const address = (t: Topology, e: End) => cliAddress(byId(t.devices, e.device)?.chassisNo ?? 1, e.slot, e.port);
const dBm = (v: number) => `${v.toFixed(2)} dBm`;
/** The box's flag on an L0 port's reading, as it prints it: ", flag C". */
const flag = (p?: { flag?: string }) => (p?.flag ? `, flag ${p.flag}` : '');

/** A transceiver's lanes, from `show transceiver <at> physical-channel <n>`: their `key` power, or none. */
const lanes = (s: BoxState, at: string, key: string) =>
  Array.from({ length: 8 }, (_, i) => stats(s, `show transceiver ${at} physical-channel ${i + 1}`)[key]?.instant)
    .filter((v): v is number => v !== undefined);

/**
 * The light on strand `l` (a's Tx → b's Rx), or null when the box says nothing about it. A line port's power comes
 * from its OCH, a client's from its transceiver, an L0 port's from `show optical-port`. Dark when a's laser is off, b
 * has a loss-of-signal or loss-of-frame alarm, or either end reads no light: the box's own judgement. `cat` gives the
 * catalog's thresholds for a port whose own the box hasn't shown.
 */
export function light(s: BoxState | null, t: Topology, l: Link, cat?: Catalog): Light | null {
  if (!s) return null;
  const [a, b] = [address(t, l.a), address(t, l.b)];
  const [ochA, ochB, plugA, plugB] = [stats(s, `show och ${a}`), stats(s, `show och ${b}`), stats(s, `show transceiver ${a}`), stats(s, `show transceiver ${b}`)];
  const [l0a, l0b] = [portPower(s, a, 'out'), portPower(s, b, 'in')];
  const tx = ochA['output-power']?.instant ?? plugA['output-power']?.instant ?? l0a?.dBm;
  const rx = ochB['total-input-power']?.instant ?? plugB['input-power']?.instant ?? l0b?.dBm;
  const alarms = alarmsAt(s, b);
  const laserOff = s.commands['show port']?.data?.state?.ports?.[a]?.laser === 'disabled' || s.commands[`show och ${a}`]?.data?.state?.laser === 'disabled';
  const noLight = [tx === undefined && l0a?.dark ? a : null, rx === undefined && l0b?.dark ? b : null].filter(Boolean);
  const dark = laserOff || !!noLight.length || alarms.some((x) => /LOS|LOF/.test(x['alarm-abbreviate']));
  if (tx === undefined && rx === undefined && !dark && !alarms.length) return null;
  const [txLanes, rxLanes] = [lanes(s, a, 'output-power'), lanes(s, b, 'input-power')];
  const card = (e: End) => (cat ? resolve(t, cat, e).card : undefined);
  const [txHeat, rxHeat] = [verdictAt(s, card(l.a), l.a.port, a, 'out', tx), verdictAt(s, card(l.b), l.b.port, b, 'in', rx)];
  const { osnr, 'q-margin': q, 'pre-fec-ber': ber } = ochB;
  return {
    dark, tx, rx, heat: worst(txHeat, rxHeat),
    notes: [
      ...(tx !== undefined ? [`Tx ${a}: ${dBm(tx)}${txLanes.length > 1 ? ` (lanes ${txLanes.join(' / ')})` : ''}${flag(l0a)}`] : []),
      ...(rx !== undefined ? [`Rx ${b}: ${dBm(rx)}${rxLanes.length > 1 ? ` (lanes ${rxLanes.join(' / ')})` : ''}${flag(l0b)}`] : []),
      ...(tx !== undefined && rx !== undefined ? [`Tx − Rx: ${(tx - rx).toFixed(2)} dB`] : []),
      ...(osnr ? [`OSNR ${osnr.instant} dB`] : []),
      ...(q ? [`Q-margin ${q.instant} dB`] : []),
      ...(ber ? [`Pre-FEC BER ${ber.instant.toExponential(2).toUpperCase()}`] : []),
      ...(txHeat ? [`Tx ${a}: ${txHeat.why}`] : []),
      ...(rxHeat ? [`Rx ${b}: ${rxHeat.why}`] : []),
      ...(laserOff ? [`Laser off at ${a}`] : []),
      ...noLight.map((at) => `No light at ${at}`),
      ...alarms.map((x) => `${x.severity} ${x['alarm-abbreviate']} at ${b}: ${x.text}`),
    ],
  };
}

type BoxCard = { 'module-type': string; present: string };
type BoxPart = { 'mfg-name'?: string; 'part-no': string };

/**
 * What is in device `d`'s box, from `show card` and `show inventory`, as its slots: each card that is present, and each
 * transceiver in it by part number. What the catalog has no part for is listed in `missing`, not guessed; a part it has
 * but doesn't allow there is drawn as the box has it, and the problems list says so. Null until both have come in.
 */
export function discover(cat: Catalog, d: Device, s: BoxState) {
  const cards: Record<string, BoxCard> | undefined = s.commands['show card']?.data?.state?.cards;
  const parts: Record<string, BoxPart> | undefined = s.commands['show inventory']?.data?.transceivers;
  const chassis = byId(cat.chassis, d.chassis);
  if (!cards || !parts || !chassis) return null;
  const no = d.chassisNo ?? 1;
  const slots: Record<string, SlotState> = {};
  const missing: string[] = [];
  for (const { id: slot } of chassis.slots) {
    const at = cliAddress(no, slot);
    const c = cards[at];
    if (c?.present !== 'true') continue; // empty, or provisioned but not there
    const card = byId(cat.linecards, linecardFor(chassis, c['module-type']));
    if (!card) { missing.push(`${at} ${c['module-type']}`); continue; }
    slots[slot] = { linecard: card.id, ports: {} };
    for (const [where, p] of Object.entries(parts).filter(([where]) => where.startsWith(`${at}-`))) {
      const port = card.ports.find((x) => cliAddress(no, slot, x.id) === where);
      const plug = cat.pluggables.find((x) => x.part === p['part-no']);
      if (port && plug) slots[slot].ports[port.id] = { pluggable: plug.id };
      else missing.push(`${where} ${[p['mfg-name'], p['part-no']].filter(Boolean).join(' ')}`);
    }
  }
  return { slots, missing };
}

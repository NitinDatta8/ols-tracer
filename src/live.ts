// The box's light on the fibers, from what the CLI bridge read (GET /bridge/state, bridge/server.mjs): the poller's
// results while a box is connected, else the last run on disk. Never saved in the .olst.json, like the alarms.
import { byId, cliAddress } from './catalog';
import type { Device, End, Link, Topology } from './types';

/** One command's latest result: its TTP parse, its parse error, or its output when it has no template. Times in ms. */
export interface Result { at: number; data?: any; error?: string; raw?: string }

/** What /bridge/state answers: `live` while connected to `host`, else the last run recorded from it. */
export interface BoxState { live: boolean; host?: string; run?: string | null; at?: number; commands: Record<string, Result> }

/** A strand as the box sees it: dark or not, the dBm where it leaves (tx) and lands (rx), and the rest as notes. */
export interface Light { dark: boolean; tx?: number; rx?: number; notes: string[] }

/** The box state, if it is this device's box. */
export const stateFor = (s: BoxState | null, d?: Device) => (s && d?.host && s.host === d.host ? s : null);

type Stat = { instant: number; unit?: string };
const stats = (s: BoxState, cmd: string): Record<string, Stat | undefined> => s.commands[cmd]?.data?.state?.stats ?? {};
const address = (t: Topology, e: End) => cliAddress(byId(t.devices, e.device)?.chassisNo ?? 1, e.slot, e.port);
const dBm = (v: number) => `${v.toFixed(2)} dBm`;

/** The active alarms on an address. A resource names it last: "port 1-1-ad1", "och 1-7-5", "flexgo-1-7-5". */
const alarmsAt = (s: BoxState, at: string) =>
  Object.values<{ resource?: string; severity: string; 'alarm-abbreviate': string; text: string }>(s.commands['show alarm']?.data?.alarms ?? {})
    .filter((a) => a.resource?.match(/(\d+-\d+(?:-\w+)?)$/)?.[1] === at);

/** A transceiver's lanes, from `show transceiver <at> physical-channel <n>`: their `key` power, or none. */
const lanes = (s: BoxState, at: string, key: string) =>
  Array.from({ length: 8 }, (_, i) => stats(s, `show transceiver ${at} physical-channel ${i + 1}`)[key]?.instant)
    .filter((v): v is number => v !== undefined);

/**
 * The light on strand `l` (a's Tx → b's Rx), or null when the box says nothing about it. A line port's power comes
 * from its OCH, a client's from its transceiver. Dark when a's laser is off or b has a loss-of-signal or loss-of-frame
 * alarm: the box's own judgement, no thresholds of ours.
 */
export function light(s: BoxState | null, t: Topology, l: Link): Light | null {
  if (!s) return null;
  const [a, b] = [address(t, l.a), address(t, l.b)];
  const [ochA, ochB, plugA, plugB] = [stats(s, `show och ${a}`), stats(s, `show och ${b}`), stats(s, `show transceiver ${a}`), stats(s, `show transceiver ${b}`)];
  const tx = ochA['output-power']?.instant ?? plugA['output-power']?.instant;
  const rx = ochB['total-input-power']?.instant ?? plugB['input-power']?.instant;
  const alarms = alarmsAt(s, b);
  const laserOff = s.commands['show port']?.data?.state?.ports?.[a]?.laser === 'disabled' || s.commands[`show och ${a}`]?.data?.state?.laser === 'disabled';
  const dark = laserOff || alarms.some((x) => /LOS|LOF/.test(x['alarm-abbreviate']));
  if (tx === undefined && rx === undefined && !dark && !alarms.length) return null;
  const [txLanes, rxLanes] = [lanes(s, a, 'output-power'), lanes(s, b, 'input-power')];
  const { osnr, 'q-margin': q, 'pre-fec-ber': ber } = ochB;
  return {
    dark, tx, rx,
    notes: [
      ...(tx !== undefined ? [`Tx ${a}: ${dBm(tx)}${txLanes.length > 1 ? ` (lanes ${txLanes.join(' / ')})` : ''}`] : []),
      ...(rx !== undefined ? [`Rx ${b}: ${dBm(rx)}${rxLanes.length > 1 ? ` (lanes ${rxLanes.join(' / ')})` : ''}`] : []),
      ...(osnr ? [`OSNR ${osnr.instant} dB`] : []),
      ...(q ? [`Q-margin ${q.instant} dB`] : []),
      ...(ber ? [`Pre-FEC BER ${ber.instant.toExponential(2).toUpperCase()}`] : []),
      ...(laserOff ? [`Laser off at ${a}`] : []),
      ...alarms.map((x) => `${x.severity} ${x['alarm-abbreviate']} at ${b}: ${x.text}`),
    ],
  };
}

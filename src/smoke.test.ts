import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import box3 from '../examples/box3.olst.json';
import demo from '../examples/demo.olst.json';
import { byId, catalogFor, cli, cliAddress, nextMode, streams } from './catalog';
import { discover, light, stateFor, type BoxState } from './live';
import { layout, moveRun } from './route';
import { alarms, fiberError, linecardError, pluggableError, validate, wired } from './rules';
import type { Topology } from './types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 1-7-5's powers at the end of run 20261103-104506-connect: its last poll of `show och 1-7-5`. */
const [TX, RX] = [-2.98, -7.57];

describe.each(streams)('stream $id', ({ id }) => {
  const cat = catalogFor(id);

  const slotFits = (columns: number, index: number, width = 1) => width <= 1 || (index % columns) + width <= columns;

  it('includes profile-backed hardware for this stream', () => {
    expect(cat.chassis.length, `${id}: no chassis`).toBeGreaterThan(0);
    expect(cat.linecards.length, `${id}: no linecards`).toBeGreaterThan(0);
    expect(cat.pluggables.length, `${id}: no pluggables`).toBeGreaterThan(0);
    for (const chassis of cat.chassis) {
      expect(chassis.slots.length, `${id}:${chassis.id} has no slots`).toBeGreaterThan(0);
      expect(chassis.slots.some((slot) => slot.allowedLinecards.length > 0), `${id}:${chassis.id} has no allowed cards`).toBe(true);
    }
  });

  it('only references hardware that exists in the stream', () => {
    const plugs = new Set(cat.pluggables.flatMap((p) => [p.id, p.formFactor]));
    for (const c of cat.chassis) for (const s of c.slots) for (const lc of s.allowedLinecards) expect(byId(cat.linecards, lc), lc).toBeDefined();
    for (const lc of cat.linecards) for (const p of lc.ports) for (const a of p.allowedPluggables) expect(plugs.has(a), a).toBe(true);
  });

  it('keeps width-based slot restrictions per chassis/stream', () => {
    for (const chassis of cat.chassis) {
      const columns = chassis.columns ?? chassis.slots.length;
      chassis.slots.forEach((slot, i) => {
        for (const linecardId of slot.allowedLinecards) {
          const width = byId(cat.linecards, linecardId)?.width ?? 1;
          expect(slotFits(columns, i, width), `${id}:${chassis.id}:${slot.id} should not allow ${linecardId}`).toBe(true);
        }
      });
    }
  });
});

it('fills CLI templates', () => {
  const cat = catalogFor('csp');
  expect(cli(cat, 'chassis', { chassis: 2 })).toBe('show chassis 2');
  expect(cli(cat, 'card', { chassis: 1, slot: '3' })).toBe('show card 1-3');
  // The box's own port names (box 3): an 800MX's PORT4 is 4, a C1125's AD1 is ad1.
  expect(cli(cat, 'pluggable', { chassis: 1, slot: '7', port: 'PORT4' })).toBe('show transceiver 1-7-4');
  expect(cli(cat, 'port', { chassis: 1, slot: '7', port: 'PORT5' })).toBe('show port 1-7-5');
  expect(cliAddress(1, '1', 'AD1')).toBe('1-1-ad1');
  expect(cliAddress(1, '1', 'LINE')).toBe('1-1-line');
  expect(cliAddress(1, '7')).toBe('1-7');
});

it('follows the CLI mode: configure, ^^^, bash and kgdb go one deeper, exit one back', () => {
  const cat = catalogFor('csp');
  const after = (commands: string[]) => commands.reduce((m, c) => nextMode(cat, m, c), 0);
  expect(['configure', '^^^', 'bash', 'kgdb'].map((_, i, all) => cat.cli.modes[after(all.slice(0, i + 1))].name))
    .toEqual(['Configure', 'Engineering', 'Bash', 'kgdb']);
  expect(after(['show card 1-3', 'bash', 'configure'])).toBe(1); // bash only works from Engineering
  expect(after(['configure', '^^^', 'exit'])).toBe(1);
  expect(after(['exit'])).toBe(0);
});

it('keeps stream-only hardware out of other streams', () => {
  const tencent = new Set(catalogFor('tencent').pluggables.map((p) => p.id));
  const csp = new Set(catalogFor('csp').pluggables.map((p) => p.id));
  expect([...tencent].some((id) => !csp.has(id))).toBe(true);
  expect([...csp].some((id) => !tencent.has(id))).toBe(true);
});

it('includes a CSP BERT tester chassis with two 100G client ports', () => {
  const cat = catalogFor('csp');
  const bertChassis = byId(cat.chassis, 'ch-bert-tester');
  const bertCard = byId(cat.linecards, 'lc-bert-tester');
  expect(bertChassis?.slots).toEqual([{ id: '1', allowedLinecards: ['lc-bert-tester'] }]);
  expect(bertCard?.ports.map((p) => p.id)).toEqual(['P1', 'P2']);
  expect(bertCard?.ports.every((p) => p.role === 'client')).toBe(true);
  expect(pluggableError(cat, 'lc-bert-tester', 'P1', 'c100q10000lr402f')).toBeNull();
  expect(pluggableError(cat, 'lc-bert-tester', 'P2', 'ctq1mlr4cs1-01')).toBeNull();
  expect(pluggableError(cat, 'lc-bert-tester', 'P1', '60g800001')).toBe('60G800001 is not allowed in port P1 of BERT Tester');
  const empty = { id: 'bert-1', chassis: 'ch-bert-tester', name: 'BERT-1', x: 0, y: 0, slots: {} };
  expect(linecardError(cat, empty, '1', 'lc-bert-tester')).toBeNull();
});

it('loads every stream pluggable at runtime', () => {
  for (const { id: streamId } of streams) {
    const streamPath = resolve(repoRoot, `catalog/${streamId}/pluggables.json`);
    if (!existsSync(streamPath)) continue;

    const streamIds = new Set((JSON.parse(readFileSync(streamPath, 'utf8')) as { id: string }[]).map((pluggable) => pluggable.id));
    const runtimeIds = new Set(catalogFor(streamId).pluggables.map((pluggable) => pluggable.id));

    expect([...streamIds].every((id) => runtimeIds.has(id)), `${streamId}: stream pluggables missing at runtime`).toBe(true);
  }
});

// Box 3 as drawn. The one problem is the catalog's: its 800MX takes no QSFP-DD, but box 3 runs a DCO in 1-7-5.
it('draws box 3 with its real parts', () => {
  const t = box3 as unknown as Topology;
  expect(validate(t, catalogFor(t.stream))).toEqual([]);
});

describe('rules on the demo topology', () => {
  const t = demo as unknown as Topology;
  const cat = catalogFor(t.stream);
  const at = (device: string, slot: string, port: string) => ({ device, slot, port });

  it('is valid', () => expect(validate(t, cat)).toEqual([]));

  it('places a 2-slot card across its right neighbour', () => {
    const siteA = t.devices[0]; // C925 in slot 1 also takes slot 2
    expect(linecardError(cat, siteA, '2', 'lc-400mx')).toBe('Slot 2 is taken by the card in slot 1');
    expect(linecardError(cat, siteA, '4', 'lc-800mx')).toBeNull();
    expect(linecardError(cat, siteA, '5', 'lc-c25')).toBeNull();
  });

  it('accepts only supported pluggables per port', () => {
    expect(pluggableError(cat, 'lc-400mx', 'L1', '60s140001')).toBeNull();
    expect(pluggableError(cat, 'lc-400mx', 'L1', '60g800001')).toBe('60G800001 is not allowed in port L1 of 400MX');
  });

  it('keeps fixed ports fixed on C cards', () => {
    expect(pluggableError(cat, 'lc-c925', 'AD1', '60g700001')).toBe('Port AD1 of C925 has fixed Tx/Rx and takes no pluggable');
    expect(fiberError(t, cat, at('d1', '1', 'AD3'), at('d2', '1', 'AD3'))).toBeNull();
  });

  it('refuses bad fibers with a reason', () => {
    expect(fiberError(t, cat, at('d1', '3', 'C3'), at('d2', '1', 'C3'))).toBe('Site-A/3/C3 has no pluggable');
    expect(fiberError(t, cat, at('d1', '1', 'LINE'), at('d2', '1', 'AD1'))).toBe('Site-A/1/LINE Tx already has a fiber');
    expect(fiberError(t, cat, at('d2', '1', 'AD1'), at('d1', '1', 'LINE'))).toBe('Site-A/1/LINE Rx already has a fiber');
    expect(fiberError(t, cat, at('d1', '1', 'AD1'), at('d1', '1', 'AD2'))).toBe('Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)');
    expect(fiberError(t, cat, at('d1', '1', 'AD1'), at('d1', '1', 'AD1'))).toBe('Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)');
    expect(fiberError(t, cat, at('d1', '1', 'AD1'), at('d2', '1', 'AD1'))).toBeNull();
  });

  it('allows LR4-to-LR4 daisy chaining between two ports on the same 800MX', () => {
    const daisy = structuredClone(t);
    daisy.devices[0].slots['4'] = {
      linecard: 'lc-800mx',
      ports: { PORT1: { pluggable: 'c100q10000lr402f' }, PORT2: { pluggable: 'ctq1mlr4cs1-01' }, PORT3: { pluggable: '60g800001' } },
    };
    expect(fiberError(daisy, cat, at('d1', '4', 'PORT1'), at('d1', '4', 'PORT2'))).toBeNull();
    expect(fiberError(daisy, cat, at('d1', '4', 'PORT1'), at('d1', '4', 'PORT3')))
      .toBe('Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)');
  });

  it('runs each strand on its own: a Tx and the Rx of the same port may go to different ports', () => {
    const one = { ...t, links: [...t.links, { id: 'f9', type: 'smf' as const, a: at('d1', '1', 'AD1'), b: at('d2', '1', 'AD1') }] };
    expect(fiberError(one, cat, at('d2', '1', 'AD1'), at('d1', '3', 'C1'))).toBeNull(); // d2 AD1's Tx elsewhere
    expect(fiberError(one, cat, at('d2', '3', 'C1'), at('d1', '1', 'AD1'))).toBeNull(); // d1 AD1's Rx from elsewhere
    expect(fiberError(one, cat, at('d1', '1', 'AD1'), at('d2', '3', 'C1'))).toBe('Site-A/1/AD1 Tx already has a fiber');
  });

  it('loops a line port back, Tx to its own Rx', () => {
    const free = { ...t, links: t.links.filter((l) => l.id !== 'f3') };
    expect(fiberError(free, cat, at('d1', '3', 'L1'), at('d1', '3', 'L1'))).toBeNull();
    expect(alarms(free, cat, t.devices[0]).map((a) => `${a.slot}/${a.port}`)).toContain('3/L1'); // LOS until it is looped
  });

  it('re-validation lists cards that are disallowed or overlap', () => {
    const bad = structuredClone(t);
    bad.devices[0].slots['4'] = { linecard: 'lc-c925', ports: {} };
    bad.devices[1].slots['2'] = { linecard: 'lc-400mx', ports: {} };
    expect(validate(bad, cat)).toEqual([
      'Site-A: C925 is not allowed in slot 4 of 8-Slot Chassis',
      'Site-B: Slot 2 is taken by the card in slot 2',
      'Site-B: Slot 2 is taken by the card in slot 1',
    ]);
  });

  it('raises LOS on each pluggable or fixed port without a fiber and an alarm per empty back bay', () => {
    const siteA = { ...t.devices[0], emptyBays: ['PSU2', 'FAN3'] };
    const raised = alarms(t, cat, siteA).map((a) => [a.severity, a.bay ?? `${a.slot}/${a.port}`]);
    expect(raised).toContainEqual(['critical', '1/AD1']);
    expect(raised).toContainEqual(['critical', '3/C1']);
    expect(raised).toContainEqual(['critical', '3/C2']);
    expect(raised).toContainEqual(['major', 'PSU2']);
    expect(raised).toContainEqual(['major', 'FAN3']);
    expect(raised).not.toContainEqual(['critical', '1/LINE']);
  });
});

it('routes fibers in straight runs around devices, spreads shared runs, hops crossings and moves runs', () => {
  const box = (x: number, y = 0) => ({ x, y, w: 100, h: 60 });
  const [a, b, c] = [box(0), box(200, 40), box(400)];
  const port = (r: typeof a, dx: number) => ({ x: r.x + dx, y: r.y + r.h - 5 });
  const f1 = { id: 'f1', src: port(a, 30), dst: port(c, 30), srcBox: a, dstBox: c };
  const f2 = { id: 'f2', src: port(a, 60), dst: port(c, 60), srcBox: a, dstBox: c };
  const routes = layout([f1, f2], [a, b, c]);
  const pts = routes.get('f1')!.pts;
  expect(pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y)).toBe(true);
  // b hangs lower, so the fiber passes under it, clear of it
  expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(b.y + b.h + 10);
  // the two fibers share the run under b, so they are spread apart
  const low = (id: string) => Math.max(...routes.get(id)!.pts.map((p) => p.y));
  expect(Math.abs(low('f1') - low('f2'))).toBe(18);
  // f1's run crosses f2's port drop, so it hops
  expect(routes.get('f1')!.d).toContain('A');
  // moving the long run up into b is refused, down is kept
  const run = pts.findIndex((p, i) => i && p.y === pts[i + 1]?.y && p.y === low('f1'));
  expect(moveRun(f1, pts, run, 0, -60, [a, b, c])).toBeNull();
  expect(moveRun(f1, pts, run, 0, 40, [a, b, c])!.some((p) => p.y === low('f1') + 40)).toBe(true);
});

describe('light on box 3 from run 1', async () => {
  // The bridge's own reader of a run, as /bridge/state serves it with no box connected.
  const { latest } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/recorder.mjs'));
  const s: BoxState = { live: false, ...latest('run-01-healthy') };
  const t = box3 as unknown as Topology;
  const [f03, f04] = t.links;

  it('is never a run whose snapshot was cut short', () => {
    expect(latest().run).not.toBe('20261102-121608-alarms'); // the session closed 9 commands in
    expect(latest('20261102-121608-alarms').run).toBe('20261102-121608-alarms'); // unless asked for by name
  });

  it('belongs to box 3 only', () => {
    expect(stateFor(s, t.devices[0])).toBe(s);
    expect(stateFor(s, { ...t.devices[0], host: '10.0.0.1' })).toBeNull();
  });

  it('puts the line Tx on F03 and the line Rx, OSNR, Q-margin and BER on F04', () => {
    const lit03 = light(s, t, f03)!;
    expect(lit03).toMatchObject({ dark: false, tx: -2.97, rx: undefined });
    // Run 1 has no `show optical-port`, so 1-1-ad11 (L0) has no value. (Its standing IN_OPTICAL_HIGH_WARNING is lost in
    // run 1: the hand capture's last `show alarm` line was a completion listing, `[filter]`, which parses empty.)
    expect(lit03.notes).toEqual(['Tx 1-7-5: -2.97 dBm']);
    const lit04 = light(s, t, f04)!;
    expect(lit04).toMatchObject({ dark: false, tx: undefined, rx: -7.43 });
    expect(lit04.notes).toEqual(expect.arrayContaining(['OSNR 29.7 dB', 'Q-margin 3.4 dB']));
  });

  it('goes dark on a loss of signal at the Rx end, or with the laser off at the Tx end', () => {
    const alarm = { resource: 'och 1-7-5', severity: 'CRITICAL', 'alarm-abbreviate': 'LOS', text: 'Loss of signal' };
    const los: BoxState = { ...s, commands: { ...s.commands, 'show alarm': { at: 0, data: { alarms: { x: alarm } } } } };
    expect(light(los, t, f04)!.dark).toBe(true);
    expect(light(los, t, f03)!.dark).toBe(false);
    const ports = structuredClone(s.commands['show port'].data);
    ports.state.ports['1-7-5'].laser = 'disabled';
    const off: BoxState = { ...s, commands: { ...s.commands, 'show port': { at: 0, data: ports } } };
    expect(light(off, t, f03)!.dark).toBe(true);
  });
});

describe('light on box 3 with the fibers on AD11', async () => {
  const { latest } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/recorder.mjs'));
  const s: BoxState = { live: false, ...latest('20261103-104506-connect') };
  const t = box3 as unknown as Topology;
  const [f03, f04] = t.links;

  it('reads the C1125 ends from show optical-port, with its flag, and the alarm there', () => {
    const lit03 = light(s, t, f03)!;
    expect(lit03).toMatchObject({ dark: false, tx: TX, rx: 2.61 });
    expect(lit03.notes).toEqual([
      `Tx 1-7-5: ${TX.toFixed(2)} dBm`, 'Rx 1-1-ad11: 2.61 dBm, flag C', `Tx − Rx: ${(TX - 2.61).toFixed(2)} dB`,
      'Rx 1-1-ad11: IN_OPTICAL_HIGH_WARNING: 2.61 dBm stands, declared over 3.00, clears under 2.50',
      'MAJOR IN_OPTICAL_HIGH_WARNING at 1-1-ad11: Input Optical Power higher than warning threshold',
    ]);
    const lit04 = light(s, t, f04)!;
    expect(lit04).toMatchObject({ dark: false, tx: -10.1, rx: RX });
    expect(lit04.notes.slice(0, 3)).toEqual(['Tx 1-1-ad11: -10.10 dBm, flag C', `Rx 1-7-5: ${RX.toFixed(2)} dBm`, `Tx − Rx: ${(-10.1 - RX).toFixed(2)} dB`]);
  });

  it('goes dark on a loss of signal at the C1125', () => {
    const alarm = { resource: 'port 1-1-ad11', severity: 'CRITICAL', 'alarm-abbreviate': 'LOS', text: 'Loss of signal' };
    const los: BoxState = { ...s, commands: { ...s.commands, 'show alarm': { at: 0, data: { alarms: { x: alarm } } } } };
    expect(light(los, t, f03)!.dark).toBe(true);
    expect(light(los, t, f04)!.dark).toBe(false);
  });

  it('shows no dBm on 1-7-5 while it reads 0 everywhere, as after a reboot', () => {
    const zero = (cmd: string) => {
      const { stats } = s.commands[cmd].data.state;
      const zeroed = Object.fromEntries(Object.entries(stats).map(([k, v]: [string, any]) => [k, { ...v, instant: 0, avg: 0, min: 0, max: 0 }]));
      return { at: 0, data: { ...s.commands[cmd].data, state: { ...s.commands[cmd].data.state, stats: zeroed } } };
    };
    const rebooted: BoxState = { ...s, commands: { ...s.commands, 'show och 1-7-5': zero('show och 1-7-5'), 'show transceiver 1-7-5': zero('show transceiver 1-7-5') } };
    expect(light(rebooted, t, f03)!.tx).toBeUndefined();
    expect(light(rebooted, t, f04)!.rx).toBeUndefined();
  });
});

describe('connect draws box 3', async () => {
  // The first connect run with every command in, as /bridge/state serves the poller's results while connected.
  const { latest, wiring } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/recorder.mjs'));
  const s: BoxState = { ...latest('20261101-200025-connect'), live: true };
  const t = box3 as unknown as Topology;
  const cat = catalogFor(t.stream);
  const empty = { ...t.devices[0], slots: {} };

  it('puts in cards and box pluggables from inventory, including parts missing from the stream catalog', () => {
    const found = discover(cat, empty, s)!;
    expect(found.missing).toEqual([]);
    expect(found.slots).toMatchObject({
      '1': t.devices[0].slots['1'],
      '7': { linecard: 'lc-800mx', ports: { PORT5: { pluggable: 'ftcd3323r1pcl-1y' } } },
      '8': t.devices[0].slots['8'],
    });
    const port4 = found.slots['7'].ports.PORT4?.pluggable;
    expect(port4).toBeTruthy();
    const discovered = byId(cat.pluggables, port4);
    expect(discovered).toMatchObject({
      id: port4,
      name: 'QSFP-LR4-100G',
      part: 'QSFP-LR4-100G',
      vendor: 'FS',
      formFactor: 'QSFP',
      speed: '100G',
      fiber: 'SMF',
    });
  });

  it('waits for show card and show inventory', () => {
    expect(discover(cat, empty, { ...s, commands: {} })).toBeNull();
  });

  it("runs wiring.csv's fibers between its ports, as box3.olst.json draws them, not the BERT's", () => {
    const d = { ...empty, slots: discover(cat, empty, s)!.slots };
    const { links, refused } = wired(cat, { ...t, links: [] }, d, wiring());
    expect(links).toEqual(t.links);
    expect(refused).toEqual([]);
    // F05, the line looped back through ATT1: out of 1-1-line and back into it.
    expect(light(s, t, links[2])).toMatchObject({ dark: false, tx: 2.48, rx: -4.06 });
  });
});

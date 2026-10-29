import { describe, expect, it } from 'vitest';
import demo from '../examples/demo.olst.json';
import { byId, catalogFor, cli, nextMode, streams } from './catalog';
import { layout, moveRun } from './route';
import { alarms, fiberError, linecardError, pluggableError, validate } from './rules';
import type { Topology } from './types';

describe.each(streams)('stream $id', ({ id }) => {
  const cat = catalogFor(id);

  it('has the 2000, 2026 (2U) and 2026-4RU (4U) chassis and the C and MX variants from common/', () => {
    expect(cat.chassis.map((c) => [c.name, c.slots.length / (c.columns ?? c.slots.length), c.psus, c.fans])).toEqual([
      ['2000', 2, 2, 3], ['2026', 2, 2, 3], ['2026-4RU', 4, 2, 3],
    ]);
    expect(cat.linecards.map((c) => [c.name, c.width ?? 1, c.ports.length])).toEqual([
      ['C25', 2, 1], ['C925', 2, 9], ['C1125', 2, 11], ['400MX', 1, 4], ['800MX', 1, 8],
    ]);
  });

  it('only references hardware that exists in the stream', () => {
    const plugs = new Set(cat.pluggables.flatMap((p) => [p.id, p.formFactor]));
    for (const c of cat.chassis) for (const s of c.slots) for (const lc of s.allowedLinecards) expect(byId(cat.linecards, lc), lc).toBeDefined();
    for (const lc of cat.linecards) for (const p of lc.ports) for (const a of p.allowedPluggables) expect(plugs.has(a), a).toBe(true);
  });
});

it('fills CLI templates', () => {
  const cat = catalogFor('corp-a');
  expect(cli(cat, 'chassis', { chassis: 2 })).toBe('show chassis 2');
  expect(cli(cat, 'card', { chassis: 1, slot: '3' })).toBe('show card 1-3');
  expect(cli(cat, 'pluggable', { chassis: 1, slot: '3', port: 'C2' })).toBe('show port 1-3-C2');
});

it('follows the CLI mode: configure, ^^^, bash and kgdb go one deeper, exit one back', () => {
  const cat = catalogFor('corp-a');
  const after = (commands: string[]) => commands.reduce((m, c) => nextMode(cat, m, c), 0);
  expect(['configure', '^^^', 'bash', 'kgdb'].map((_, i, all) => cat.cli.modes[after(all.slice(0, i + 1))].name))
    .toEqual(['Configure', 'Engineering', 'Bash', 'kgdb']);
  expect(after(['show card 1-3', 'bash', 'configure'])).toBe(1); // bash only works from Engineering
  expect(after(['configure', '^^^', 'exit'])).toBe(1);
  expect(after(['exit'])).toBe(0);
});

it('keeps stream-only hardware out of other streams', () => {
  expect(byId(catalogFor('corp-b').pluggables, 'osfp-1600g-dr8')).toBeDefined();
  expect(byId(catalogFor('corp-a').pluggables, 'osfp-1600g-dr8')).toBeUndefined();
});

describe('rules on the demo topology', () => {
  const t = demo as unknown as Topology;
  const cat = catalogFor(t.stream);
  const at = (device: string, slot: string, port: string) => ({ device, slot, port });

  it('is valid', () => expect(validate(t, cat)).toEqual([]));

  it('places a 2-slot card across its right neighbour', () => {
    const siteA = t.devices[0]; // C925 in slot 1 also takes slot 2
    expect(linecardError(cat, siteA, '2', 'lc-400mx')).toBe('Slot 2 is taken by the card in slot 1');
    expect(linecardError(cat, siteA, '2', 'lc-c1125')).toBe('C1125 is not allowed in slot 2 of 2000');
    expect(linecardError(cat, siteA, '4', 'lc-800mx')).toBeNull();
    expect(linecardError(cat, siteA, '5', 'lc-c25')).toBeNull();
  });

  it('fits every speed of a port form factor, and nothing else', () => {
    expect(pluggableError(cat, 'lc-400mx', 'L1', 'qsfp28-100g-lr4')).toBeNull();
    expect(pluggableError(cat, 'lc-400mx', 'L1', 'qsfp-dd-800g-zr')).toBeNull();
    expect(pluggableError(cat, 'lc-400mx', 'L1', 'osfp-800g-zr')).toBe('OSFP 800G ZR is not allowed in port L1 of 400MX');
  });

  it('takes no pluggable in a C card: its ports have fixed Tx/Rx', () => {
    expect(pluggableError(cat, 'lc-c925', 'L1', 'osfp-800g-zr')).toBe('Port L1 of C925 has fixed Tx/Rx and takes no pluggable');
    expect(fiberError(t, cat, at('d1', '1', 'C3'), at('d2', '1', 'C3'))).toBeNull();
  });

  it('refuses bad fibers with a reason', () => {
    expect(fiberError(t, cat, at('d1', '3', 'C3'), at('d2', '1', 'C3'))).toBe('Site-A/3/C3 has no pluggable');
    const mmf = structuredClone(t);
    mmf.devices[0].slots['3'].ports.C3 = { pluggable: 'qsfp28-100g-sr4' };
    expect(fiberError(mmf, cat, at('d1', '3', 'C3'), at('d2', '1', 'C1'))).toBe('Site-A/3/C3 is not single-mode (SMF)');
    expect(fiberError(t, cat, at('d1', '1', 'L1'), at('d2', '1', 'C1'))).toBe('Site-A/1/L1 Tx already has a fiber');
    expect(fiberError(t, cat, at('d2', '1', 'C1'), at('d1', '1', 'L1'))).toBe('Site-A/1/L1 Rx already has a fiber');
    expect(fiberError(t, cat, at('d1', '3', 'C1'), at('d1', '3', 'C2'))).toBe('Both ends are on the same card (only a line port loops back, Tx to its own Rx)');
    expect(fiberError(t, cat, at('d1', '1', 'C1'), at('d1', '1', 'C1'))).toBe('Both ends are on the same card (only a line port loops back, Tx to its own Rx)');
    expect(fiberError(t, cat, at('d1', '1', 'C1'), at('d2', '1', 'C1'))).toBeNull();
  });

  it('runs each strand on its own: a Tx and the Rx of the same port may go to different ports', () => {
    const one = { ...t, links: [...t.links, { id: 'f9', type: 'smf' as const, a: at('d1', '1', 'C1'), b: at('d2', '1', 'C1') }] };
    expect(fiberError(one, cat, at('d2', '1', 'C1'), at('d1', '3', 'C1'))).toBeNull(); // d2 C1's Tx elsewhere
    expect(fiberError(one, cat, at('d2', '3', 'C1'), at('d1', '1', 'C1'))).toBeNull(); // d1 C1's Rx from elsewhere
    expect(fiberError(one, cat, at('d1', '1', 'C1'), at('d2', '3', 'C1'))).toBe('Site-A/1/C1 Tx already has a fiber');
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
      'Site-A: C925 is not allowed in slot 4 of 2000',
      'Site-B: Slot 2 is taken by the card in slot 2',
      'Site-B: Slot 2 is taken by the card in slot 1',
    ]);
  });

  it('raises LOS on each pluggable or fixed port without a fiber and an alarm per empty back bay', () => {
    const siteA = { ...t.devices[0], emptyBays: ['PSU2', 'FAN3'] };
    const fixed = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'].map((p) => ['critical', `1/${p}`]); // C925's L1 is fibered
    expect(alarms(t, cat, siteA).map((a) => [a.severity, a.bay ?? `${a.slot}/${a.port}`])).toEqual([
      ...fixed, ['critical', '3/C1'], ['critical', '3/C2'], ['major', 'PSU2'], ['major', 'FAN3'],
    ]);
    expect(alarms(t, cat, t.devices[1])).toHaveLength(10); // all PSUs and fans in by default
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

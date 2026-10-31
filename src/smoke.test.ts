import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import demo from '../examples/demo.olst.json';
import { byId, catalogFor, cli, nextMode, streams } from './catalog';
import { layout, moveRun } from './route';
import { alarms, fiberError, linecardError, pluggableError, validate } from './rules';
import type { Topology } from './types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  expect(cli(cat, 'pluggable', { chassis: 1, slot: '3', port: 'C2' })).toBe('show transceiver 1-3-C2');
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

it('loads every stream pluggable at runtime', () => {
  for (const { id: streamId } of streams) {
    const streamPath = resolve(repoRoot, `catalog/${streamId}/pluggables.json`);
    if (!existsSync(streamPath)) continue;

    const streamIds = new Set((JSON.parse(readFileSync(streamPath, 'utf8')) as { id: string }[]).map((pluggable) => pluggable.id));
    const runtimeIds = new Set(catalogFor(streamId).pluggables.map((pluggable) => pluggable.id));

    expect([...streamIds].every((id) => runtimeIds.has(id)), `${streamId}: stream pluggables missing at runtime`).toBe(true);
  }
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

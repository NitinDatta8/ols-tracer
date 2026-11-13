// The app's store, action by action, on the CSP catalog: devices and racks, cards, pluggables and fibers with the
// toasts that refuse them, a box's parts filled in, the lab opened, locked and read-only, and the browser's copy, read
// back from one saved before ids were renamed. The browser's localStorage is a stand-in here, set before the store loads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import lab from '../../catalog/csp/lab.olst.json';
import type { Topology } from '../../src/types';

const saved = vi.hoisted(() => {
  const items = new Map<string, string>();
  const old = { version: 1, stream: 'corp-a', links: [], devices: [{ id: 'd1', chassis: 'ch-2000', name: 'Site-1', x: 0, y: 0, slots: { 1: { linecard: 'lc-c11', ports: {} }, 7: { linecard: 'lc-mx8', ports: {} } } }] };
  items.set('ols-tracer', JSON.stringify({ state: { topology: old, view: 'L1' }, version: 1 }));
  const localStorage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
  Object.assign(globalThis, { window: { localStorage } }); // where zustand's persist looks for it
  return items;
});
const { useStore } = await import('../../src/store');
const s = () => useStore.getState();
const topology = () => s().topology!;
const at = (device: string, slot: string, port: string) => ({ device, slot, port });
const hydrated = { topology: s().topology, view: s().view };

it('picks up the autosave from before ids were renamed, and saves only the topology and the view', () => {
  expect(hydrated.topology).toMatchObject({ stream: 'csp', devices: [{ chassis: 'ch-8slot', slots: { 1: { linecard: 'lc-c1125' }, 7: { linecard: 'lc-800mx' } } }] });
  expect(hydrated.view).toBe('L1');
  s().setView('Data');
  expect(JSON.parse(saved.get('ols-tracer')!)).toEqual({ state: { topology: topology(), view: 'Data' }, version: 2 });
});

beforeEach(() => {
  useStore.setState({ readOnly: null, unlocked: false });
  s().load({ version: 1, stream: 'csp', devices: [], links: [], racks: [] });
});

describe('devices and racks', () => {
  it('names a device after its number, a tester after itself with its module in, and never reuses a number above', () => {
    s().addDevice('ch-8slot', 10, 20);
    s().addDevice('ch-8slot', 0, 0);
    s().addDevice('ch-bert-tester', 0, 0);
    expect(topology().devices.map((d) => [d.id, d.name, d.slots])).toEqual([['d1', 'Site-1', {}], ['d2', 'Site-2', {}], ['d3', 'BERT-3', { 1: { linecard: 'lc-bert-tester', ports: {} } }]]);
    expect(topology().devices[0]).toMatchObject({ x: 10, y: 20 });
    s().deleteDevice('d2');
    s().addDevice('ch-8slot', 0, 0);
    expect(topology().devices.map((d) => d.id)).toEqual(['d1', 'd3', 'd4']);
  });

  it('stacks devices in a rack where they are dropped, never twice, and leaves them on the canvas when it goes', () => {
    s().addRack(100, 50);
    s().addDevice('ch-8slot', 0, 0, { rack: 'r1', index: 0 });
    s().addDevice('ch-8slot', 0, 0, { rack: 'r1', index: 0 });
    expect(topology().racks).toEqual([{ id: 'r1', name: 'Rack-1', x: 100, y: 50, devices: ['d2', 'd1'] }]);
    s().place('d2', { rack: 'r1', index: 99 });
    expect(topology().racks![0].devices).toEqual(['d1', 'd2']);
    s().place('d2', { rack: 'r1', index: -5 });
    expect(topology().racks![0].devices).toEqual(['d2', 'd1']);
    s().place('d1', { x: 5, y: 6 });
    expect([topology().racks![0].devices, topology().devices[0].x]).toEqual([['d2'], 5]);
    s().moveRack('r1', 1, 2);
    s().deleteRack('r1', { d2: { x: 7, y: 8 } });
    expect([topology().racks, topology().devices[1]]).toEqual([[], expect.objectContaining({ id: 'd2', x: 7, y: 8 })]);
    s().place('d1', { rack: 'gone', index: 0 }); // a rack that isn't there takes nothing
    expect(topology().racks).toEqual([]);
  });

  it("takes a device's fibers and rack place with it, and closes its view", () => {
    s().addRack(0, 0);
    s().addDevice('ch-8slot', 0, 0, { rack: 'r1', index: 0 });
    s().addDevice('ch-8slot', 0, 0);
    s().insertLinecard('d1', '1', 'lc-c1125');
    s().insertLinecard('d2', '1', 'lc-c1125');
    s().connect(at('d1', '1', 'AD1'), at('d2', '1', 'AD1'));
    s().setOpenDevice('d1', '1');
    s().deleteDevice('d1');
    expect([topology().links, topology().racks![0].devices, s().openDevice]).toEqual([[], [], null]);
  });
});

describe('cards, pluggables and fibers', () => {
  beforeEach(() => {
    s().addDevice('ch-8slot', 0, 0);
    s().addDevice('ch-8slot', 0, 0);
    s().insertLinecard('d1', '1', 'lc-c1125');
    s().insertLinecard('d1', '7', 'lc-800mx');
    s().insertLinecard('d2', '1', 'lc-c1125');
  });

  it('refuses a card on a slot taken, or one it may not go in, with a toast saying why', () => {
    s().insertLinecard('d1', '7', 'lc-400mx');
    expect(s().toast).toBe('Slot 7 already has a card');
    s().insertLinecard('d1', '2', 'lc-800mx');
    expect(s().toast).toBe('Slot 2 is taken by the card in slot 1');
    s().insertLinecard('d1', '3', 'lc-bert-tester');
    expect(s().toast).toBe('BERT Tester is not allowed in slot 3 of 8-Slot Chassis');
    expect(Object.keys(topology().devices[0].slots)).toEqual(['1', '7']);
  });

  it('refuses a pluggable on a port taken, or into a fixed one, with a toast saying why', () => {
    s().insertPluggable('d1', '7', 'PORT4', 'c100q10000lr402f');
    expect(topology().devices[0].slots[7].ports).toEqual({ PORT4: { pluggable: 'c100q10000lr402f' } });
    s().insertPluggable('d1', '7', 'PORT4', 'ctq1mlr4cs1-01');
    expect(s().toast).toBe('Port PORT4 already has a pluggable');
    s().insertPluggable('d1', '1', 'AD1', 'c100q10000lr402f');
    expect(s().toast).toBe('Port AD1 of C1125 has fixed Tx/Rx and takes no pluggable');
  });

  it('joins two ports with a fiber, refuses one onto a strand taken, and drops the fibers of what is taken out', () => {
    s().insertPluggable('d1', '7', 'PORT4', 'c100q10000lr402f');
    s().connect(at('d1', '7', 'PORT4'), at('d2', '1', 'AD1'));
    s().connect(at('d2', '1', 'AD2'), at('d1', '1', 'AD3'));
    expect(topology().links.map((l) => l.id)).toEqual(['f1', 'f2']);
    s().connect(at('d1', '7', 'PORT4'), at('d2', '1', 'AD3'));
    expect(s().toast).toBe('Fiber refused: Site-1/7/PORT4 Tx already has a fiber');
    s().remove(at('d1', '7', 'PORT4'));
    expect([topology().devices[0].slots[7].ports, topology().links.map((l) => l.id)]).toEqual([{}, ['f2']]);
    s().remove({ device: 'd1', slot: '1' });
    expect([Object.keys(topology().devices[0].slots), topology().links]).toEqual([['7'], []]);
  });

  it("keeps a fiber's route per view until it is cleared, and a link that isn't there is no harm", () => {
    s().connect(at('d1', '1', 'AD1'), at('d2', '1', 'AD1'));
    s().setRoute('f1', 'canvas', [{ x: 1, y: 2 }]);
    s().setRoute('f1', 'chassis:d1', [{ x: 3, y: 4 }]);
    s().setRoute('f1', 'canvas');
    s().setRoute('nope', 'canvas', []);
    expect(topology().links[0].routes).toEqual({ 'chassis:d1': [{ x: 3, y: 4 }] });
    s().deleteLink('f1');
    expect(topology().links).toEqual([]);
  });

  it("fills a device from its box: its wired fibers anew, a hand-drawn one kept while its ends are there, others' untouched", () => {
    s().insertPluggable('d1', '7', 'PORT4', 'c100q10000lr402f');
    s().connect(at('d1', '7', 'PORT4'), at('d2', '1', 'AD1')); // f1, by hand
    s().connect(at('d2', '1', 'AD2'), at('d1', '1', 'AD2')); // f2, by hand
    s().fill('d1', topology().devices[0].slots, [{ id: 'F01', type: 'smf', a: at('d1', '1', 'AD3'), b: at('d2', '1', 'AD3') }]);
    expect(topology().links.map((l) => l.id)).toEqual(['f1', 'f2', 'F01']);
    // The box says 1-7 has no transceiver in PORT4, and F01 is wired again as F02.
    s().fill('d1', { ...topology().devices[0].slots, 7: { linecard: 'lc-800mx', ports: {} } }, [{ id: 'F02', type: 'smf', a: at('d1', '1', 'AD4'), b: at('d2', '1', 'AD4') }]);
    expect(topology().links.map((l) => l.id)).toEqual(['f2', 'F02']);
    s().fill('gone', {}, []);
    expect(topology().links.map((l) => l.id)).toEqual(['f2', 'F02']);
    // A strand of d2's named after its box, as another box has its name, goes too once d2's box no longer has it.
    s().fill('d2', topology().devices[1].slots, [{ id: 'F02@D2', type: 'smf', a: at('d2', '1', 'AD5'), b: at('d2', '1', 'AD6') }]);
    expect(topology().links.map((l) => l.id)).toEqual(['f2', 'F02@D2']); // F02 here ends on d2 too
    s().fill('d2', topology().devices[1].slots, []);
    expect(topology().links.map((l) => l.id)).toEqual(['f2']);
  });
});

describe('the lab', () => {
  const LOCKED = 'Locked: unlock the lab (🔒) to add, delete or move a chassis or a rack, or to change a box IP';

  it("opens the lab file, the repo's too, as a topology of a known stream, ids renamed, and else shows it read-only, saying why", () => {
    s().openLab(structuredClone(lab) as unknown as Topology, 5);
    expect([topology().devices.length, topology().lock?.sha256, s().labMtime, s().readOnly]).toEqual([9, lab.lock.sha256, 5, null]);
    s().openLab({ version: 1, stream: 'corp-b', links: [], devices: [{ id: 'd1', chassis: 'ch-2026-4ru', name: 'S', x: 0, y: 0, slots: {} }] }, 7);
    expect(topology()).toMatchObject({ stream: 'tencent', devices: [{ chassis: 'ch-16slot' }] });
    expect([s().labMtime, s().readOnly]).toEqual([7, null]);
    const before = topology();
    const why = 'The lab file is not a valid .olst.json for a known stream';
    for (const bad of [{ version: 2, stream: 'csp', devices: [], links: [] }, { version: 1, stream: 'nope', devices: [], links: [] }, { version: 1, stream: 'csp', devices: [{ id: 'd1' }], links: [] }]) {
      useStore.setState({ toast: null, readOnly: null });
      s().openLab(bad as unknown as Topology, 8);
      expect([s().toast, s().readOnly, s().labMtime], JSON.stringify(bad)).toEqual([why, why, 7]);
      expect(topology()).toBe(before);
    }
  });

  it('locked, adds, deletes or moves no chassis or rack, nor changes a box IP; cards, pluggables, fibers and bays stay free', () => {
    s().addRack(0, 0);
    s().addDevice('ch-8slot', 0, 0, { rack: 'r1', index: 0 });
    s().addDevice('ch-8slot', 50, 50);
    s().load({ ...topology(), lock: { sha256: lab.lock.sha256 } });
    const before = topology();
    for (const change of [() => s().addDevice('ch-8slot', 0, 0), () => s().addRack(1, 1), () => s().moveRack('r1', 5, 5), () => s().deleteRack('r1'),
      () => s().place('d1', { x: 1, y: 1 }), () => s().deleteDevice('d2'), () => s().updateDevice('d2', { x: 9, y: 9 }), () => s().updateDevice('d2', { host: 'box.test' })]) {
      useStore.setState({ toast: null });
      change();
      expect([s().toast, topology()]).toEqual([LOCKED, before]);
    }
    s().insertLinecard('d1', '1', 'lc-c1125');
    s().insertLinecard('d1', '7', 'lc-800mx');
    s().insertLinecard('d2', '1', 'lc-c1125');
    s().insertPluggable('d1', '7', 'PORT4', 'c100q10000lr402f');
    s().connect(at('d1', '1', 'AD1'), at('d2', '1', 'AD1'));
    s().setRoute('f1', 'canvas', [{ x: 1, y: 2 }]);
    s().updateDevice('d2', { emptyBays: ['PSU2'] });
    s().remove(at('d1', '7', 'PORT4'));
    expect([Object.keys(topology().devices[0].slots), topology().links.map((l) => l.id), topology().devices[1].emptyBays]).toEqual([['1', '7'], ['f1'], ['PSU2']]);
    s().deleteLink('f1');
    expect(topology().links).toEqual([]);
    s().setLab({ unlocked: true });
    s().addDevice('ch-8slot', 0, 0);
    s().updateDevice('d3', { host: 'box.test' });
    expect(topology().devices.map((d) => [d.id, d.host])).toEqual([['d1', undefined], ['d2', undefined], ['d3', 'box.test']]);
  });

  it("read-only, changes nothing but what the box reports, and says why", () => {
    s().addDevice('ch-8slot', 0, 0);
    s().insertLinecard('d1', '1', 'lc-c1125');
    const why = 'Bridge not running: the lab is shown as last loaded here, read-only. Start it with npm run bridge';
    s().setLab({ readOnly: why, unlocked: true });
    const before = topology();
    for (const change of [() => s().addDevice('ch-8slot', 0, 0), () => s().insertLinecard('d1', '7', 'lc-800mx'), () => s().insertPluggable('d1', '1', 'AD1', 'c100q10000lr402f'),
      () => s().connect(at('d1', '1', 'AD1'), at('d1', '1', 'AD2')), () => s().remove({ device: 'd1', slot: '1' }), () => s().updateDevice('d1', { emptyBays: ['FAN1'] })]) {
      useStore.setState({ toast: null });
      change();
      expect([s().toast, topology()]).toEqual([why, before]);
    }
    s().fill('d1', {});
    expect(topology().devices[0].slots).toEqual({});
  });
});

describe('the rest of the view', () => {

  it('selects one thing at a time, and lets go of it only when it is the one selected', () => {
    s().select('d1', true);
    s().select('f1', false);
    expect(s().selected).toBe('d1');
    s().select('d1', false);
    expect(s().selected).toBeNull();
    s().load(topology() as Topology);
    expect([s().selected, s().openDevice, s().openSlot]).toEqual([null, null, null]);
  });

  it('numbers terminal windows as they open, and clears a toast after 4 s, the last one counting', () => {
    s().openTerm({ host: 'box.test', steps: [], title: 'a' });
    s().openTerm({ host: 'box.test', steps: ['configure'], title: 'b' });
    const [a, b] = s().terms.map((t) => t.id);
    expect(b).toBe(a + 1);
    s().closeTerm(a);
    expect(s().terms.map((t) => t.title)).toEqual(['b']);
    vi.useFakeTimers();
    try {
      s().notify('one');
      vi.advanceTimersByTime(3000);
      s().notify('two');
      vi.advanceTimersByTime(3000);
      expect(s().toast).toBe('two');
      vi.advanceTimersByTime(1000);
      expect(s().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The rules on a catalog of its own: a 4-slot chassis two slots to a row, a 2-slot mux with fixed ports, a transponder
// and a client card, and SMF and MMF optics. Each rule's refusal, case by case, and the alarms a topology raises.
import { describe, expect, it } from 'vitest';
import { alarms, bays, coverage, fiberError, fibersAt, linecardError, path, pluggableError, resolve, sameEnd, span, touches, validate, wired } from '../../src/rules';
import type { Catalog, Device, End, LinecardDef, Link, Topology } from '../../src/types';

const cat: Catalog = {
  chassis: [{
    id: 'ch-4', name: '4-Slot', columns: 2, psus: 2, fans: 1,
    slots: [
      { id: '1', allowedLinecards: ['lc-mux', 'lc-tp', 'lc-client'] },
      { id: '2', allowedLinecards: ['lc-tp', 'lc-client'] },
      { id: '3', allowedLinecards: ['lc-mux', 'lc-tp'] },
      { id: '4', allowedLinecards: ['lc-mux', 'lc-tp'] },
    ],
  }],
  linecards: [
    { id: 'lc-mux', name: 'MUX', width: 2, ports: [{ id: 'LINE', role: 'line', allowedPluggables: [] }, { id: 'AD1', role: 'adddrop', allowedPluggables: [] }, { id: 'AD2', role: 'adddrop', allowedPluggables: [] }] },
    { id: 'lc-tp', name: 'TP', ports: [{ id: 'L1', role: 'line', allowedPluggables: ['QSFP'] }, { id: 'C1', role: 'client', allowedPluggables: ['sfp-lr'] }] },
    { id: 'lc-client', name: 'CLIENT', ports: [{ id: 'C1', role: 'client', behavior: { canLoopback: true }, allowedPluggables: ['SFP'] }, { id: 'C2', role: 'client', allowedPluggables: ['SFP'] }] },
  ],
  pluggables: [
    { id: 'sfp-lr', name: 'SFP LR', formFactor: 'SFP', speed: '10G', fiber: 'SMF' },
    { id: 'sfp-sr', name: 'SFP SR', formFactor: 'SFP', speed: '10G', fiber: 'MMF' },
    { id: 'qsfp-zr', name: 'QSFP ZR', formFactor: 'QSFP', speed: '400G', fiber: 'SMF' },
  ],
  cli: { chassis: '', card: '', port: '', pluggable: '', modes: [] },
};
const [chassis] = cat.chassis;
const device = (id: string, name: string, slots: Device['slots'], extra: Partial<Device> = {}): Device => ({ id, chassis: 'ch-4', name, x: 0, y: 0, slots, ...extra });
const a = device('d1', 'Site-A', {
  1: { linecard: 'lc-mux', ports: {} },
  3: { linecard: 'lc-tp', ports: { L1: { pluggable: 'qsfp-zr' }, C1: { pluggable: 'sfp-lr' } } },
});
const b = device('d2', 'Site-B', {
  1: { linecard: 'lc-client', ports: { C1: { pluggable: 'sfp-lr' }, C2: { pluggable: 'sfp-sr' } } },
  3: { linecard: 'lc-tp', ports: {} },
});
const at = (d: string, slot: string, port: string): End => ({ device: d, slot, port });
const link = (id: string, from: End, to: End): Link => ({ id, type: 'smf', a: from, b: to });
const t: Topology = { version: 1, stream: 'x', devices: [a, b], links: [link('f1', at('d1', '3', 'L1'), at('d1', '1', 'AD1')), link('f2', at('d1', '1', 'AD1'), at('d1', '3', 'L1'))] };

describe('slots', () => {
  it('spans a wide card rightwards only within its row', () => {
    expect([span(chassis, '1', 2), span(chassis, '3', 2), span(chassis, '3')]).toEqual([['1', '2'], ['3', '4'], ['3']]);
    expect([span(chassis, '2', 2), span(chassis, '4', 2), span(chassis, '9')]).toEqual([null, null, null]);
  });

  it("covers a wide card's right neighbour, but not when that card is the one being put back", () => {
    expect([...coverage(cat, a)]).toEqual([['1', '1'], ['2', '1'], ['3', '3']]);
    expect([...coverage(cat, a, '1')]).toEqual([['3', '3']]);
  });

  it('refuses a card it does not know, one the slot does not take, one with no room, and one over another card', () => {
    expect(linecardError(cat, a, '9', 'lc-tp')).toBe('Unknown chassis, slot or linecard (ch-4 / 9 / lc-tp)');
    expect(linecardError(cat, a, '2', 'lc-nope')).toBe('Unknown chassis, slot or linecard (ch-4 / 2 / lc-nope)');
    expect(linecardError(cat, { ...a, chassis: 'ch-9' }, '1', 'lc-tp')).toBe('Unknown chassis, slot or linecard (ch-9 / 1 / lc-tp)');
    expect(linecardError(cat, a, '3', 'lc-client')).toBe('CLIENT is not allowed in slot 3 of 4-Slot');
    expect(linecardError(cat, b, '4', 'lc-mux')).toBe('MUX needs 2 slots side by side from slot 4');
    expect(linecardError(cat, a, '2', 'lc-tp')).toBe('Slot 2 is taken by the card in slot 1');
    expect(linecardError(cat, device('d9', 'X', { 4: { linecard: 'lc-tp', ports: {} } }), '3', 'lc-mux')).toBe('Slot 4 is taken by the card in slot 4');
    expect(linecardError(cat, a, '1', 'lc-mux')).toBeNull(); // the card in the slot itself is the one replaced
    expect(linecardError(cat, b, '3', 'lc-mux')).toBeNull();
    expect(linecardError(cat, device('d9', 'X', {}), '3', 'lc-mux')).toBeNull();
  });

  it('takes a pluggable by its id or its family, never into a fixed port, and says why not', () => {
    expect(pluggableError(cat, 'lc-tp', 'L1', 'qsfp-zr')).toBeNull(); // the QSFP family
    expect(pluggableError(cat, 'lc-tp', 'C1', 'sfp-lr')).toBeNull(); // by id
    expect(pluggableError(cat, 'lc-tp', 'C1', 'sfp-sr')).toBe('SFP SR is not allowed in port C1 of TP');
    expect(pluggableError(cat, 'lc-mux', 'LINE', 'sfp-lr')).toBe('Port LINE of MUX has fixed Tx/Rx and takes no pluggable');
    expect(pluggableError(cat, 'lc-tp', 'C9', 'sfp-lr')).toBe('Unknown linecard, port or pluggable (lc-tp / C9 / sfp-lr)');
    expect(pluggableError(cat, 'lc-tp', 'C1', 'sfp-xx')).toBe('Unknown linecard, port or pluggable (lc-tp / C1 / sfp-xx)');
  });
});

describe('fibers', () => {
  it('finds what is at an end, and the fibers on a port by strand', () => {
    expect(resolve(t, cat, at('d1', '1', 'LINE'))).toMatchObject({ card: { id: 'lc-mux' }, port: { id: 'LINE' }, fixed: true });
    expect(resolve(t, cat, at('d1', '3', 'L1'))).toMatchObject({ pluggable: { id: 'qsfp-zr' }, fixed: false });
    expect(resolve(t, cat, at('d1', '2', 'L1'))).toEqual({ card: undefined, port: undefined, pluggable: undefined, fixed: false });
    expect(fibersAt(t, at('d1', '1', 'AD1'))).toEqual({ tx: t.links[1], rx: t.links[0] });
    expect(fibersAt(t, at('d1', '1', 'AD2'))).toEqual({ tx: undefined, rx: undefined });
    expect([touches(t.links[0], { device: 'd1', slot: '1' }), touches(t.links[0], { device: 'd2' }), touches(t.links[0], {})]).toEqual([true, false, true]);
    expect([sameEnd(at('d1', '1', 'AD1'), at('d1', '1', 'AD1')), sameEnd(at('d1', '1', 'AD1'), at('d1', '1', 'AD2'))]).toEqual([true, false]);
    expect([path(t, at('d2', '1', 'C1')), path(t, at('gone', '1', 'C1'))]).toEqual(['Site-B/1/C1', 'gone/1/C1']);
  });

  it('refuses a fiber with the first rule it breaks, each with why', () => {
    const err = (x: End, y: End) => fiberError(t, cat, x, y);
    expect(err(at('d2', '3', 'L1'), at('d1', '1', 'AD2'))).toBe('Site-B/3/L1 has no pluggable');
    expect(err(at('d1', '1', 'AD2'), at('d2', '3', 'C1'))).toBe('Site-B/3/C1 has no pluggable');
    expect(err(at('d2', '1', 'C2'), at('d1', '3', 'C1'))).toBe('Site-B/1/C2 is not single-mode (SMF)');
    expect(err(at('d1', '3', 'L1'), at('d1', '1', 'AD2'))).toBe('Site-A/3/L1 Tx already has a fiber');
    expect(err(at('d1', '1', 'AD2'), at('d1', '1', 'LINE'))).toBe('Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)');
    expect(err(at('d1', '1', 'AD2'), at('d1', '1', 'AD1'))).toBe('Site-A/1/AD1 Rx already has a fiber'); // taken, before same card
    expect(err(at('d2', '1', 'C1'), at('d1', '1', 'AD1'))).toBe('Site-A/1/AD1 Rx already has a fiber');
    expect(err(at('d1', '3', 'C1'), at('d1', '3', 'C1'))).toBe('Both ends are on the same card (only a loopback-capable port loops back, Tx to its own Rx)');
  });

  it("loops back a line port, or a port whose behavior says it can, Tx to its own Rx, and joins two boxes' ports", () => {
    expect(fiberError(t, cat, at('d1', '1', 'LINE'), at('d1', '1', 'LINE'))).toBeNull();
    expect(fiberError(t, cat, at('d2', '1', 'C1'), at('d2', '1', 'C1'))).toBeNull();
    expect(fiberError(t, cat, at('d2', '1', 'C1'), at('d1', '3', 'C1'))).toBeNull();
    expect(fiberError(t, cat, at('d1', '1', 'AD2'), at('d2', '1', 'C1'))).toBeNull();
  });
});

describe("a box's strands as fibers", () => {
  const strands = [
    { strand: 'F01', from: 'BERT:P1', to: '1-3-c1' }, // the BERT is off the box
    { strand: 'F02', from: '1-1-line', to: '1-1-line' },
    { strand: 'F03', from: '1-3-l1', to: '1-1-ad2' },
    { strand: 'F04', from: '1-1-ad1', to: '1-1-ad2' }, // same card, and AD2's Rx is F03's
    { strand: 'F05', from: '1-1-ad9', to: '1-3-c1' }, // no AD9
    { strand: 'f1', from: '1-1-ad2', to: '1-3-c1' }, // a fiber of that name is drawn already
  ];

  it('draws each strand between the box\'s ports, leaves out ends off it, and lists the refused with why', () => {
    const empty = { ...t, links: [] };
    const { links, refused } = wired(cat, { ...empty, links: [link('f1', at('d1', '3', 'C1'), at('d2', '1', 'C1'))] }, { ...a }, strands);
    expect(links.map((l) => [l.id, `${l.a.slot}/${l.a.port}`, `${l.b.slot}/${l.b.port}`])).toEqual([['F02', '1/LINE', '1/LINE'], ['F03', '3/L1', '1/AD2']]);
    expect(refused).toEqual(['F04: Site-A/1/AD2 Rx already has a fiber']);
  });

  it("names a strand another box's fiber has the name of after its own box, so a second box's strands come in too", () => {
    const c = device('d3', 'Site-C', a.slots);
    const one = [{ strand: 'F03', from: '1-3-l1', to: '1-1-ad2' }];
    const both = { ...t, devices: [a, c], links: [] };
    const first = wired(cat, both, a, one).links;
    const second = wired(cat, { ...both, links: first }, c, one);
    expect([...first, ...second.links].map((l) => [l.id, l.a.device, l.b.device])).toEqual([['F03', 'd1', 'd1'], ['F03@Site-C', 'd3', 'd3']]);
    expect(second.refused).toEqual([]);
    // Each box's again, as a sync does: each has its fiber already.
    for (const d of [a, c]) expect(wired(cat, { ...both, links: [...first, ...second.links] }, d, one).links).toEqual([]);
  });

  it("reads them on the chassis the box's number says", () => {
    expect(wired(cat, { ...t, links: [] }, { ...a, chassisNo: 2 }, strands).links).toEqual([]);
    expect(wired(cat, { ...t, links: [] }, { ...a, chassisNo: 2 }, [{ strand: 'F02', from: '2-1-line', to: '2-1-line' }]).links.map((l) => l.id)).toEqual(['F02']);
  });
});

describe('validate', () => {
  it('has nothing to say about a topology the rules allow', () => {
    expect(validate(t, cat)).toEqual([]);
  });

  it('lists every problem, device by device and then fiber by fiber', () => {
    const bad: Topology = {
      ...t,
      devices: [
        { ...a, slots: { ...a.slots, 2: { linecard: 'lc-tp', ports: { C1: { pluggable: 'sfp-sr' } } } } },
        device('d3', 'Site-C', {}, { chassis: 'ch-nope' }),
      ],
      links: [...t.links, link('f3', at('d1', '3', 'L1'), at('d1', '3', 'L1'))],
    };
    expect(validate(bad, cat)).toEqual([
      'Site-A: Slot 2 is taken by the card in slot 2', // the mux in 1, over the card in 2
      'Site-A: Slot 2 is taken by the card in slot 1', // and the card in 2, under the mux
      'Site-A: SFP SR is not allowed in port C1 of TP',
      'Site-C: unknown chassis ch-nope',
      'Fiber f1: Site-A/3/L1 Tx already has a fiber',
      'Fiber f2: Site-A/3/L1 Rx already has a fiber',
      'Fiber f3: Site-A/3/L1 Tx already has a fiber',
    ]);
  });
});

describe('alarms', () => {
  it('raises a LOS on each port with light to lose and no fiber into its Rx, and one per empty back bay', () => {
    const raised = alarms(t, cat, { ...a, emptyBays: ['PSU2', 'FAN1', 'PSU9'] }).map((x) => `${x.severity} ${x.bay ?? `${x.slot}/${x.port}`}`);
    expect(raised).toEqual(['critical 1/LINE', 'critical 1/AD2', 'critical 3/C1', 'major PSU2', 'major FAN1']);
    expect(alarms(t, cat, b).map((x) => `${x.slot}/${x.port}`)).toEqual(['1/C1', '1/C2']); // 3/L1 and 3/C1 have no pluggable
  });

  it('names the back bays', () => {
    expect([bays('PSU', 2), bays('FAN', 1), bays('FAN')]).toEqual([['PSU1', 'PSU2'], ['FAN1'], []]);
  });
});

describe('cards the deck draws', () => {
  // An amplifier whose faceplate has LINE and SIG, and MON1, a monitor tap with only its Tx; its BAIN is inside it.
  const amp: LinecardDef = {
    id: 'lc-amp', name: 'AMP', width: 2,
    ports: [{ id: 'LINE', role: 'line', allowedPluggables: [] }, { id: 'SIG', role: 'port', allowedPluggables: [] },
      { id: 'MON1', role: 'monitor', allowedPluggables: [] }, { id: 'BAIN', role: 'ampin', allowedPluggables: [] }],
    faceplate: { image: 'faceplates/amp.png', size: [400, 80], ports: { LINE: { box: [10, 10, 40, 30] }, SIG: { box: [60, 10, 40, 30] }, MON1: { tx: [110, 10, 20, 30] } } },
  };
  const drawn: Catalog = { ...cat, chassis: [{ ...chassis, slots: chassis.slots.map((s) => ({ ...s, allowedLinecards: [...s.allowedLinecards, 'lc-amp'] })) }], linecards: [...cat.linecards, amp] };
  const f = device('d3', 'Site-F', { 1: { linecard: 'lc-amp', ports: {} }, 3: { linecard: 'lc-tp', ports: { L1: { pluggable: 'qsfp-zr' } } } });
  const tf: Topology = { ...t, devices: [f], links: [] };

  it('runs fibers only from strands on its front: none from a port inside it, none into a tap', () => {
    expect(fiberError(tf, drawn, at('d3', '1', 'BAIN'), at('d3', '3', 'L1'))).toBe('Site-F/1/BAIN is inside the card, not on its front');
    expect(fiberError(tf, drawn, at('d3', '3', 'L1'), at('d3', '1', 'MON1'))).toBe("Site-F/1/MON1 has no Rx on the card's front");
    expect(fiberError(tf, drawn, at('d3', '1', 'MON1'), at('d3', '3', 'L1'))).toBeNull();
    expect(fiberError(tf, drawn, at('d3', '1', 'SIG'), at('d3', '3', 'L1'))).toBeNull();
  });

  it('raises a LOS only on a port whose Rx is on its front', () => {
    expect(alarms(tf, drawn, f).map((x) => `${x.slot}/${x.port}`)).toEqual(['1/LINE', '1/SIG', '3/L1']);
  });
});

// What the box reads, on the app's side: its parts drawn from show card and show inventory (discover), and the light on
// a strand (light), on box states made up for each case.
import { describe, expect, it } from 'vitest';
import { byId } from '../../src/catalog';
import { catalogFor } from '../../src/catalog-vite';
import { discover, light, stateFor, type BoxState } from '../../src/live';
import type { Device, Link, Topology } from '../../src/types';

const state = (commands: BoxState['commands'], host = 'box.test'): BoxState => ({ live: true, host, commands });
const empty: Device = { id: 'd1', chassis: 'ch-8slot', name: 'Site-1', host: 'box.test', x: 0, y: 0, slots: {} };

describe('discover', () => {
  const cards = { '1-1': { 'module-type': 'TMUXC1125', present: 'true' }, '1-7': { 'module-type': '800MX', present: 'true' }, '1-8': { 'module-type': 'MYSTERY9', present: 'true' }, '1-4': { 'module-type': '800MX', present: 'false' } };
  const transceivers = {
    '1-7-4': { 'part-no': 'QSFP-LR4-100G', 'mfg-name': 'FS', 'form-factor': 'QSFP28', 'compliance-code': '100GBASE-LR4', 'connector-type': 'LC' },
    '1-7-5': { 'part-no': 'FTCD3323R1PCL-1Y' }, // the catalog's
    '1-7-6': { 'part-no': 'qsfp-lr4-100g' }, // the part in 1-7-4, written another way
    '1-7-7': { 'part-no': 'QSFP LR4 100G', 'form-factor': 'QSFP28' }, // another part whose id would be the same
    '1-7-8': { 'part-no': 'SR4-X', 'compliance-code': '100GBASE-SR4' },
    '1-7-9': { 'part-no': 'ZR-DCO-1', 'form-factor': 'QSFP-DD', 'compliance-code': 'OTUC4' },
    '1-7-11': { 'part-no': 'NOPORT' },
    '1-1-osc': { 'part-no': 'OSC-SFP-1', 'form-factor': 'SFP' },
  };
  const s = state({ 'show card': { at: 0, data: { state: { cards } } }, 'show inventory': { at: 0, data: { transceivers } } });

  it("draws each card that is there and each transceiver by its part, and lists what the catalog can't place", () => {
    const cat = structuredClone(catalogFor('csp'));
    const found = discover(cat, empty, s)!;
    expect(found.slots).toEqual({
      1: { linecard: 'lc-c1125', ports: { OSC: { pluggable: 'osc-sfp-1' } } },
      7: { linecard: 'lc-800mx', ports: { PORT4: { pluggable: 'qsfp-lr4-100g' }, PORT5: { pluggable: 'ftcd3323r1pcl-1y' }, PORT6: { pluggable: 'qsfp-lr4-100g' }, PORT7: { pluggable: 'qsfp-lr4-100g-2' }, PORT8: { pluggable: 'sr4-x' }, PORT9: { pluggable: 'zr-dco-1' } } },
    });
    expect(found.missing).toEqual(['1-7-11 NOPORT', '1-8 MYSTERY9']);
  });

  it("adds a part the catalog doesn't know as the box reports it: its family, speed, fiber and DCO", () => {
    const cat = structuredClone(catalogFor('csp'));
    discover(cat, empty, s);
    const part = (id: string) => { const p = byId(cat.pluggables, id)!; return [p.formFactor, p.speed, p.fiber, !!p.dco]; };
    expect(['qsfp-lr4-100g', 'qsfp-lr4-100g-2', 'sr4-x', 'zr-dco-1', 'osc-sfp-1'].map(part)).toEqual([
      ['QSFP', '100G', 'SMF', false], ['QSFP', '100G', 'SMF', false], ['QSFP', '100G', 'MMF', false], ['QSFPDD', '400G', 'SMF', true], ['SFP', 'N/A', 'SMF', false],
    ]);
    expect(byId(cat.pluggables, 'qsfp-lr4-100g')).toMatchObject({ vendor: 'FS', part: 'QSFP-LR4-100G', specs: { Compliance: '100GBASE-LR4', Connector: 'LC' }, about: 'Discovered in 1-7-4 from show inventory.' });
    expect(cat.pluggables.length - catalogFor('csp').pluggables.length).toBe(5); // each part once
  });

  it("reads the box's own chassis number, and waits for both commands", () => {
    const two = state({ 'show card': { at: 0, data: { state: { cards: { '2-7': { 'module-type': '800MX', present: 'true' }, '1-1': { 'module-type': 'TMUXC1125', present: 'true' } } } } }, 'show inventory': { at: 0, data: {} } });
    expect(discover(structuredClone(catalogFor('csp')), { ...empty, chassisNo: 2 }, two)!.slots).toEqual({ 7: { linecard: 'lc-800mx', ports: {} } });
    expect(discover(catalogFor('csp'), empty, state({ 'show card': s.commands['show card'] }))).toBeNull();
    expect(discover(catalogFor('csp'), empty, state({ 'show inventory': s.commands['show inventory'] }))).toBeNull();
    expect(discover(catalogFor('csp'), { ...empty, chassis: 'ch-nope' }, s)).toBeNull();
  });
});

describe('light', () => {
  const d: Device = { ...empty, slots: { 1: { linecard: 'lc-c1125', ports: {} }, 7: { linecard: 'lc-800mx', ports: { PORT5: { pluggable: 'ftcd3323r1pcl-1y' } } } } };
  const t: Topology = { version: 1, stream: 'csp', devices: [d], links: [] };
  const f03: Link = { id: 'F03', type: 'smf', a: { device: 'd1', slot: '7', port: 'PORT5' }, b: { device: 'd1', slot: '1', port: 'AD11' } };
  const f04: Link = { id: 'F04', type: 'smf', a: { device: 'd1', slot: '1', port: 'AD11' }, b: { device: 'd1', slot: '7', port: 'PORT5' } };
  const stats = (values: Record<string, number>) => ({ at: 0, data: { state: { stats: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { instant: v, avg: v, min: v, max: v }])) } } });

  it("belongs only to the device whose host it was read from", () => {
    const s = state({});
    expect([stateFor(s, d), stateFor(s, { ...d, host: 'other.test' }), stateFor(s, { ...d, host: undefined }), stateFor(null, d), stateFor(s)]).toEqual([s, null, null, null, null]);
  });

  it('is nothing while the box says nothing about the strand', () => {
    expect(light(null, t, f03)).toBeNull();
    expect(light(state({}), t, f03)).toBeNull();
    expect(light(state({ 'show och 1-8-1': stats({ 'output-power': -3 }) }), t, f03)).toBeNull();
  });

  it("takes the Tx from the OCH and the Rx with OSNR, Q-margin and BER from the far end's OCH, and their difference", () => {
    const lit = light(state({ 'show och 1-7-5': stats({ 'output-power': -2.98, 'total-input-power': -7.57, osnr: 29.7, 'q-margin': 3.4, 'pre-fec-ber': 0.000123 }) }), t, f04)!;
    expect(lit).toMatchObject({ dark: false, tx: undefined, rx: -7.57 });
    expect(lit.notes).toEqual(['Rx 1-7-5: -7.57 dBm', 'OSNR 29.7 dB', 'Q-margin 3.4 dB', 'Pre-FEC BER 1.23E-4']);
  });

  it("lists a transceiver's lanes when it has more than one", () => {
    const s = state({ 'show transceiver 1-7-5': stats({ 'output-power': 1.2 }), ...Object.fromEntries([1, 2, 3, 4].map((n) => [`show transceiver 1-7-5 physical-channel ${n}`, stats({ 'output-power': -1 - n / 10 })])) });
    expect(light(s, t, f03)!.notes[0]).toBe('Tx 1-7-5: 1.20 dBm (lanes -1.1 / -1.2 / -1.3 / -1.4)');
  });

  it("goes dark with the laser off, a loss at the Rx end, or no light read there, and says so", () => {
    const off = light(state({ 'show och 1-7-5': { at: 0, data: { state: { laser: 'disabled', stats: {} } } } }), t, f03)!;
    expect(off).toMatchObject({ dark: true, notes: ['Laser off at 1-7-5'] });
    const los = light(state({ 'show alarm': { at: 0, data: { alarms: { 1: { resource: 'port 1-1-ad11', severity: 'CRITICAL', 'alarm-abbreviate': 'IN_LOS', text: 'Loss of signal' } } } } }), t, f03)!;
    expect(los).toMatchObject({ dark: true, notes: ['CRITICAL IN_LOS at 1-1-ad11: Loss of signal'] });
    const ports = { 'port-1-1-ad11': { in: { 'optical-power': -99.99 }, out: { 'optical-power': -99.99 } } };
    expect(light(state({ 'show optical-port': { at: 0, data: { state: { ports } } } }), t, f03)).toMatchObject({ dark: true, rx: undefined, notes: ['No light at 1-1-ad11'] });
  });

  it('shows no reading while the box reads 0 in every cell, as after a reboot', () => {
    expect(light(state({ 'show och 1-7-5': stats({ 'output-power': 0, 'total-input-power': 0 }) }), t, f03)).toBeNull();
  });
});

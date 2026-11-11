// The catalog put together from catalog/'s files (catalogs, over files given here by name), and the helpers that turn
// its ids into the box's CLI addresses and back.
import { describe, expect, it } from 'vitest';
import box3 from '../../examples/box3.olst.json';
import { byId, catalogs, cli, cliAddress, cliPort, endAt, linecardFor, nextMode } from '../../src/catalog';
import { catalogFor } from '../../src/catalog-vite';
import type { Device, Topology } from '../../src/types';

/**
 * A stream of its own: a 4-slot chassis two to a row whose profile names three vendor types, one of them a card with no
 * linecard yet and one two slots wide, a slot allowing a card nothing defines, a port taking a family no pluggable is
 * of, a tester kept by hand, and a cli.json over the common one.
 */
const files: Record<string, unknown> = {
  'common/cli.json': { chassis: 'show chassis {chassis}', card: 'show card {chassis}-{slot}', port: 'show port {chassis}-{slot}-{port}', pluggable: 'show transceiver {chassis}-{slot}-{port}', modes: [{ name: 'Normal' }] },
  'x/cli.json': { card: 'show card {chassis}-{slot} detail' },
  'x/chassis.json': [{
    id: 'ch-x', name: 'X', columns: 2,
    slots: [{ id: '1', allowedLinecards: ['lc-known'] }, { id: '2', allowedLinecards: [] }, { id: '3', allowedLinecards: ['lc-ghost-card'] }, { id: '4', allowedLinecards: [] }],
    supportedVendorTypes: ['KNOWN', 'NEWCARD', 'WIDE'],
    vendorTypeMap: [{ vendorType: 'KNOWN', linecardId: 'lc-known' }, { vendorType: 'WIDE', linecardId: 'lc-wide' }],
  }],
  'x/linecards.json': [{ id: 'lc-known', name: 'Known', ports: [{ id: 'P1', role: 'client', allowedPluggables: ['CFP2'] }] }, { id: 'lc-wide', name: 'Wide', width: 2, ports: [] }],
  'x/pluggables.json': [{ id: 'sfp-1', name: 'SFP 1', formFactor: 'SFP', speed: '10G', fiber: 'SMF' }],
  'x/testers.json': { chassis: [{ id: 'ch-t', name: 'Tester', tester: true, slots: [{ id: '1', allowedLinecards: ['lc-t'] }] }], linecards: [{ id: 'lc-t', name: 'T', ports: [] }] },
};
const reads: string[] = [];
const streamFor = catalogs((name) => { reads.push(name); return files[name]; });

describe('catalogs', () => {
  const cat = streamFor('x');

  it("puts a stream's hardware together with its testers, once", () => {
    expect(cat.chassis.map((c) => c.id)).toEqual(['ch-x', 'ch-t']);
    expect(streamFor('x')).toBe(cat);
    expect(reads.filter((r) => r === 'x/chassis.json')).toHaveLength(1);
  });

  it("allows each vendor type of the profile in every slot it fits, a wide one only where its row has room", () => {
    expect(byId(cat.chassis, 'ch-x')!.slots.map((s) => s.allowedLinecards)).toEqual([
      ['lc-known', 'lc-newcard', 'lc-wide'], ['lc-known', 'lc-newcard'], ['lc-ghost-card', 'lc-known', 'lc-newcard', 'lc-wide'], ['lc-known', 'lc-newcard'],
    ]);
  });

  it('stands in a placeholder for a card or a family nothing defines, so every id it allows can be drawn', () => {
    expect(byId(cat.linecards, 'lc-newcard')).toMatchObject({ name: 'NEWCARD', ports: [{ id: 'P1', allowedPluggables: ['SFP'] }, { id: 'L1', allowedPluggables: ['QSFP'] }] });
    expect(byId(cat.linecards, 'lc-ghost-card')?.name).toBe('GHOST CARD');
    expect(cat.pluggables.map((p) => p.id).sort()).toEqual(['cfp2-placeholder', 'qsfp-placeholder', 'sfp-1']);
    expect(byId(cat.pluggables, 'cfp2-placeholder')).toMatchObject({ formFactor: 'CFP2', fiber: 'SMF' });
    expect(byId(cat.chassis, 'ch-t')!.slots[0].allowedLinecards).toEqual(['lc-t']); // a tester's slots stay as written
  });

  it("takes the stream's CLI over the common one, and has nothing for a stream with no files", () => {
    expect(cat.cli).toMatchObject({ card: 'show card {chassis}-{slot} detail', port: 'show port {chassis}-{slot}-{port}', modes: [{ name: 'Normal' }] });
    const none = streamFor('nowhere');
    expect([none.chassis, none.linecards, none.pluggables]).toEqual([[], [], []]);
    expect(none.cli.card).toBe('show card {chassis}-{slot}');
  });
});

describe('CLI addresses', () => {
  const csp = catalogFor('csp');
  const device = (box3 as unknown as Topology).devices[0];

  it("names a port as the box's CLI does", () => {
    expect(['PORT4', 'PORT10', 'AD1', 'AD11', 'LINE', 'C1', 'OSC'].map(cliPort)).toEqual(['4', '10', 'ad1', 'ad11', 'line', 'c1', 'osc']);
    expect([cliAddress(1, '7', 'PORT5'), cliAddress(2, '1', 'AD11'), cliAddress(1, '7')]).toEqual(['1-7-5', '2-1-ad11', '1-7']);
  });

  it("finds a device's port at a CLI address, and none for an address off it", () => {
    expect(endAt(csp, device, '1-7-5')).toEqual({ device: device.id, slot: '7', port: 'PORT5' });
    expect(endAt(csp, device, '1-1-ad11')).toEqual({ device: device.id, slot: '1', port: 'AD11' });
    expect(endAt(csp, device, '1-1-line')).toEqual({ device: device.id, slot: '1', port: 'LINE' });
    for (const at of ['2-7-5', '1-7-5-1', '1-5-1', '1-7-99', 'BERT:P1', '', '1-7']) expect(endAt(csp, device, at), at).toBeNull();
    const second: Device = { ...device, chassisNo: 2 };
    expect([endAt(csp, second, '2-7-5')?.port, endAt(csp, second, '1-7-5')]).toEqual(['PORT5', null]);
  });

  it("maps the box's module type to a linecard, by the profile's map or by its name", () => {
    const chassis = byId(csp.chassis, 'ch-8slot')!;
    expect([linecardFor(chassis, 'TMUXC1125'), linecardFor(chassis, '800MX'), linecardFor(chassis, 'Brand New 9'), linecardFor(chassis, '')]).toEqual(['lc-c1125', 'lc-800mx', 'lc-brand-new-9', 'lc-unknown']);
  });

  it('fills a CLI template, leaving a value it is not given as it is', () => {
    expect(cli(csp, 'card', { chassis: 1 })).toBe('show card 1-{slot}');
    expect(cli(csp, 'pluggable', { chassis: 1, slot: '1', port: 'AD11' })).toBe('show transceiver 1-1-ad11');
  });

  it('stays in its mode for a command that moves nowhere, and never goes below the first', () => {
    expect([nextMode(csp, 0, 'show card'), nextMode(csp, 0, 'exit'), nextMode(csp, 0, '^^^'), nextMode(csp, csp.cli.modes.length - 1, 'configure')]).toEqual([0, 0, 0, csp.cli.modes.length - 1]);
  });
});

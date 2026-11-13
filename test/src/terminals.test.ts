import { describe, expect, it } from 'vitest';
import { fillStep } from '../../bridge/fill.mjs';
import box3 from '../../examples/box3.olst.json';
import { catalogFor } from '../../src/catalog-vite';
import { indexAt, RACK, rackLayout } from '../../src/racks';
import { termItems, termMenu } from '../../src/terminals';
import type { Device, Topology } from '../../src/types';

const cat = catalogFor('csp');
/** Box 3's build (C1125 in 1, 800MX in 7 and 8) under made-up names, plus a C25 in 3. */
const box: Device = {
  ...(box3 as Topology).devices[0],
  name: 'Site-1',
  host: 'box.test',
  slots: { ...(box3 as Topology).devices[0].slots, 3: { linecard: 'lc-c25', ports: {} } },
};
const open = (slot?: string) => Object.fromEntries(termItems(cat, box, slot).map((i) => [i.kind, i.open?.steps ?? i.why]));

describe('right-click terminals', () => {
  it('opens the chassis in show mode, as the session starts', () => {
    expect(termItems(cat, box)).toEqual([{ kind: 'normal', label: 'Open terminal · show mode', open: { host: 'box.test', steps: [], title: 'Site-1 · box.test · show mode' } }]);
  });

  it("telnets into a card at 1.0.1.<slot × 4> from bash in engineering mode, and opens engineering mode", () => {
    expect(open('1')).toEqual({ normal: [], telnet: ['configure', '^^^', 'bash', 'telnet 1.0.1.4'], engineering: ['configure', '^^^'] });
    expect(open('3').telnet).toEqual(['configure', '^^^', 'bash', 'telnet 1.0.1.12']);
    expect(termItems(cat, box, '1')[1]).toMatchObject({ label: 'Telnet to card 1-1', open: { title: 'Site-1 · box.test · card 1-1 C1125 · telnet' } });
  });

  it('keeps telnet on for an 800MX, and greys it out on a 400MX with why', () => {
    expect(open('7')).toEqual({ normal: [], telnet: ['configure', '^^^', 'bash', 'telnet 1.0.1.28'], engineering: ['configure', '^^^'] });
    const mx4 = { ...box, slots: { 2: { linecard: 'lc-400mx', ports: {} } } };
    expect(termItems(cat, mx4, '2').find((i) => i.kind === 'telnet')?.why).toBe('400MX cannot be telnetted into');
  });

  it('greys out everything without a box IP, and on test equipment', () => {
    expect(termItems(cat, { ...box, host: ' ' }, '1').map((i) => i.why)).toEqual(Array(3).fill('No box IP yet: open the device and type it in the header'));
    const bert: Device = { id: 'd2', chassis: 'ch-bert-tester', name: 'BERT-2', x: 0, y: 0, slots: { 1: { linecard: 'lc-bert-tester', ports: {} } } };
    expect(termItems(cat, bert, '1').every((i) => i.why === 'BERT Tester is test equipment: no CLI')).toBe(true);
  });

  it("offers the chassis's terminal where there is no card", () => {
    expect(termMenu(cat, box, '5')).toEqual({ title: 'Site-1', items: termItems(cat, box) });
    expect(termMenu(cat, box, null).items).toHaveLength(1);
    expect(termMenu(cat, box, '7').title).toBe('Site-1 · slot 7 · 800MX');
  });

  it('fills a step, or says it cannot', () => {
    expect(fillStep('telnet 1.0.1.{slot*4}', { slot: '7' })).toBe('telnet 1.0.1.28');
    expect(fillStep('show card {chassis}-{slot}', { chassis: 1, slot: '7' })).toBe('show card 1-7');
    expect(fillStep('telnet 1.0.1.{slot*4}', { slot: 'A' })).toBeNull();
    expect(fillStep('telnet {slot}', {})).toBeNull();
  });
});

describe('racks', () => {
  const t: Topology = {
    version: 1, stream: 'csp', links: [],
    devices: ['d1', 'd2', 'd3'].map((id) => ({ id, chassis: 'ch-8slot', name: id, x: 0, y: 0, slots: {} })),
    racks: [{ id: 'r1', name: 'Rack-1', x: 100, y: 50, devices: ['d2', 'gone', 'd1'] }],
  };
  const measured = { d1: { width: 1136, height: 230 }, d2: { width: 1136, height: 200 } };

  it('stacks its devices from the top, a gap between them, and skips ones that are gone', () => {
    const { frames, byDevice } = rackLayout(t, measured);
    expect(frames[0].list).toEqual(['d2', 'd1']);
    expect(frames[0].at).toEqual({ d2: { x: 100 + RACK.rail, y: 50 + RACK.head }, d1: { x: 100 + RACK.rail, y: 50 + RACK.head + 200 + RACK.gap } });
    expect(frames[0].rect).toEqual({ x: 100, y: 50, w: RACK.width + 2 * RACK.rail, h: RACK.head + 200 + RACK.gap + 230 + RACK.foot });
    expect([...byDevice.keys()]).toEqual(['d2', 'd1']);
  });

  it('puts a device dropped on it under each one whose middle is above the drop', () => {
    const [f] = rackLayout(t, measured).frames;
    expect(indexAt(f, 'd3', { x: 300, y: 60 }, measured)).toBe(0);
    expect(indexAt(f, 'd3', { x: 300, y: 50 + RACK.head + 150 }, measured)).toBe(1); // below d2's middle
    expect(indexAt(f, 'd3', { x: 300, y: 2000 }, measured)).toBe(2);
    expect(indexAt(f, 'd2', { x: 300, y: 2000 }, measured)).toBe(1); // moving d2 to the bottom
  });

  it('is a fixed size while empty', () => {
    expect(rackLayout({ ...t, racks: [{ ...t.racks![0], devices: [] }] }, measured).frames[0].rect.h).toBe(RACK.empty);
  });
});

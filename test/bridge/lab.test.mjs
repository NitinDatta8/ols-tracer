// The lab file (bridge/lab.mjs), in a catalog of the test's own: read with its mtime; saved only over the file it was
// read from, in one step; and a box's sync applied to its own device alone, written only when it changes something,
// with what changed. Its endpoints are in endpoints.test.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'ols-lab-'));
vi.stubEnv('BRIDGE_CATALOG', root);
const { LAB, readLab, saveLab, syncLab } = await import('../../bridge/lab.mjs');
const { changes } = await import('../../bridge/changes.mjs');

const end = (device, slot, port) => ({ device, slot, port });
const fiber = (id, a, b) => ({ id, type: 'smf', a, b });
const LAB0 = {
  version: 1, stream: 'csp', lock: { sha256: 'a'.repeat(64) },
  devices: [
    { id: 'd1', chassis: 'ch-8slot', name: 'Site-1', x: 0, y: 0, host: 'box-1.test', slots: { 1: { linecard: 'lc-c1125', ports: {} }, 7: { linecard: 'lc-800mx', ports: { PORT5: { pluggable: 'p5' } } } } },
    { id: 'd2', chassis: 'ch-8slot', name: 'Site-2', x: 0, y: 0, host: ' box-2.test ', slots: { 1: { linecard: 'lc-c1125', ports: {} } } },
  ],
  links: [fiber('F03', end('d1', '7', 'PORT5'), end('d1', '1', 'AD11')), fiber('f1', end('d2', '1', 'AD1'), end('d2', '1', 'AD2'))],
  racks: [],
};
const file = () => JSON.parse(readFileSync(LAB, 'utf8'));

beforeEach(() => {
  mkdirSync(join(root, 'csp'), { recursive: true });
  writeFileSync(LAB, JSON.stringify(LAB0));
});

describe('the lab file', () => {
  it('is read with its mtime, and is none with no file', () => {
    expect(readLab()).toEqual({ topology: LAB0, mtime: statSync(LAB).mtimeMs });
    rmSync(LAB);
    expect(readLab()).toBeNull();
    expect(saveLab(LAB0, 1)).toEqual({ status: 404, why: 'No lab file' });
  });

  it('is saved only over the file it was read from, in one step, as JSON', () => {
    const { mtime } = readLab();
    const t = { ...LAB0, racks: [{ id: 'r1', name: 'Rack-1', x: 1, y: 2, devices: ['d1'] }] };
    const saved = saveLab(t, mtime);
    expect(saved.mtime).toBe(statSync(LAB).mtimeMs);
    expect(readFileSync(LAB, 'utf8')).toBe(`${JSON.stringify(t, null, 2)}\n`);
    expect(existsSync(`${LAB}.tmp`)).toBe(false);
    // Saved from the file as it was before: it changed since, so the save is refused and nothing is written.
    expect(saveLab(LAB0, mtime)).toEqual({ status: 409, why: 'The lab file changed since it was loaded: reload the page to get it' });
    expect(file()).toEqual(t);
    for (const bad of [null, [], { ...LAB0, version: 2 }, { ...LAB0, stream: 'ctc' }, { ...LAB0, devices: {} }, { ...LAB0, links: undefined }]) {
      expect(saveLab(bad, saved.mtime), JSON.stringify(bad)).toEqual({ status: 400, why: "A topology of csp's, with its devices and links" });
    }
  });
});

describe('a sync', () => {
  it("changes only the box's own device, its cards, pluggables and fibers, and says what changed", () => {
    const { mtime } = readLab();
    const slots = { 1: { linecard: 'lc-c1125', ports: {} }, 3: { linecard: 'lc-800mx', ports: {} }, 7: { linecard: 'lc-800mx', ports: {} } };
    const links = [fiber('F01', end('d1', '1', 'AD1'), end('d1', '3', 'PORT1'))];
    const r = syncLab('box-1.test', { slots, links });
    expect(r).toEqual({ was: mtime, mtime: statSync(LAB).mtimeMs, changed: ['7/PORT5: p5 out', 'slot 3: lc-800mx in', 'fiber F03 out', 'fiber F01 in'] });
    expect(file()).toEqual({ ...LAB0, devices: [{ ...LAB0.devices[0], slots }, LAB0.devices[1]], links: [LAB0.links[1], ...links] });
    // The file has it already: nothing changed, and nothing written.
    expect(syncLab('box-1.test', { slots, links })).toEqual({ was: r.mtime, mtime: r.mtime, changed: [] });
    expect(statSync(LAB).mtimeMs).toBe(r.mtime);
    // A host as typed, spaces around it.
    expect(syncLab('box-2.test', { slots: {}, links: [] }).changed).toEqual(['slot 1: lc-c1125 out', 'fiber f1 out']);
  });

  it('says a card swapped in a slot is one out and another in, a pluggable too', () => {
    const was = { slots: { 7: { linecard: 'lc-800mx', ports: { PORT4: { pluggable: 'a' } } } }, links: [] };
    expect(changes(was, { slots: { 7: { linecard: 'lc-400mx', ports: {} } }, links: [] })).toEqual(['slot 7: lc-800mx out', 'slot 7: lc-400mx in']);
    expect(changes(was, { slots: { 7: { linecard: 'lc-800mx', ports: { PORT4: { pluggable: 'b' } } } }, links: [] })).toEqual(['7/PORT4: a out', '7/PORT4: b in']);
    expect(changes(was, was)).toEqual([]);
  });

  it("is refused when it can't be placed: a body of the wrong shape, a host no device or two have, a fiber off the device", () => {
    const before = readFileSync(LAB, 'utf8');
    const slots = LAB0.devices[0].slots;
    for (const body of [undefined, {}, { slots: [], links: [] }, { slots, links: {} }, { slots, links: [{ id: 'F1' }] }]) {
      expect(syncLab('box-1.test', body), JSON.stringify(body)).toEqual({ status: 400, why: 'slots, and the links on the device' });
    }
    expect(syncLab('box-9.test', { slots, links: [] })).toEqual({ status: 409, why: 'No device in the lab file at box-9.test' });
    writeFileSync(LAB, JSON.stringify({ ...LAB0, devices: [...LAB0.devices, { ...LAB0.devices[0], id: 'd3' }] }));
    expect(syncLab('box-1.test', { slots, links: [] })).toEqual({ status: 409, why: '2 devices in the lab file at box-1.test' });
    writeFileSync(LAB, before);
    const why = { status: 409, why: 'The lab file changed: its device at box-1.test is d1, so reload the page' };
    expect(syncLab('box-1.test', { slots, links: [fiber('f9', end('d2', '1', 'AD3'), end('d2', '1', 'AD4'))] })).toEqual(why); // not on it
    expect(syncLab('box-1.test', { slots, links: [fiber('f9', end('d1', '1', 'AD3'), end('d7', '1', 'AD4'))] })).toEqual(why); // to a device gone
    expect(readFileSync(LAB, 'utf8')).toBe(before);
  });
});

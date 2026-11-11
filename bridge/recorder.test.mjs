// The recorder with sessions to two boxes at once, in a data root of its own: no box, no Python.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'ols-boxes-'));
vi.stubEnv('BOX_DATA_ROOT', join(root, 'start'));
const { boxAt, Run } = await import('./recorder.mjs');
const index = (run) => readFileSync(join(run.dir, 'raw', 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

it("writes each session's runs into its own box, one moving to the box show system names leaving the other where it is", async () => {
  const a = new Run('connect', 'host-a');
  const b = new Run('connect', 'host-b', 'box-b');
  await a.record('show system', Date.now(), 'hostname BOX-A', true, 'snapshot');
  await b.record('show card', Date.now(), '', true, 'snapshot');
  expect([a.meta.box, a.dir]).toEqual(['box-a', join(root, 'box-a', 'runs', a.meta.run)]);
  expect([b.meta.box, b.dir]).toEqual(['box-b', join(root, 'box-b', 'runs', b.meta.run)]);
  // A run started after a moved isn't moved with it: each session passes its own box.
  expect(new Run('alarms', 'host-b', b.meta.box).dir.startsWith(join(root, 'box-b', 'runs'))).toBe(true);
  expect([boxAt('host-a'), boxAt('host-b'), boxAt('host-c')]).toEqual(['box-a', 'box-b', undefined]);
});

it('keeps a show asked for over the MCP in the run, with who asked, in order with the rest', async () => {
  const r = new Run('connect', 'host-d', 'box-d');
  await r.record('show card', Date.parse('2026-11-10T12:00:00Z'), '', true, 'snapshot');
  await r.record('show och 1-7-5', Date.parse('2026-11-10T12:01:00Z'), '', true, 'mcp', 'codex:019a-session');
  await r.record('show alarm', Date.parse('2026-11-10T12:02:00Z'), '', true, 'typed');
  expect(index(r).map(({ cmd, source, by }) => ({ cmd, source, by }))).toEqual([
    { cmd: 'show card', source: 'snapshot', by: undefined },
    { cmd: 'show och 1-7-5', source: 'mcp', by: 'codex:019a-session' },
    { cmd: 'show alarm', source: 'typed', by: undefined },
  ]);
});

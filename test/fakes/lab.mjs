// A lab of fake boxes behind the real bridge, for the tests that open sessions (test/bridge/sessions-*.test.mjs,
// endpoints.test.mjs), each file with a bridge of its own: bridge/server.mjs started in the test's process on a free
// port, over a data root of its own, with ssh2 swapped for the fake in ssh2.mjs by the test file's
//   vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));
// so /connect opens no socket. Each test gets boxes of its own (box-<i>.t<n>.test), and once it ends, everything it
// connected is let go and checked closed: no session, no fake connection, no shell.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { boxes, fakeBox, fakePython } from './ssh2.mjs';

/** The template the poller reads alarms with: the fake Python parses its JSON answer as it is. */
const ALARMS = 'cli_shortcut_cmds_platform__alarm__show__alarm';
export const WORKERS = 4;
export const TIMEOUT = 3000;
export const root = mkdtempSync(join(tmpdir(), 'ols-sessions-'));
/** The catalog the bridge reads procedures from: a test writes its own into common/procedures.json. */
export const catalog = mkdtempSync(join(tmpdir(), 'ols-catalog-'));
export const port = await new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => done(p)); }); });
Object.assign(process.env, {
  BRIDGE_PORT: String(port), BOX_DATA_ROOT: join(root, 'start'), BOX_WORKERS: String(WORKERS), BOX_TIMEOUT: String(TIMEOUT),
  BOX_USER: 'fake', BOX_PASSWORD: 'fake-pw', BOX_INIT: '', PYTHON: fakePython(root, join(root, 'start'), [ALARMS]),
  BRIDGE_CATALOG: catalog, PROCEDURE_PENDING_SEC: '4',
});
vi.spyOn(console, 'log').mockImplementation(() => {}); // the bridge's own log of each session
await import('../../bridge/server.mjs');
// A bridge module a test file imported before this one set the data root would have the fake boxes' runs written into
// the repo's data/boxes/.
if (!(await import('../../bridge/recorder.mjs')).boxDir('x').startsWith(root)) throw new Error('the bridge was loaded before test/fakes/lab.mjs set its data root: import lab.mjs first');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A request to the bridge as the app and the MCP send it: its status and body, JSON when it is. */
export async function call(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, body, headers: { 'x-ols-tracer': '1' } });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type') === 'application/json' ? JSON.parse(text) : text };
}
for (let i = 0; i < 100; i++) { try { await call('GET', '/status'); break; } catch { await sleep(20); } }

/** The test's number: its boxes are its own, at box-<i>.t<n>.test, named BOX-<i>-T<n>, with their runs in box-<i>-t<n>. */
let n = 0;
beforeEach(() => { n++; });
export const host = (i) => `box-${i}.t${n}.test`;
export const folder = (i) => `box-${i}-t${n}`;
export const hostname = (i) => `BOX-${i}-T${n}`;
export const prompt = (i, mode = '>') => `admin@${hostname(i)}${mode} `;
/** Fake box `i` of this test (fakeBox's options). */
export const fake = (i, opts = {}) => fakeBox(host(i), { hostname: hostname(i), ...opts });

/** Who holds which box's session, so the test's end can let go of everything it held. */
const held = new Set();
export const q = (h, by) => `host=${encodeURIComponent(h)}${by === undefined ? '' : `&by=${encodeURIComponent(by)}`}`;
export const connect = async (h, by) => { held.add(`${h} ${by}`); return call('POST', `/connect?${q(h, by)}`); };
export const disconnect = async (h, by) => { held.delete(`${h} ${by}`); return call('POST', `/disconnect?${q(h, by)}`); };
export const status = async (h, by) => (await call('GET', `/status?${q(h, by)}`)).body;
export const sessions = async () => (await call('GET', '/status')).body.sessions;

/** Waits until `ok()` is true, checking every 50 ms, for at most `ms`. */
export async function until(ok, ms = 15000, what = 'it') {
  const end = Date.now() + ms;
  for (;;) {
    if (await ok()) return;
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`);
    await sleep(50);
  }
}
/** A box's runs, as /runs lists them (none before its folder exists). */
export const runs = async (box) => { const r = await call('GET', `/runs?box=${box}`); return r.status === 200 ? r.body : []; };
/** Waits for the `k`th run of `box` with `trigger` whose snapshot is done, and gives its meta.json. */
export async function whole(box, trigger = 'connect', k = 1) {
  let got;
  await until(async () => (got = (await runs(box)).filter((m) => m.trigger === trigger && m.snapshot?.workers !== undefined)[k - 1]), 30000, `${box}'s ${trigger} run`);
  return got;
}
/** A run's raw/index.jsonl lines. */
export const index = (box, run) => readFileSync(join(root, box, 'runs', run, 'raw', 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** Every run folder in the data root, as <box>/<run>. */
export const allRuns = () => readdirSync(root).filter((d) => existsSync(join(root, d, 'runs'))).flatMap((d) => readdirSync(join(root, d, 'runs')).map((r) => `${d}/${r}`));
/** A WebSocket to the bridge, as the app opens one: every message it gets, as text. */
export function socket(path, origin = `http://127.0.0.1:${port}`) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
  ws.got = '';
  ws.on('message', (d) => { ws.got += String(d); });
  ws.opened = new Promise((ok, fail) => ws.once('open', ok).once('error', fail));
  return ws;
}
/** How many fake connections and shells are open, on every box. */
export const open = () => [...boxes.values()].reduce((k, b) => k + b.connections.size + b.shells.size, 0);

afterEach(async () => {
  await Promise.all([...held].map((k) => { const [h, by] = k.split(' '); return disconnect(h, by); }));
  await until(() => !open(), 5000, 'every fake connection and shell to close');
  expect(await sessions()).toEqual([]);
  boxes.clear();
});

// The procedures the bridge's procedure tests run (sessions-procedures, -changes and -drops), written into the catalog of
// the test file's own lab (lab.mjs), with the check they use, and what the tests ask the bridge with. Imported after the
// lab, so procedures.mjs is the bridge's own, reading that catalog.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, catalog, index, port, q, root, until } from './lab.mjs';

const { CHECKS } = await import('../../bridge/procedures.mjs');

/** A check of the tests' own: the box's `show flag` prints up. */
CHECKS.flag = {
  shows: () => ['show flag'],
  test: (out) => (out['show flag'].raw.trim() === 'up' ? { ok: true } : { ok: false, why: `the flag is ${out['show flag'].raw.trim()}` }),
};
export const PROCEDURES = [
  { id: 'look', label: 'Look', level: 'chassis', tier: 'read', steps: [{ send: 'show card' }, { send: 'show software' }], verify: 'flag' },
  { id: 'look-drop', label: 'Look, dropped', level: 'chassis', tier: 'read', steps: [{ send: 'show drop' }] },
  { id: 'hold', label: 'Hold', level: 'chassis', tier: 'reversible', steps: [{ send: 'set led on' }, { wait: 'flag', every: 1, timeout: 60 }], restore: [{ send: 'set led off' }] },
  { id: 'set-bad', label: 'Set bad', level: 'chassis', tier: 'change', steps: [{ send: 'set thing on' }, { send: 'set bogus 1' }, { send: 'set never 1' }] },
  {
    id: 'reboot', label: 'Reboot', level: 'chassis', tier: 'change', params: { mode: { enum: ['cold', 'warm'], default: 'cold' } },
    steps: [{ send: 'reboot ne {mode}', drops: true, timeout: 60 }, { wait: 'flag', every: 1, timeout: 60 }], verify: 'flag',
  },
  { id: 'activate', label: 'Activate', level: 'chassis', tier: 'change', steps: [{ send: 'activate sw', drops: true, timeout: 60 }, { wait: 'flag', every: 1, timeout: 60 }] },
];
mkdirSync(join(catalog, 'common'), { recursive: true });
writeFileSync(join(catalog, 'common', 'procedures.json'), JSON.stringify({ procedures: PROCEDURES }));

/** The lines that set up a procedure's shell, before `set cli confirmation-required no` (but in a read one) and exit. */
export const SETUP = ['configure', 'set cli length 0', 'set cli width 1024'];
const ENDED = ['done', 'failed', 'cancelled', 'expired'];
/** Asks for procedure `id` on box `h` as `by`, with `params`. */
export const ask = (h, id, by, params) => call('POST', `/procedure?${q(h, by)}&id=${id}`, params && JSON.stringify(params));
/** The procedure asked for on box `h` now, or last, as GET /procedure has it. */
export const current = async (h) => (await call('GET', `/procedure?host=${encodeURIComponent(h)}`)).body.current;
/** Waits for the procedure on box `h` to be over, and gives it. */
export async function over(h) {
  let got;
  await until(async () => ENDED.includes((got = await current(h))?.state), 30000, `the procedure on ${h} to end`);
  return got;
}
/** Approve as the tracer UI sends it: the page's Origin, unless `origin` says otherwise, and the hostname typed. */
export async function approve(h, ref, typed, { by = 'view:a', origin = `http://127.0.0.1:${port}` } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/procedure/approve?${q(h, by)}&ref=${ref}`,
    { method: 'POST', body: typed, headers: { 'x-ols-tracer': '1', ...(origin ? { origin } : {}) } });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type') === 'application/json' ? JSON.parse(text) : text };
}
/** The lines a procedure typed into a run, in order. */
export const typed = (box, run) => index(box, run).filter((l) => l.source === 'procedure').map((l) => l.cmd);
/** A procedure run's procedure.json. */
export const saved = (box, run) => JSON.parse(readFileSync(join(root, box, 'runs', run, 'procedure.json'), 'utf8'));

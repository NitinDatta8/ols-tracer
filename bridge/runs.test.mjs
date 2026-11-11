// The bridge's endpoints for the MCP, on a bridge of its own that never connects to a box: the read-only run endpoints
// (/runs, /run, /history) over box 3's recorded runs, /show and /baseline refusing while no box is connected, and the
// per-box sessions with none open. Nothing here posts /connect: it would open a session with a box.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const python = process.env.PYTHON ?? here('.venv/bin/python');

/** A GET to the bridge: its status and body, JSON when it is. As the app sends it, unless `headers` say otherwise. */
const get = (port, path, headers = {}) => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { 'x-ols-tracer': '1', ...headers } }, (res) => {
    let s = '';
    res.on('data', (d) => { s += d; }).on('end', () => done({ status: res.statusCode, body: res.headers['content-type'] === 'application/json' ? JSON.parse(s) : s }));
  });
  req.on('error', fail).end();
});

/** A POST to the bridge, as the MCP sends it: its status and body. */
const post = (port, path, body = '') => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'x-ols-tracer': '1' } }, (res) => {
    let s = '';
    res.on('data', (d) => { s += d; }).on('end', () => done({ status: res.statusCode, body: s }));
  });
  req.on('error', fail).end(body);
});

describe.skipIf(!existsSync(python))('run endpoints (needs npm run bridge:setup)', () => {
  let bridge;
  let port;
  beforeAll(async () => {
    port = await new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => done(p)); }); });
    bridge = spawn(process.execPath, [here('server.mjs')], { env: { ...process.env, BRIDGE_PORT: String(port) } });
    await new Promise((done) => bridge.stdout.on('data', (d) => String(d).includes('bridge on') && done()));
  });
  afterAll(() => bridge?.kill());

  it('answers only the app: the header and a localhost Host, as for the other endpoints', async () => {
    expect((await get(port, '/runs?box=paho-gs2000-03', { 'x-ols-tracer': '' })).status).toBe(403);
    expect((await get(port, '/runs?box=paho-gs2000-03', { host: 'example.com' })).status).toBe(403);
    expect((await get(port, '/runs?box=../paho-gs2000-03')).status).toBe(404);
    expect((await get(port, '/run?box=paho-gs2000-03&run=../../paho-gs2000-04/runs/20261105-131514-connect')).status).toBe(404);
  });

  it("lists a box's runs with their meta, the ones grouped by hand by their folder", async () => {
    const { status, body } = await get(port, '/runs?box=paho-gs2000-03');
    expect(status).toBe(200);
    expect(body.find((r) => r.run === '20261105-163752-pull')).toMatchObject({ trigger: 'pull', state: 'fault', snapshot: { fast: true } });
    expect(body.map((r) => r.run)).toContain('plugout-1125/20261102-124335-alarms');
    expect(body.map((r) => r.started)).toEqual(body.map((r) => r.started).sort((a, b) => Date.parse(a) - Date.parse(b)));
  });

  it('gives a pull as its fast snapshot read it, over the full one before it, with the strands and no answer', async () => {
    const { status, body } = await get(port, '/run?box=paho-gs2000-03&run=20261105-163752-pull');
    expect(status).toBe(200);
    expect(body).toMatchObject({ run: '20261105-163752-pull', meta: { trigger: 'pull' } });
    // The snapshot caught F01's loss; the last poll of the run, after the fiber went back in, did not.
    expect(Object.values(body.commands['show alarm'].data.alarms).map((a) => `${a['alarm-abbreviate']}@${a.resource}`)).toContain('RX_LOS@transceiver 1-7-4');
    expect(body.commands['show card'].at).toBeLessThan(Date.parse(body.meta.started)); // from 20261105-163633-connect
    expect(body.wiring.map((s) => s.strand)).toEqual(['F01', 'F02', 'F03', 'F04', 'F05']);
    expect(JSON.stringify(body)).not.toMatch(/"(fault|detectable|markedAt)":/);
  });

  it("gives a run with the strands it was taken with: its own wiring.csv, else the box's", async () => {
    const strand = async (run, id) => (await get(port, `/run?box=paho-gs2000-03&run=${run}`)).body.wiring.find((s) => s.strand === id);
    expect(await strand('20261102-115731-healthy-run1', 'F03')).toMatchObject({ from: '1-7-5', to: '1-1-ad1' });
    expect(await strand('20261102-115853-connect-ad2-nonworking', 'F04')).toMatchObject({ from: '1-1-ad2', to: '1-7-5' });
    expect(await strand('20261105-164615-pull', 'F03')).toMatchObject({ from: '1-7-5', to: '1-1-ad11' }); // none of its own
  });

  it('gives the latest run when none is named, and a grouped one by its folder', async () => {
    const runs = (await get(port, '/runs?box=paho-gs2000-03')).body;
    expect((await get(port, '/run?box=paho-gs2000-03')).body.run).toBe(runs.filter((r) => !r.run.includes('/')).at(-1).run);
    const grouped = await get(port, '/run?box=paho-gs2000-03&run=plugout-1125/20261102-124335-alarms');
    expect(grouped.body.meta).toMatchObject({ run: 'plugout-1125/20261102-124335-alarms', trigger: 'alarms' });
    expect((await get(port, '/run?box=paho-gs2000-03&run=20991231-000000-connect')).status).toBe(404);
  });

  it("gives the box's config log since a time: what was set, deleted or rebooted", async () => {
    const { body } = await get(port, `/history?box=paho-gs2000-03&since=${encodeURIComponent('2026-11-02T12:00:00-05:00')}`);
    expect(body[0]).toMatchObject({ at: '2026-11-02T12:01:29-05:00', type: 'set', details: expect.stringContaining('set media-channel 2') });
    expect(body.every((e) => e.kind === 'config' && Date.parse(e.at) >= Date.parse('2026-11-02T12:00:00-05:00'))).toBe(true);
    expect(body.map((e) => e.details)).toContain('reboot ne cold');
    expect((await get(port, '/history?box=paho-gs2000-03&since=yesterday')).status).toBe(400);
  });

  it('refuses a line that is not a catalog show with why, and /show and /baseline while no box is connected', async () => {
    for (const [line, why] of [
      ['show alarm | save x', /pipe/],
      ['show och ?', /\?/],
      ['set och 1-7-5 target-output-power 0', /^set is not show/],
      ['reboot ne cold', /^reboot is not show/],
      ['show flux-capacitor', /not a show command in the CLI index/],
      ['show card\nreboot ne cold', /one line/],
    ]) {
      const got = await post(port, '/show?host=nobox.invalid', line);
      expect(got.status, line).toBe(400);
      expect(got.body, line).toMatch(why);
    }
    expect(await post(port, '/show?host=nobox.invalid', 'show och 1-7-5')).toMatchObject({ status: 409, body: expect.stringMatching(/^Connect to the box first/) });
    expect(await post(port, '/baseline?host=nobox.invalid')).toMatchObject({ status: 409, body: expect.stringMatching(/^Connect to the box first/) });
    expect(await post(port, '/pull?host=nobox.invalid', 'F03')).toMatchObject({ status: 409, body: expect.stringMatching(/^Connect to the box first/) });
  });

  it('keeps a session per box: lists none open, names its box in ?host=, and a disconnect leaves only its own', async () => {
    expect((await get(port, '/status')).body).toEqual({ sessions: [] });
    expect((await get(port, '/status?host=nobox.invalid&by=codex:a')).body).toEqual({ state: 'down', host: '', box: null, error: '', snapshot: null, holders: 0, held: false });
    expect((await get(port, '/state?host=nobox.invalid')).body).toEqual({ live: false, run: null, commands: {} });
    expect((await get(port, '/wiring?host=nobox.invalid')).body).toEqual([]);
    for (const path of ['/status?host=a/b', '/state', '/wiring?host=', '/show?host=a%20b']) expect((await get(port, path)).status, path).toBe(400);
    expect(await post(port, '/disconnect?host=nobox.invalid')).toMatchObject({ status: 400, body: expect.stringMatching(/^by:/) });
    expect(await post(port, '/disconnect?host=nobox.invalid&by=codex:a')).toMatchObject({ status: 200, body: JSON.stringify({ left: false, holders: 0 }) });
    expect((await get(port, '/status')).body).toEqual({ sessions: [] });
  });
});

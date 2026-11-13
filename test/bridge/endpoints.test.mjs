// The bridge's endpoints over runs written here by hand, in a data root of its own: what /runs, /run, /history, /state
// and /wiring give for a full snapshot, a fast one over it, one cut short, a run grouped into a folder and the polls;
// that a run broken by hand (a meta.json or a line cut short, a raw file gone) never takes the bridge down, nor the
// other boxes; the lab file read, saved and synced from a box; and the checks every request passes. ssh2 is the fake in test/fakes/ssh2.mjs, so the sessions here never
// leave this process.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { call, catalog, connect, disconnect, fake, folder, host, hostname, port, root, runs, sessions, status, until, whole } from '../fakes/lab.mjs';

vi.mock('ssh2', async () => ({ default: await import('../fakes/ssh2.mjs') }));

/**
 * A run of `box` written as the recorder writes one: meta.json, raw/ with its index.jsonl, parsed/ for the commands
 * with `data`, and poll.jsonl.
 */
function write(box, run, meta, commands = [], polls = []) {
  const dir = join(root, box, 'runs', run);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  mkdirSync(join(dir, 'parsed'), { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ run: run.split('/').at(-1), box, host: `${box}.test`, trigger: run.split('-').slice(2).join('-') || 'connect', state: 'unknown', release: 'CSP-2.10.100.10_20261013', ...meta }));
  commands.forEach(({ cmd, at, raw = '', data }, n) => {
    const file = `${String(n).padStart(3, '0')}_${cmd.replace(/\W+/g, '-')}.txt`;
    writeFileSync(join(dir, 'raw', file), `${raw}\n`);
    writeFileSync(join(dir, 'raw', 'index.jsonl'), `${JSON.stringify({ n, cmd, at, source: 'snapshot', file, ok: true })}\n`, { flag: 'a' });
    if (data) writeFileSync(join(dir, 'parsed', file.replace(/\.txt$/, '.json')), JSON.stringify(data));
  });
  for (const p of polls) writeFileSync(join(dir, 'poll.jsonl'), `${JSON.stringify(p)}\n`, { flag: 'a' });
  return dir;
}
const card = (type) => ({ state: { cards: { '1-1': { 'module-type': type, present: 'true' } } } });
const at = (hms) => `2026-11-01T${hms}-05:00`;
const whole3 = { done: 3, of: 3, workers: 1 };

// lab: a full connect run, a fast alarms run over it, a connect run cut short after it, and an older one grouped by hand.
write('lab', '20261101-100000-connect', { started: at('10:00:00'), ended: at('10:01:00'), snapshot: whole3 }, [
  { cmd: 'show card', at: at('10:00:10'), data: card('TMUXC1125') },
  { cmd: 'show alarm', at: at('10:00:20'), data: { alarms: {} } },
  { cmd: 'show port', at: at('10:00:30'), raw: 'None' },
], [{ at: at('10:00:40'), cmd: 'show port', raw: 'port 1-7-4 up' }, { at: at('10:00:50'), cmd: 'show optical-port', data: { state: { ports: {} } } }]);
write('lab', '20261101-100500-alarms', { started: at('10:05:00'), ended: at('10:05:10'), snapshot: { done: 1, of: 1, fast: true, workers: 1 } }, [
  { cmd: 'show alarm', at: at('10:05:05'), data: { alarms: { 1: { resource: 'port 1-1-ad11', 'alarm-abbreviate': 'IN_LOS' } } } },
]);
write('lab', '20261101-101000-connect', { started: at('10:10:00'), ended: at('10:10:05'), snapshot: { done: 1, of: 3 } }, [
  { cmd: 'show card', at: at('10:10:01'), data: card('TMUXC25') },
]);
write('lab', 'plugout/20261101-090000-connect', { started: at('09:00:00'), ended: at('09:01:00'), snapshot: whole3 }, [
  { cmd: 'show card', at: at('09:00:10'), data: card('TMUXC925') },
]);
writeFileSync(join(root, 'lab', 'wiring.csv'), 'strand,from,to,via,length_km,loss_db,notes\r\nF01,1-7-5,1-1-ad11,,,,mux in, from the OCH\r\n\r\nF02,1-1-ad11,1-7-5,,,,\r\n');
writeFileSync(join(root, 'lab', 'history.jsonl'), [
  { at: at('09:59:00'), box: '2019-01-01T00:00:00Z', kind: 'config', type: 'set', details: 'set media-channel 2 admin-state in-service' },
  { at: at('10:02:00'), box: '2019-01-01T00:03:00Z', kind: 'alarm', action: 'CREATE', alarm: 'IN_LOS', resource: 'port 1-1-ad11' },
  { at: at('10:03:00'), box: '2019-01-01T00:04:00Z', kind: 'config', type: 'rpc', details: 'reboot ne cold' },
].map((e) => `${JSON.stringify(e)}\n`).join('') + '{"at": "2026-11-01T10:04'); // its last line cut short by a crash

// Runs broken by hand, each in a box of its own.
write('broken-meta', '20261101-100000-connect', { started: at('10:00:00'), ended: at('10:01:00'), snapshot: whole3 });
write('broken-meta', '20261101-110000-connect', { started: at('11:00:00'), ended: at('11:01:00'), snapshot: whole3 }, [{ cmd: 'show card', at: at('11:00:10'), data: card('TMUXC1125') }]);
writeFileSync(join(root, 'broken-meta', 'runs', '20261101-100000-connect', 'meta.json'), '{"run": "20261101-1000');
const lineCut = write('broken-line', '20261101-100000-connect', { started: at('10:00:00'), ended: at('10:01:00'), snapshot: whole3 }, [{ cmd: 'show card', at: at('10:00:10'), data: card('TMUXC1125') }]);
writeFileSync(join(lineCut, 'raw', 'index.jsonl'), '{"n": 1, "cmd": "show al', { flag: 'a' });
const rawGone = write('raw-gone', '20261101-100000-connect', { started: at('10:00:00'), ended: at('10:01:00'), snapshot: whole3 }, [{ cmd: 'show card', at: at('10:00:10'), data: card('TMUXC1125') }]);
writeFileSync(join(rawGone, 'raw', 'index.jsonl'), `${JSON.stringify({ n: 1, cmd: 'show port', at: at('10:00:20'), source: 'snapshot', file: '001_show-port.txt', ok: true })}\n`, { flag: 'a' });

const get = (path) => call('GET', path);

describe('read endpoints', () => {
  it("lists a box's runs oldest first, the one grouped by hand by its folder", async () => {
    expect((await runs('lab')).map((m) => [m.run, m.trigger])).toEqual([
      ['plugout/20261101-090000-connect', 'connect'], ['20261101-100000-connect', 'connect'], ['20261101-100500-alarms', 'alarms'], ['20261101-101000-connect', 'connect'],
    ]);
    expect(await get('/runs?box=nowhere')).toEqual({ status: 404, body: 'A box under data/boxes/\n' });
    expect((await get('/runs')).status).toBe(404);
  });

  it('gives the latest run as its fast snapshot read it, over the full one before it, never one cut short', async () => {
    const { body } = await get('/run?box=lab');
    expect(body).toMatchObject({ run: '20261101-100500-alarms', host: 'lab.test', meta: { trigger: 'alarms', snapshot: { fast: true } } });
    expect(body.commands['show card']).toEqual({ at: Date.parse(at('10:00:10')), data: card('TMUXC1125') }); // the full one's, not the cut-short TMUXC25
    expect(Object.keys(body.commands['show alarm'].data.alarms)).toEqual(['1']);
    expect(body.commands['show port']).toEqual({ at: Date.parse(at('10:00:30')), raw: 'None\n' }); // as the snapshot read it: no polls
    expect(body.commands['show optical-port']).toBeUndefined();
    expect(body.wiring).toEqual([
      { strand: 'F01', from: '1-7-5', to: '1-1-ad11', via: '', length_km: '', loss_db: '', notes: 'mux in, from the OCH' },
      { strand: 'F02', from: '1-1-ad11', to: '1-7-5', via: '', length_km: '', loss_db: '', notes: '' },
    ]);
  });

  it('gives a run by its name as it stood then: one cut short alone, a fast one over the full one before it, a grouped one over its folder', async () => {
    const run = async (name) => (await get(`/run?box=lab&run=${encodeURIComponent(name)}`)).body;
    expect(Object.keys((await run('20261101-101000-connect')).commands)).toEqual(['show card']);
    expect((await run('20261101-101000-connect')).commands['show card'].data).toEqual(card('TMUXC25'));
    expect(Object.keys((await run('20261101-100500-alarms')).commands).sort()).toEqual(['show alarm', 'show card', 'show port']);
    expect((await run('20261101-100000-connect')).commands['show alarm'].data).toEqual({ alarms: {} });
    const grouped = await run('plugout/20261101-090000-connect');
    expect(grouped).toMatchObject({ run: 'plugout/20261101-090000-connect', meta: { trigger: 'connect' } });
    expect(grouped.commands['show card'].data).toEqual(card('TMUXC925'));
    for (const name of ['20991231-000000-connect', '../broken-line/runs/20261101-100000-connect', 'plugout', '/etc/passwd']) {
      expect((await get(`/run?box=lab&run=${encodeURIComponent(name)}`)).status, name).toBe(404);
    }
  });

  it("gives a box's last state with its polls while no one is connected to it, and its strands", async () => {
    const { body } = await get('/state?host=lab.test');
    expect(body).toMatchObject({ live: false, host: 'lab.test', run: '20261101-100500-alarms' });
    expect(body.commands['show port']).toEqual({ at: Date.parse(at('10:00:40')), raw: 'port 1-7-4 up' }); // its last poll
    expect(body.commands['show optical-port']).toEqual({ at: Date.parse(at('10:00:50')), data: { state: { ports: {} } } });
    expect((await get('/wiring?host=lab.test')).body.map((s) => s.strand)).toEqual(['F01', 'F02']);
    expect(await get('/state?host=elsewhere.test')).toEqual({ status: 200, body: { live: false, run: null, commands: {} } });
    expect(await get('/wiring?host=elsewhere.test')).toEqual({ status: 200, body: [] });
  });

  it("gives a box's config log, since a time when asked, leaving out a line cut short", async () => {
    expect((await get('/history?box=lab')).body.map((e) => e.details)).toEqual(['set media-channel 2 admin-state in-service', 'reboot ne cold']);
    expect((await get(`/history?box=lab&since=${encodeURIComponent(at('10:03:00'))}`)).body.map((e) => e.details)).toEqual(['reboot ne cold']); // from that time on
    expect((await get(`/history?box=lab&since=${encodeURIComponent('2026-11-01T15:03:01Z')}`)).body).toEqual([]);
    for (const since of ['yesterday', '2026-13-45']) expect((await get(`/history?box=lab&since=${since}`)).status, since).toBe(400);
    expect((await get('/history?box=raw-gone')).body).toEqual([]); // no history.jsonl yet
  });

  it('answers six people asking at once the same as one, quickly', async () => {
    const paths = ['/runs?box=lab', '/run?box=lab', '/run?box=lab&run=20261101-101000-connect', `/history?box=lab&since=${encodeURIComponent(at('09:00:00'))}`, '/state?host=lab.test', '/wiring?host=lab.test', '/status'];
    const one = await Promise.all(paths.map(get));
    const t = performance.now();
    const six = await Promise.all(Array.from({ length: 6 }, () => Promise.all(Array.from({ length: 5 }, () => Promise.all(paths.map(get))))));
    expect(performance.now() - t).toBeLessThan(5000);
    for (const person of six) for (const round of person) expect(round).toEqual(one);
  });
});

describe('a run broken by hand', () => {
  it("is left out of its box's runs, and never stops anyone connecting to another box", async () => {
    expect((await runs('broken-meta')).map((m) => m.run)).toEqual(['20261101-110000-connect']);
    expect((await get('/run?box=broken-meta')).body.commands['show card'].data).toEqual(card('TMUXC1125'));
    expect((await get('/run?box=broken-meta&run=20261101-100000-connect')).status).toBe(404);
    expect((await get('/state?host=broken-meta.test')).body).toMatchObject({ live: false, run: '20261101-110000-connect' });
    const box = fake(1);
    await connect(host(1), 'view:a');
    await whole(folder(1));
    expect(box.connections.size).toBe(1);
  }, 30000);

  it('a line of its index.jsonl cut short is left out', async () => {
    expect(Object.keys((await get('/run?box=broken-line')).body.commands)).toEqual(['show card']);
  });

  it('a raw file gone is answered with why, and the bridge goes on answering everyone', async () => {
    const got = await get('/run?box=raw-gone');
    expect(got.status).toBe(500);
    expect(got.body).toMatch(/ENOENT.*001_show-port\.txt/);
    expect((await get('/state?host=raw-gone.test')).status).toBe(500);
    expect(await get('/status')).toEqual({ status: 200, body: { sessions: [] } });
    expect((await get('/run?box=lab')).status).toBe(200);
  });
});

describe('two hosts of one box', () => {
  it('connected the same second keep a run each, side by side in its folder', async () => {
    // Box 1 at two hosts, its management IP and its name, say. The first was reached before, so its run starts in the
    // box's folder; the second's starts elsewhere, and moves in once show system names the box.
    fake(1);
    fake(2, { hostname: hostname(1) });
    write(folder(1), '20261101-080000-connect', { host: host(1), started: at('08:00:00'), ended: at('08:01:00'), snapshot: whole3 });
    await Promise.all([connect(host(1), 'view:a'), connect(host(2), 'codex:1')]);
    await until(async () => (await runs(folder(1))).filter((m) => m.snapshot?.workers === 4).length === 2, 30000, 'both runs');
    const both = (await runs(folder(1))).filter((m) => m.snapshot?.workers === 4);
    expect(both.map((m) => m.host).sort()).toEqual([host(1), host(2)]);
    expect(new Set(both.map((m) => m.run)).size).toBe(2);
    for (const m of both) expect((await get(`/run?box=${folder(1)}&run=${m.run}`)).body.meta.host).toBe(m.host);
    expect((await sessions()).map((s) => s.box)).toEqual([folder(1), folder(1)]);
  }, 40000);
});

describe.skipIf(process.getuid?.() === 0)('a run folder the bridge cannot write', () => {
  it("drops only that box's connection, which opens again; the bridge and the other boxes go on", async () => {
    const [one, two] = [fake(1), fake(2)];
    mkdirSync(join(root, folder(1), 'runs'), { recursive: true });
    chmodSync(join(root, folder(1), 'runs'), 0o555);
    try {
      await Promise.all([connect(host(1), 'view:a'), connect(host(2), 'view:a')]);
      await whole(folder(2));
      await until(() => one.logins >= 2, 15000, "box 1's connection to open again");
      expect([two.logins, two.connections.size]).toEqual([1, 1]);
      expect((await status(host(2))).state).toBe('connected');
    } finally {
      chmodSync(join(root, folder(1), 'runs'), 0o755);
    }
    await disconnect(host(1), 'view:a');
  }, 40000);
});

describe('the lab file', () => {
  it('is read with its mtime, saved over the file it was read from, and follows a connected box, locked or not', async () => {
    const lab = join(catalog, 'csp', 'lab.olst.json');
    expect(await call('GET', '/lab')).toEqual({ status: 404, body: 'No lab file\n' });
    mkdirSync(join(catalog, 'csp'), { recursive: true });
    const t = { version: 1, stream: 'csp', lock: { sha256: 'a'.repeat(64) }, devices: [{ id: 'd1', chassis: 'ch-8slot', name: 'Site-1', x: 0, y: 0, host: host(1), slots: {} }], links: [] };
    writeFileSync(lab, JSON.stringify(t));
    const { body: { topology, mtime } } = await call('GET', '/lab');
    expect(topology).toEqual(t);
    const put = (m, body) => call('PUT', `/lab?mtime=${m}`, body);
    const saved = await put(mtime, JSON.stringify({ ...t, racks: [] }));
    expect(saved.status).toBe(200);
    expect(await put(mtime, JSON.stringify(t))).toEqual({ status: 409, body: 'The lab file changed since it was loaded: reload the page to get it\n' });
    expect(await put(saved.body.mtime, '{nope')).toEqual({ status: 400, body: 'A topology, as JSON\n' });
    expect((await call('POST', '/lab')).status).toBe(405);
    // A box's sync only while it is connected; then its device gets what it reports, in one write.
    const sync = JSON.stringify({ slots: { 1: { linecard: 'lc-c1125', ports: {} } }, links: [] });
    expect(await call('POST', `/lab/sync?host=${host(1)}`, sync)).toEqual({ status: 409, body: 'Connect to the box first: the lab follows what it reports\n' });
    fake(1);
    await connect(host(1), 'view:a');
    await whole(folder(1));
    const synced = await call('POST', `/lab/sync?host=${host(1)}`, sync);
    expect(synced).toEqual({ status: 200, body: { was: saved.body.mtime, mtime: expect.any(Number), changed: ['slot 1: lc-c1125 in'] } });
    expect(JSON.parse(readFileSync(lab, 'utf8')).devices[0].slots).toEqual({ 1: { linecard: 'lc-c1125', ports: {} } });
    expect(await call('POST', `/lab/sync?host=${host(1)}`, '{nope')).toEqual({ status: 400, body: 'slots and links, as JSON\n' });
    await disconnect(host(1), 'view:a');
  });

  it("gives a new box no strands until its show system names it, never another box's, so its view syncs none", async () => {
    fake(2, { hang: ['show system'] });
    await connect(host(2), 'view:a');
    await until(async () => (await status(host(2))).state === 'connected');
    expect(await call('GET', `/wiring?host=${host(2)}`)).toEqual({ status: 200, body: null });
    expect(await call('POST', `/pull?host=${host(2)}`, 'F03')).toEqual({ status: 400, body: 'A strand from wiring.csv\n' });
    await disconnect(host(2), 'view:a');
  });
});

describe('every request', () => {
  /** A request as some other client sends it, with its own headers. */
  const raw = (path, headers, method = 'GET') => new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path, method, headers, setHost: 'host' in headers }, (res) => { res.resume().on('end', () => done(res.statusCode)); }).on('error', fail).end();
  });

  it("needs the app's header and a localhost Host, so no other web page can reach a box through it", async () => {
    const app = { host: `127.0.0.1:${port}` };
    expect(await raw('/status', app)).toBe(403);
    expect(await raw('/status', { ...app, 'x-ols-tracer': '0' })).toBe(403);
    expect(await raw('/status', { 'x-ols-tracer': '1' })).toBe(400); // no Host at all: Node refuses it first
    for (const h of ['example.com', 'localhost.example.com', '127.0.0.1.nip.io', `evil.test:${port}`, `localhost:${port}.evil.test`]) {
      expect(await raw('/status', { 'x-ols-tracer': '1', host: h }), h).toBe(403);
    }
    for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, 'localhost']) expect(await raw('/status', { 'x-ols-tracer': '1', host: h }), h).toBe(200);
    expect(await raw('/connect?host=x.test&by=view:a', { host: 'example.com', 'x-ols-tracer': '1' }, 'POST')).toBe(403);
  });

  it('takes a host and a by only as one line of plain text, and changes a session only by POST', async () => {
    for (const path of ['/status?host=a/b', '/status?host=a%20b', '/state?host=', '/wiring', '/status?host=%0d%0a', `/status?host=x.test&by=${'v'.repeat(201)}`, '/status?host=x.test&by=', '/status?host=x.test&by=%7f']) {
      expect((await get(path)).status, path).toBe(400);
    }
    expect((await get('/status?host=x.test&by=codex:019a-ab_C.d e')).status).toBe(200);
    const box = fake(1);
    for (const path of ['/connect', '/disconnect', '/pull', '/show', '/baseline']) {
      expect((await get(`${path}?host=${host(1)}&by=view:a`)).status, `GET ${path}`).toBe(404);
    }
    for (const path of ['/nowhere', '/bridge/status', '/term', '/shell']) expect((await get(path)).status, path).toBe(404);
    expect(await sessions()).toEqual([]);
    expect(box.logins).toBe(0);
  });
});

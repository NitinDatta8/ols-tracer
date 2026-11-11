// The recorder with sessions to two boxes at once, in a data root of its own: no box, no Python. A stand-in Python
// (test/fakes/ssh2.mjs) parses the one command given a template here, show alarm, by printing its output, which is JSON.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakePython } from '../fakes/ssh2.mjs';

const ALARMS = 'cli_shortcut_cmds_platform__alarm__show__alarm';
const root = mkdtempSync(join(tmpdir(), 'ols-boxes-'));
vi.stubEnv('BOX_DATA_ROOT', join(root, 'start'));
vi.stubEnv('PYTHON', fakePython(root, join(root, 'start'), [ALARMS]));
const { accepted, boxAt, boxes, boxOf, ensureWiring, iso, latest, lines, metaOf, parse, Run, runsIn, runsOf, wiring } = await import('../../bridge/recorder.mjs');
const index = (run) => readFileSync(join(run.dir, 'raw', 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const read = (...p) => readFileSync(join(...p), 'utf8');

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

describe('iso', () => {
  it("is local time with its offset, to the second, in any time zone, half and quarter hours too", () => {
    const t = Date.UTC(2026, 10, 2, 15, 30, 5, 999);
    expect(Date.parse(iso(t))).toBe(t - 999);
    expect(iso(t)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    const at = (TZ) => execFileSync(process.execPath, ['--input-type=module', '-e', `import { iso } from './bridge/recorder.mjs'; process.stdout.write(iso(${t}))`], { env: { ...process.env, TZ }, cwd: new URL('../..', import.meta.url) }).toString();
    expect(['UTC', 'Asia/Kolkata', 'America/St_Johns', 'Pacific/Chatham', 'America/New_York'].map(at)).toEqual([
      '2026-11-02T15:30:05+00:00', '2026-11-02T21:00:05+05:30', '2026-11-02T12:00:05-03:30', '2026-11-03T05:15:05+13:45', '2026-11-02T10:30:05-05:00',
    ]);
  });
});

describe('a run', () => {
  it('is named after when it started and why, and never over one started the same second', () => {
    const runs = [1, 2, 3].map(() => new Run('pull', 'host-e', 'box-e'));
    const names = runs.map((r) => r.meta.run);
    const [name] = names;
    expect(name).toMatch(/^\d{8}-\d{6}-pull$/);
    expect(new Set(runs.map((r) => r.dir)).size).toBe(3);
    // Started the same second, as all but always here: the second and third are -2 and -3.
    if (names.every((x) => x.startsWith(name))) expect(names.slice(1)).toEqual([`${name}-2`, `${name}-3`]);
    expect(metaOf(runs[0].dir)).toMatchObject({ run: name, box: 'box-e', host: 'host-e', trigger: 'pull', state: 'unknown', prereqs: [], hostname: null, ended: expect.any(String) });
  });

  it('keeps each command as a raw file named after it, its line in index.jsonl, and what meta.json takes from it', async () => {
    const r = new Run('connect', 'host-f', 'box-f');
    const at = Date.parse('2026-11-02T15:30:00Z');
    await r.record('configure', at, '', true, 'prereq');
    await r.record('set cli length 0', at, 'Error: invalid value', true, 'prereq');
    await r.record('exit', at, '', false, 'prereq');
    await r.record('show software', at, 'active CSP-2.10.100.10_20261013\nstandby CSP-2.9.0', true, 'snapshot');
    await r.record('date-time', at, 'current-datetime 2021-08-01T01:00:00 UTC', true, 'snapshot');
    await r.record('show card 1-* fan', at, 'None', true, 'snapshot');
    await r.record('show och ?', at, 'Possible completions', true, 'typed');
    expect(readdirSync(join(r.dir, 'raw')).sort()).toEqual(['000_configure.txt', '001_set-cli-length-0.txt', '002_exit.txt', '003_show-software.txt', '004_date-time.txt', '005_show-card-1-all-fan.txt', '006_show-och-help.txt', 'index.jsonl']);
    expect(read(r.dir, 'raw', '003_show-software.txt')).toBe('active CSP-2.10.100.10_20261013\nstandby CSP-2.9.0\n');
    expect(index(r)[1]).toEqual({ n: 1, cmd: 'set cli length 0', at: iso(at), source: 'prereq', file: '001_set-cli-length-0.txt', ok: true });
    expect(r.meta).toMatchObject({
      prereqs: [{ cmd: 'configure', ok: true }, { cmd: 'set cli length 0', ok: false }, { cmd: 'exit', ok: false }],
      release: 'CSP-2.10.100.10_20261013', boxClock: '2021-08-01T01:00:00+00:00', boxClockOffsetSec: Math.round((Date.parse('2021-08-01T01:00:00Z') - at) / 1000),
    });
    expect(metaOf(r.dir)).toEqual(r.meta);
  });

  it("parses a command that has a template into parsed/, keeps a failed parse's error, and leaves the rest raw", async () => {
    const r = new Run('connect', 'host-g', 'box-g');
    expect(await r.record('show alarm', Date.now(), '{"alarms": {"1": {"alarm-abbreviate": "IN_LOS"}}}', true, 'snapshot')).toEqual({ template: ALARMS, data: { alarms: { 1: { 'alarm-abbreviate': 'IN_LOS' } } } });
    const bad = await r.record('show alarm', Date.now(), 'not what the template reads', true, 'snapshot');
    expect(bad).toMatchObject({ template: ALARMS, error: expect.any(String) });
    expect(await r.record('show card', Date.now(), 'None', true, 'snapshot')).toEqual({});
    expect(readdirSync(join(r.dir, 'parsed')).sort()).toEqual(['000_show-alarm.json', '001_show-alarm.json']);
    expect(JSON.parse(read(r.dir, 'parsed', '001_show-alarm.json'))).toEqual({ error: bad.error });
    expect(await parse('show flux-capacitor', 'x')).toEqual({});
  });

  it("writes a poll only when it reads differently from the last, the raw output kept when there's no parse", async () => {
    const r = new Run('connect', 'host-h', 'box-h');
    const t = Date.parse('2026-11-02T15:30:00Z');
    await r.poll('show alarm', t, '{"alarms": {}}');
    await r.poll('show alarm', t + 10000, '{"alarms": {}}');
    await r.poll('show alarm', t + 20000, '{"alarms": {"1": {}}}');
    await r.poll('show optical-port', t + 20000, 'port 1-1-ad11 2.61');
    await r.poll('show optical-port', t + 30000, 'port 1-1-ad11 2.61');
    await r.poll('show alarm', t + 40000, 'cut short');
    expect(lines(join(r.dir, 'poll.jsonl'))).toEqual([
      { at: iso(t), cmd: 'show alarm', data: { alarms: {} } },
      { at: iso(t + 20000), cmd: 'show alarm', data: { alarms: { 1: {} } } },
      { at: iso(t + 20000), cmd: 'show optical-port', raw: 'port 1-1-ad11 2.61' },
      { at: iso(t + 40000), cmd: 'show alarm', raw: 'cut short', error: expect.any(String) },
    ]);
  });

  it("is labelled as a pull with its answer, detectable only when the strand's Rx end is the box's", () => {
    const into = new Run('pull', 'host-i', 'box-i');
    into.answer({ strand: 'F03', from: '1-7-5', to: '1-1-ad11', via: '' }, Date.parse('2026-11-05T16:46:15Z'));
    expect(JSON.parse(read(into.dir, 'answer.json'))).toEqual({ fault: 'pull', strand: 'F03', from: '1-7-5', to: '1-1-ad11', via: '', markedAt: iso(Date.parse('2026-11-05T16:46:15Z')), detectable: true });
    expect(metaOf(into.dir).state).toBe('fault');
    const out = new Run('pull', 'host-i', 'box-i');
    out.answer({ strand: 'F02', from: '1-7-4', to: 'BERT:P1', via: '' }, Date.now());
    expect(JSON.parse(read(out.dir, 'answer.json')).detectable).toBe(false);
  });

  it("moves to its box with the strands it was taken with, beside another of the box's runs started the same second", async () => {
    mkdirSync(join(root, 'box-j'), { recursive: true });
    writeFileSync(join(root, 'box-j', 'wiring.csv'), 'strand,from,to,via,length_km,loss_db,notes\nF01,1-7-5,1-1-ad11,,,,\n');
    // One host of the box was reached before, so its run starts in the box; another's starts elsewhere, then moves in.
    const known = new Run('connect', 'host-j1', 'box-j');
    const other = new Run('connect', 'host-j2');
    await other.record('show system', Date.now(), 'hostname BOX-J', true, 'snapshot');
    expect(other.meta.box).toBe('box-j');
    expect(other.dir).not.toBe(known.dir);
    expect(metaOf(other.dir)).toMatchObject({ run: other.meta.run, box: 'box-j', host: 'host-j2' });
    expect(existsSync(join(known.dir, 'meta.json'))).toBe(true);
    expect(read(other.dir, 'wiring.csv')).toBe(read(root, 'box-j', 'wiring.csv'));
    writeFileSync(join(root, 'box-j', 'wiring.csv'), 'strand,from,to,via,length_km,loss_db,notes\nF01,1-7-5,1-1-ad2,,,,moved\n');
    expect(wiring('box-j', other.meta.run).map((s) => s.to)).toEqual(['1-1-ad11']); // as it was then
    expect(wiring('box-j', known.meta.run).map((s) => s.to)).toEqual(['1-1-ad2']); // none of its own: the box's now
    expect(wiring('box-j').map((s) => s.notes)).toEqual(['moved']);
  });
});

describe('wiring', () => {
  const head = 'strand,from,to,via,length_km,loss_db,notes';

  it("reads wiring.csv's notes with their commas, and skips blank lines", () => {
    mkdirSync(join(root, 'box-k'), { recursive: true });
    writeFileSync(join(root, 'box-k', 'wiring.csv'), `${head}\r\n\r\nF01,1-7-5,1-1-ad11,ATT1,0.5,10,line Tx, into the mux, at AD11\r\n`);
    expect(wiring('box-k')).toEqual([{ strand: 'F01', from: '1-7-5', to: '1-1-ad11', via: 'ATT1', length_km: '0.5', loss_db: '10', notes: 'line Tx, into the mux, at AD11' }]);
    expect(wiring('box-nowhere')).toEqual([]);
  });

  it("keeps a wiring.csv that is there, whatever the box's tables say", () => {
    const och = { raw: 'id    a\n--    -\n' };
    const before = read(root, 'box-k', 'wiring.csv');
    expect(ensureWiring({ 'show och': och }, 'box-k').map((s) => s.strand)).toEqual(['F01']);
    expect(read(root, 'box-k', 'wiring.csv')).toBe(before);
  });

  it('writes one from the tables only when it is missing and they give a strand, its notes kept to one cell', () => {
    expect(ensureWiring({}, 'box-l')).toEqual([]);
    expect(existsSync(join(root, 'box-l', 'wiring.csv'))).toBe(false);
    const raw = 'id          source-port    dest-port\n--------    -----------    ------------\nad1, slot5  port-1-5-1     port-1-1-ad1\n';
    const rows = ensureWiring({ 'show internal-connection': { raw } }, 'box-l');
    expect(rows.map((s) => [s.strand, s.from, s.to])).toEqual([['F01', '1-5-1', '1-1-ad1'], ['F02', '1-1-ad1', '1-5-1']]);
    expect(read(root, 'box-l', 'wiring.csv')).toBe(`${head}\nF01,1-5-1,1-1-ad1,ad1;,,,auto: show internal-connection\nF02,1-1-ad1,1-5-1,ad1;,,,auto: show internal-connection\n`);
    expect(wiring('box-l')).toEqual(rows.map((s) => ({ ...s, via: 'ad1;' })));
  });
});

describe('runs on disk', () => {
  it('finds runs grouped by hand into folders of their own, and nothing that is not a run', () => {
    const dir = join(root, 'box-m', 'runs');
    for (const r of ['20261101-100000-connect', 'group/20261101-090000-connect', 'group/deeper/20261101-080000-connect', 'empty-folder']) {
      mkdirSync(join(dir, r), { recursive: true });
      if (r !== 'empty-folder') writeFileSync(join(dir, r, 'meta.json'), JSON.stringify({ run: r, host: 'host-m', started: `2026-11-01T${r.match(/-(\d\d)0000-/)[1]}:00:00Z` }));
    }
    writeFileSync(join(dir, 'notes.txt'), 'not a run');
    expect(runsIn(dir).map((d) => d.slice(dir.length + 1)).sort()).toEqual(['20261101-100000-connect', 'group/20261101-090000-connect', 'group/deeper/20261101-080000-connect']);
    expect(runsOf('box-m').map((m) => m.run)).toEqual(['group/deeper/20261101-080000-connect', 'group/20261101-090000-connect', '20261101-100000-connect']);
    expect(runsIn(join(root, 'nowhere'))).toEqual([]);
    expect(boxes()).toEqual(expect.arrayContaining(['box-a', 'box-m']));
    expect(boxAt('host-m')).toBe('box-m');
  });

  it("reads a JSON-lines file's lines, leaving out one cut short, and none of a file that isn't there", () => {
    const f = join(root, 'lines.jsonl');
    writeFileSync(f, '{"a": 1}\n\n{"a": 2}\n{"a": 3');
    expect(lines(f)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(lines(join(root, 'none.jsonl'))).toEqual([]);
    expect(metaOf(join(root, 'nowhere'))).toBeNull();
  });

  it('has no last state for a box with no runs', () => {
    expect(latest(undefined, { box: 'box-nowhere' })).toBeNull();
    expect(latest('20261101-100000-connect', { box: 'box-nowhere' })).toBeNull();
  });

  it('puts a hostname in the box whose setup.md has it in a table, else a folder named after it', () => {
    mkdirSync(join(root, 'lab-west'), { recursive: true });
    writeFileSync(join(root, 'lab-west', 'setup.md'), '| hostname | rack |\n| --- | --- |\n| PAHO-GS2000-99 | 3 |\n\nAlso called PAHO-GS2000-98 in notes.\n');
    expect(boxOf('PAHO-GS2000-99')).toBe('lab-west');
    expect(boxOf('PAHO-GS2000-98')).toBe('paho-gs2000-98');
    expect(boxOf('Box-X')).toBe('box-x');
  });
});

it("takes a prerequisite only when its prompt came back and the box didn't reject it", () => {
  expect(accepted({ raw: '', ok: true })).toBe(true);
  expect(accepted({ raw: 'set cli length 0', ok: true })).toBe(true);
  for (const raw of ['Error: element does not exist', 'syntax error', 'Invalid input', 'problem parsing the command']) expect(accepted({ raw, ok: true }), raw).toBe(false);
  expect(accepted({ raw: '', ok: false })).toBe(false);
});

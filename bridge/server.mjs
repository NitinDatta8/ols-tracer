// CLI bridge: keeps an SSH session open to each box someone connects to, and gives the physical view a terminal on it.
// A browser cannot speak SSH, so the app posts /bridge/connect?host=<the box's IP>&by=<the view>, attaches its terminal
// (xterm.js) to the session's shell over a WebSocket at /bridge/term?host=, and posts /bridge/disconnect?host=&by= when
// the view closes. The shell gets keystrokes as they are typed, so the box's own Tab completion, history, Ctrl-C and
// modes work as they do over ssh. A session is shared by everyone connected to its box (physical views, Codex sessions
// through the MCP), each by its own `by`, and closes once the last of them disconnects; a box's session never touches
// another box's.
// A poller runs the commands in poll.json on shells of its own in each session (BOX_WORKERS of them share a snapshot's
// commands), records them as runs under
// data/boxes/<box>/runs/ (recorder.mjs), parses their output with TTP (parse.py) and serves the latest results at
// /bridge/state?host=. A `show` command typed in the terminal is run again there and saved in the latest run (typed.mjs),
// and a pull marked in the view (/bridge/pull?host=) takes a snapshot with its answer.json.
// A terminal window (/bridge/shell) gets a shell of its own on its box, apart from all that (terminals.mjs).
// Every box's recorded runs are read at /runs, /run and /history, by the MCP server, which calls the bridge directly. It
// also runs one show command at /show?host= (show.mjs), answered and saved in the latest run as a typed one is (source
// mcp, with who asked), and asks for a healthy baseline at /baseline?host=, a snapshot of its own.
// A procedure (procedures.mjs) runs a box workflow on a shell of its own in the box's session: /procedure?host= lists the
// box's and asks for one, /procedure/approve runs a change once a person approves it in the tracer UI, and
// /procedure/cancel stops one.
// The lab file (lab.mjs), the fixed lab the app shows everyone, is read at /lab and saved with a PUT there, refused once
// the file changed since it was read; a connected box's physical view syncs its device into it at /lab/sync?host=.
// Login settings come from bridge/.env (see .env.example). Listens on localhost only.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import { WebSocketServer } from 'ws';
import { FLAPS, record } from './history.mjs';
import { readLab, saveLab, syncLab } from './lab.mjs';
import { definitions, paramsOf, Procedure } from './procedures.mjs';
import { accepted, boxAt, boxDir, boxes, boxOf, ensureWiring, latest, lines, PYTHON, Run, runsOf, TEMPLATES_DIR, wiring } from './recorder.mjs';
import { shareOut, worker } from './shells.mjs';
import { showLine } from './show.mjs';
import { Logins, typeSteps, validSteps } from './terminals.mjs';
import { Screen } from './typed.mjs';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 8022);
/** Run once after login, e.g. to start the CLI; separated by ";". */
const INIT = (env.BOX_INIT ?? '').split(';').map((c) => c.trim()).filter(Boolean);
/** How much of the session a terminal that attaches is shown again, in bytes. */
const LOG = 256 * 1024;
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
/**
 * What the poller runs (poll.json): `prereqs` once per session before anything else, then `commands`,
 * [{ cmd, every, fast }]. The snapshot when the session opens runs every command once; those with `every` > 0 are also
 * polled that often, in s. The snapshot on an alarm change or a pull runs only those and the `fast` ones: what changes,
 * in seconds rather than a minute or more.
 */
const { prereqs: PREREQS = [], commands: POLLS = [] } = existsSync(here('poll.json')) ? JSON.parse(readFileSync(here('poll.json'), 'utf8')) : {};
/** The template of `show alarm`, whose result changing starts a new snapshot (threshold flaps aside: FLAPS). */
const ALARMS = 'cli_shortcut_cmds_platform__alarm__show__alarm';
/** The box's prompt: a regex the last line of output matches once a command is done. */
const PROMPT = new RegExp(env.BOX_PROMPT ?? '[#>$] ?$');
/** How long the poller waits for a command's prompt before it sends Ctrl-C, in ms. */
const TIMEOUT = Number(env.BOX_TIMEOUT ?? 20000);
/** How long the prompt has to stay quiet before a command counts as done, in ms. */
const SETTLE = 100;
/** How long the prompt has to stay quiet after login, for the box's banner, in ms: on top of TIMEOUT to come at all. */
const BANNER = 2000;
/** How many shells the poller opens, each a CLI session of its own, to share a snapshot's commands: 1 to 8. */
const WORKERS = Math.min(8, Math.max(1, Math.round(Number(env.BOX_WORKERS)) || 1));
/** How long a change waits for a person to Approve it, in ms. */
const PENDING = Number(env.PROCEDURE_PENDING_SEC ?? 900) * 1000;

/**
 * The open sessions, by the host each was asked for. Each is its own SSH connection, terminal shell and poller, held by
 * whoever connected to it and hasn't disconnected (`holders`, each a `by`). It closes once its last holder leaves.
 */
const sessions = new Map();

/** A session with `host`, not open yet: its runs go to the box last reached there, until `show system` names one. */
function newSession(host) {
  const s = {
    host, box: boxAt(host), holders: new Set(),
    conn: null, // its SSH connection
    state: 'down', // connecting | connected | down
    error: '',
    shell: null,
    retry: undefined,
    size: { cols: 120, rows: 30 }, // the terminal's, which the box wraps and pages its output to
    log: Buffer.alloc(0), // the session's output so far (its last LOG bytes)
    terms: new Set(), // the physical views' terminals on its shell
    polled: {}, // command → its latest { at, raw, data } or { at, raw, error }
    taking: null, // the snapshot being taken, { done, of } commands, for /status
    typed: [], // show commands typed in the terminal, waiting to run again on the poller's shell
    marks: [], // strands marked as pulled, { strand, from, to, via, at }, waiting for their snapshot
    asked: [], // show commands asked for at /show, { cmd, by, done }, waiting for the poller's shell
    baselines: [], // baselines asked for at /baseline, { done }, waiting for their snapshot
    halted: false, // its poller stopped on this connection, as a prerequisite failed: nothing asked of it would run
    run: null, // the run being recorded, which a procedure's lines go into
    epoch: 0, // how many connect snapshots it has taken whole, so a procedure knows the box is back after a drop
    procedure: null, // the procedure asked for on it: the one running or waiting for Approve, else the last
    snapshots: [], // fast snapshots asked for by its procedure, { done }, each answered with its run
  };
  /** The terminal's screen, read back for the commands typed in it. */
  s.screen = new Screen(s.size, (cmd) => { if (POLLS.length && s.state === 'connected') s.typed.push(cmd); });
  return s;
}

/** A session as /status answers it: how far it is, its box's folder, the snapshot being taken, and how many hold it. */
const statusOf = (s) => ({ state: s.state, host: s.host, box: s.box ?? null, error: s.error, snapshot: s.taking, holders: s.holders.size });

const terminals = new WebSocketServer({ noServer: true }); // the physical views', each on its box's session shell
const windows = new WebSocketServer({ noServer: true }); // terminal windows, each on a shell of its own

/** How to log in to `host`: bridge/.env's user, and its password or key. */
const loginOptions = (host) => ({
  host, port: Number(env.BOX_PORT ?? 22), username: env.BOX_USER,
  password: env.BOX_PASSWORD, privateKey: env.BOX_KEY && readFileSync(env.BOX_KEY), tryKeyboard: true,
  keepaliveInterval: 15000, readyTimeout: 20000,
});
/** The terminal windows' SSH connections, one per box. */
const logins = new Logins(loginOptions, { password: env.BOX_PASSWORD ?? '' });

/** Output of session `s` for its terminals: to every one attached, kept for those that attach later, and on the screen. */
const out = (s, d) => {
  const b = Buffer.from(d);
  s.log = Buffer.concat([s.log, b]).subarray(-LOG);
  for (const ws of s.terms) if (ws.readyState === ws.OPEN) ws.send(b);
  s.screen.write(b);
};

/** Opens session `s` to its host, and opens it again with backoff whenever it drops, until close(s). */
function connect(s, delay = 1000) {
  s.state = 'connecting';
  const c = (s.conn = new ssh2.Client());
  c
    .on('ready', () => {
      c.shell({ term: 'xterm-256color', ...s.size }, (err, ch) => {
        if (err || c !== s.conn) return c.end();
        s.shell = ch;
        ch.on('data', (d) => { if (c === s.conn) out(s, d); }).on('close', () => c.end());
        // Typed ahead: the box reads them once its shell is up.
        if (INIT.length) ch.write(INIT.map((cmd) => cmd + '\n').join(''));
        s.state = 'connected';
        s.error = '';
        delay = 1000;
        console.log(`connected to ${s.host}`);
      });
      // The poller's own shells, so it never types into the terminal's. Dumb and very tall: no colors, no paging.
      if (POLLS.length) {
        const opening = Array.from({ length: WORKERS }, () => new Promise((ok) => c.shell({ term: 'dumb', cols: 500, rows: 10000 }, (err, ch) => ok(err ? null : ch))));
        Promise.all(opening).then((chs) => {
          const got = chs.filter(Boolean);
          if (got.length < WORKERS) console.log(`${got.length} of ${WORKERS} poller shells opened on ${s.host}`);
          // A poller that fails (a run folder it can't write, say) drops its connection, which opens again: it never
          // takes the bridge down with the other sessions.
          if (got.length && c === s.conn) poll(s, c, got).catch((e) => { console.log(`poller on ${s.host}: ${e.message}`); c.end(); });
        });
      }
    })
    // RADIUS or TACACS+ logins usually come as keyboard-interactive: answer every prompt with the password.
    .on('keyboard-interactive', (_name, _info, _lang, prompts, finish) => finish(prompts.map(() => env.BOX_PASSWORD ?? '')))
    .on('error', (e) => { s.error = e.message; })
    .on('close', () => {
      if (c !== s.conn) return; // closed
      if (s.shell) out(s, `\r\n[session closed${s.error ? `: ${s.error}` : ''}: opening it again]\r\n`);
      s.shell = null;
      s.state = 'down';
      console.log(`disconnected from ${s.host}${s.error ? `: ${s.error}` : ''}, retrying in ${delay / 1000} s`);
      s.retry = setTimeout(() => connect(s, Math.min(delay * 2, 30000)), delay);
    })
    .connect(loginOptions(s.host));
}

/** Closes session `s` and stops reopening it: its poller stops, its terminals close, and what waited on it is answered. */
function close(s) {
  const c = s.conn;
  clearTimeout(s.retry);
  sessions.delete(s.host);
  console.log(`disconnected from ${s.host}`);
  s.conn = s.shell = null;
  s.state = 'down';
  s.taking = null;
  for (const { done } of [...s.asked, ...s.baselines, ...s.snapshots]) done(null); // answered: disconnected before they ran
  s.asked = [];
  s.baselines = [];
  s.snapshots = [];
  s.typed = [];
  s.marks = [];
  for (const ws of s.terms) ws.close();
  s.screen.dispose();
  c?.end();
}

/**
 * Records session `s` and polls its box on the shells `chs` of its connection `c`, until the first one closes: a
 * snapshot into a new run when the session opens and whenever the active alarms change, its commands shared out over
 * the shells, and the polls as they fall due, on the first shell.
 */
async function poll(s, c, chs) {
  const ws = chs.map((ch) => worker(ch, { prompt: PROMPT, timeout: TIMEOUT, settle: SETTLE }));
  const [main] = ws;
  const live = () => main.open && c === s.conn;
  let run; // the run being recorded
  let alarms; // the active alarm ids last seen
  let changed = false; // a poll saw them change
  const last = {}; // command → when it last ran

  /**
   * Runs `cmd`, records it in the run as `source` (prereq, snapshot, poll, typed, or mcp asked `by` someone), and keeps
   * its result for /bridge/state. Returns when it ran, its output, whether its prompt came back, and its parse.
   */
  const take = async (cmd, source, w = main, by) => {
    const at = (last[cmd] = Date.now());
    const { raw, ok } = await w.output(cmd);
    const parsed = source === 'poll' ? await run.poll(cmd, at, raw) : await run.record(cmd, at, raw, ok, source, by);
    const { template, data = null, error } = parsed;
    if (c === s.conn) s.polled[cmd] = { at, raw, ...(ok ? (error ? { error } : { data }) : { error: `no prompt within ${TIMEOUT / 1000} s` }) };
    // A typed or asked `show alarm` doesn't move the alarms the polls compare against, so it never hides a change from them.
    if (template === ALARMS && data && source !== 'typed' && source !== 'mcp') {
      const ids = Object.entries(data.alarms ?? {}).filter(([, a]) => !FLAPS.test(a['alarm-abbreviate'])).map(([id]) => id).sort().join(' ');
      if (source === 'poll' && alarms !== undefined && ids !== alarms) changed = true;
      alarms = ids;
    }
    return { cmd, at, ok, raw, ...(ok ? parsed : {}) };
  };
  // Every shell logs in at once. The others are set up after the first, one at a time, as its prerequisites set up the
  // first (unrecorded), so no two are in `configure` together; one that doesn't come up is dropped.
  if (c === s.conn) s.halted = false;
  const login = ws.map((w) => {
    if (INIT.length) w.ch.write(INIT.map((cmd) => cmd + '\n').join(''));
    return w.prompt(TIMEOUT + BANNER, BANNER); // logged in and through INIT
  });
  let ready = ws.map(() => Promise.resolve());
  const setUp = async (w, i) => {
    const drop = (why) => { console.log(`poller shell ${i + 1} of ${ws.length} on ${s.host}: ${why}, so it is not used`); w.open = false; w.ch.close(); };
    if (!(await login[i])) return drop('no prompt after login');
    for (const cmd of PREREQS) if (!accepted(await w.output(cmd))) return drop(`"${cmd}" failed`);
  };
  /**
   * A new run: the prerequisites and every command once if the session just opened, else the fast ones, shared out over
   * the shells as each is free (one not set up yet joins once it is). A `pull` run gets the marked strand's answer.json
   * first. Then the box's history takes in its logs. False if a prerequisite failed on the first shell.
   */
  const snapshot = async (trigger, mark) => {
    run = new Run(trigger, s.host, s.box);
    if (c === s.conn) s.run = run;
    const full = trigger === 'connect';
    const cmds = full ? POLLS : POLLS.filter((p) => p.every > 0 || p.fast);
    const p = (run.meta.snapshot = { done: 0, of: cmds.length, ...(full ? {} : { fast: true }) }); // saved with each command, so a cut-short run says so
    if (mark) run.answer(mark, mark.at);
    for (const cmd of full ? PREREQS : []) if (live()) await take(cmd, 'prereq');
    if (run.meta.prereqs.some((p) => !p.ok)) return false;
    if (full) {
      let after = Promise.resolve();
      ready = ws.map((w, i) => (i ? (after = after.then(() => setUp(w, i))) : after));
    }
    if (c === s.conn) s.taking = p;
    const took = await shareOut(ws, ready, cmds, async ({ cmd }, w) => {
      const { ok, error } = await take(cmd, 'snapshot', w);
      if (!ok || error) (p.failed ??= []).push(cmd); // no prompt back, or its parse failed
      p.done++;
    }, () => c === s.conn);
    p.workers = took.size;
    // Only once whole and every command read: one cut short, or with a read missing, is no baseline.
    if (trigger === 'baseline' && p.done === p.of && !p.failed) run.meta.state = 'healthy';
    run.save();
    s.box = run.meta.box; // where `show system` put it, for the session's later runs
    if (s.taking === p) s.taking = null;
    record(dirname(dirname(run.dir)));
    console.log(`recorded ${run.dir}`);
    return true;
  };

  await login[0];
  if (!live()) return; // closed while it logged in: nothing to record
  // Paging left on could cut any output short, so after a failed prerequisite nothing more is recorded or polled, and
  // what waits for the poller is answered.
  if (!(await snapshot('connect'))) {
    if (c === s.conn) {
      s.halted = true;
      for (const { done } of [...s.asked.splice(0), ...s.baselines.splice(0), ...s.snapshots.splice(0)]) done(null);
    }
    return console.log(`a prerequisite failed on ${s.host}, so it is not polled: see ${run.dir}/meta.json`);
  }
  if (c === s.conn && run.meta.snapshot.done === run.meta.snapshot.of) s.epoch++; // the box is back, whole: a procedure may go on
  while (live()) {
    if (changed) {
      changed = false;
      await snapshot('alarms');
      continue;
    }
    // A typed command first: it is one command, and belongs in the run it was typed during.
    if (s.typed.length) {
      await take(s.typed.shift(), 'typed');
      continue;
    }
    // A show asked for at /show: one command, saved in the run as a typed one is, and answered.
    if (s.asked.length) {
      const { cmd, by, done } = s.asked.shift();
      done(await take(cmd, 'mcp', main, by));
      continue;
    }
    // A marked pull gets its own snapshot, so even a pull the box can't see (no alarm changes) has a run to score.
    if (s.marks.length) {
      await snapshot('pull', s.marks.shift());
      continue;
    }
    // A baseline gets its own snapshot too, answered with its meta.json.
    if (s.baselines.length) {
      const { done } = s.baselines.shift();
      await snapshot('baseline');
      done(run.meta);
      continue;
    }
    // A procedure's snapshot, before it and after it, into a run of its own: answered with that run.
    if (s.snapshots.length) {
      const { done } = s.snapshots.shift();
      await snapshot('procedure');
      done(run);
      continue;
    }
    const now = Date.now();
    const p = POLLS.find(({ cmd, every }) => every > 0 && now - last[cmd] >= every * 1000);
    if (p) await take(p.cmd, 'poll');
    else await new Promise((r) => setTimeout(r, 1000));
  }
}

const body = async (req) => {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s.trim();
};

/**
 * A shell of a procedure's own on session `s`'s connection, logged in, as a worker: dumb and very tall, as the poller's
 * are. Null when the session isn't connected, or the box gives no shell or no prompt.
 */
const runnerShell = (s) => new Promise((done) => {
  const c = s.conn;
  if (!c || s.state !== 'connected') return done(null);
  c.shell({ term: 'dumb', cols: 500, rows: 10000 }, async (err, ch) => {
    if (err || c !== s.conn) {
      ch?.close();
      return done(null);
    }
    const w = worker(ch, { prompt: PROMPT, timeout: TIMEOUT, settle: SETTLE });
    if (INIT.length) ch.write(INIT.map((cmd) => cmd + '\n').join(''));
    if (await w.prompt(TIMEOUT + BANNER, BANNER)) return done(w);
    ch.close();
    done(null);
  });
});

/** What a procedure needs of session `s` (see Procedure in procedures.mjs), which it holds as `holder` until it is over. */
const hooksOf = (s, holder) => ({
  connected: () => s.state === 'connected' && sessions.get(s.host) === s,
  box: () => s.box,
  shell: () => runnerShell(s),
  epoch: () => s.epoch,
  snapshot: () => new Promise((done) => (sessions.get(s.host) === s ? s.snapshots.push({ done }) : done(null))),
  record: async (line, at, raw, ok) => {
    const run = s.run;
    return { run: run.meta.run, parsed: await run.record(line, at, raw, ok, 'procedure', holder) };
  },
  end: () => {
    s.holders.delete(holder);
    if (!s.holders.size && sessions.get(s.host) === s) close(s);
  },
});

/** The stream of the box at `host`, from its release (CSP-2.10.… is csp): its session's, else its last run's; or null. */
function streamOf(s, host) {
  const box = s?.box ?? boxAt(host);
  const release = s?.polled['show software']?.raw?.match(/^active\s+(\S+)/m)?.[1] ?? (box && runsOf(box).findLast((m) => m.release)?.release);
  return release?.split('-')[0].toLowerCase() ?? null;
}

const hostnameOf = (commands = {}) => commands['show system']?.raw?.match(/^hostname\s+(\S+)/m)?.[1]
  ?? commands['show system']?.data?.state?.hostname
  ?? commands['show system']?.data?.config?.hostname;

/**
 * The box's strands: from wiring.csv, generated from command output only when missing. `box` when no hostname says;
 * null while neither names it (a new host before its show system), never another box's.
 */
const strands = (commands = {}, box) => {
  const hostname = hostnameOf(commands);
  return hostname ? ensureWiring(commands, boxOf(hostname)) : box ? ensureWiring(commands, box) : null;
};

const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
/** A box's host, as /connect and the rest take it in ?host=. */
const HOST = /^[\w.:-]+$/;
/** Who connects or asks (?by=): a physical view or a Codex session, one line of printable text. */
const BY = /^[\x20-\x7e]{1,200}$/;
/** A procedure's id (?id=) and the ref of one asked for (?ref=). */
const ID = /^[a-z0-9-]{1,60}$/;
const REF = /^[0-9a-f-]{36}$/;
/** The endpoints that act on one box's session, named by ?host=. */
const PER_HOST = ['/status', '/state', '/connect', '/disconnect', '/wiring', '/pull', '/show', '/baseline', '/procedure', '/procedure/approve', '/procedure/cancel', '/lab/sync'];

/** One request to the bridge, answered. */
async function answer(req, res) {
  // Only the app, through Vite's proxy. Browsers send a custom header from another site only after a preflight, which
  // fails here (no CORS), and the Host check stops DNS rebinding. Without it, any web page could pick the box the
  // password goes to.
  if (req.headers['x-ols-tracer'] !== '1' || !LOCAL.test(req.headers.host ?? '')) return res.writeHead(403).end();
  const url = new URL(req.url ?? '', 'http://bridge');
  const json = (v) => res.setHeader('content-type', 'application/json').end(JSON.stringify(v));
  // Every session, as /status?host= answers each.
  if (url.pathname === '/status' && !url.searchParams.has('host')) return json({ sessions: [...sessions.values()].map(statusOf) });
  // The lab file: { topology, mtime }, or saved from the JSON body if it is still the file of ?mtime=, else a 409.
  if (url.pathname === '/lab') {
    if (req.method === 'GET') { const lab = readLab(); return lab ? json(lab) : res.writeHead(404).end('No lab file\n'); }
    if (req.method !== 'PUT') return res.writeHead(405, { allow: 'GET, PUT' }).end();
    let topology;
    try { topology = JSON.parse(await body(req)); } catch { return res.writeHead(400).end('A topology, as JSON\n'); }
    const r = saveLab(topology, Number(url.searchParams.get('mtime')));
    return r.why ? res.writeHead(r.status).end(`${r.why}\n`) : json(r);
  }
  if (PER_HOST.includes(url.pathname)) {
    const { host = '', by, id, ref } = Object.fromEntries(url.searchParams);
    if (!HOST.test(host)) return res.writeHead(400).end('host: an IP or host name\n');
    if (by !== undefined && !BY.test(by)) return res.writeHead(400).end('by: who it is, one line of printable text\n');
    if (id !== undefined && !ID.test(id)) return res.writeHead(400).end('id: a procedure\'s id\n');
    if (ref !== undefined && !REF.test(ref)) return res.writeHead(400).end('ref: the ref of a procedure asked for\n');
    const post = req.method === 'POST';
    const s = sessions.get(host);
    const live = s?.state === 'connected';
    /** Connected, with a poller to run what a show, a baseline or a procedure waits on. */
    const polled = live && !!POLLS.length && !s.halted;
    /** The last state on disk of the box last reached at `host`. */
    const last = () => {
      const box = s?.box ?? boxAt(host);
      return { box, state: (box && latest(undefined, { box })) || null };
    };
    // The session with `host`, and whether `by` holds it; down with no host when there is none.
    if (url.pathname === '/status') {
      return json(s ? { ...statusOf(s), held: s.holders.has(by) } : { state: 'down', host: '', box: null, error: '', snapshot: null, holders: 0, held: false });
    }
    // While connected, what the poller read this session; otherwise the last state on disk, so the view still has values.
    if (url.pathname === '/state') return json(live ? { live: true, host, commands: s.polled } : { live: false, ...(last().state ?? { run: null, commands: {} }) });
    // `by` joins the session with `host`, opening it if no one holds it yet. A session with another box stays as it is.
    if (url.pathname === '/connect' && post) {
      if (!by) return res.writeHead(400).end('by: who connects\n');
      let open = s;
      if (!open) {
        open = newSession(host);
        sessions.set(host, open);
        connect(open);
      }
      open.holders.add(by);
      return json(statusOf(open));
    }
    // `by` leaves the session with `host`, which closes once no one holds it. `left` is whether `by` held it.
    if (url.pathname === '/disconnect' && post) {
      if (!by) return res.writeHead(400).end('by: who disconnects\n');
      const left = !!s?.holders.delete(by);
      if (s && !s.holders.size) close(s);
      return json({ left, holders: s?.holders.size ?? 0 });
    }
    // The box's strands (wiring.csv), to mark one as pulled.
    if (url.pathname === '/wiring') {
      if (live) return json(strands(s.polled, s.box));
      const { box, state } = last();
      return json(box ? strands(state?.commands ?? {}, box) : []);
    }
    // A strand pulled on the box, by its wiring.csv name: recorded in a snapshot of its own, with its answer.json.
    if (url.pathname === '/pull' && post) {
      const id = await body(req);
      if (!live || !POLLS.length) return res.writeHead(409).end('Connect to the box first: a pull is recorded in a snapshot\n');
      const strand = strands(s.polled, s.box)?.find((x) => x.strand === id);
      if (!strand) return res.writeHead(400).end('A strand from wiring.csv\n');
      s.marks.push({ ...strand, at: Date.now() });
      return res.end();
    }
    // One show command on the box, run on the poller's shell between its polls: its raw output and parse, saved in the
    // latest run as a typed show is (source mcp, with `by`). The line is checked before anything reaches the box (show.mjs).
    if (url.pathname === '/show' && post) {
      const { cmd, why } = showLine(await body(req));
      if (why) return res.writeHead(400).end(`${why}\n`);
      if (!polled) return res.writeHead(409).end('Connect to the box first: a show runs on the session\n');
      const got = await new Promise((done) => s.asked.push({ cmd, by, done }));
      if (!got) return res.writeHead(409).end('Disconnected before it ran\n');
      return json({ host, ...got });
    }
    // A healthy baseline, only once the person says the box is: a snapshot of its own (…-baseline), whose meta.json says
    // state: healthy once the snapshot is whole and every command in it read. Answered with that meta.json.
    if (url.pathname === '/baseline' && post) {
      if (!polled) return res.writeHead(409).end('Connect to the box first: a baseline is recorded in a snapshot\n');
      const meta = await new Promise((done) => s.baselines.push({ done }));
      if (meta?.state !== 'healthy') {
        return res.writeHead(409).end(!meta ? 'Disconnected before the snapshot began\n'
          : meta.snapshot.done < meta.snapshot.of ? `The session closed during the snapshot, so ${meta.run} is cut short and not a baseline\n`
          : `${meta.snapshot.failed.join(', ')} got no prompt back or didn't parse, so ${meta.run} is not a baseline: try again\n`);
      }
      return json(meta);
    }
    // The procedures of the box's stream (procedures.mjs), and the one asked for on its session now, or last.
    if (url.pathname === '/procedure' && !post) {
      const stream = streamOf(s, host);
      return json({ host, stream, procedures: definitions(stream), current: s?.procedure?.status() ?? null });
    }
    // `by` asks for procedure `id` with the JSON params in the body: a read or reversible one runs now, a change waits
    // for Approve. One at a time on a box, running or waiting; it holds the session until it is over.
    if (url.pathname === '/procedure' && post) {
      const text = await body(req);
      if (!by) return res.writeHead(400).end('by: who asks\n');
      const def = definitions(streamOf(s, host)).find((p) => p.id === id);
      if (!def) return res.writeHead(404).end("id: one of the box's procedures, from GET /procedure\n");
      if (!polled) return res.writeHead(409).end('Connect to the box first: a procedure runs on its session\n');
      if (s.procedure && !s.procedure.over) return res.writeHead(409).end(`${s.procedure.def.label} is ${s.procedure.state} on this box: one at a time\n`);
      let given;
      try { given = text ? JSON.parse(text) : {}; } catch { return res.writeHead(400).end('params: a JSON object\n'); }
      const { params, why } = paramsOf(def, given);
      if (why) return res.writeHead(400).end(`${why}\n`);
      const holder = `procedure:${def.id}`;
      s.procedure = new Procedure(def, params, { by, hooks: hooksOf(s, holder), timeout: TIMEOUT, pendingMs: PENDING });
      s.holders.add(holder);
      s.procedure.start();
      return json(s.procedure.status());
    }
    // A person approves the change waiting on the box (?ref=), typing its hostname in the body. Only from the tracer UI:
    // a browser always sends the page's Origin and a page can't fake it, so the MCP server can't approve what it asked
    // for. A local process that forges headers could: this is a guard, not security.
    if (url.pathname === '/procedure/approve' && post) {
      const typed = await body(req);
      if ((req.headers.origin ?? '').replace(/^https?:\/\//, '') !== req.headers.host) return res.writeHead(403).end('Approve only from the tracer UI\n');
      if (!by) return res.writeHead(400).end('by: who approves\n');
      const p = s?.procedure;
      if (!p || p.state !== 'pending' || p.ref !== ref) return res.writeHead(409).end('Nothing with that ref is waiting for Approve on this box\n');
      if (!polled) return res.writeHead(409).end('Connect to the box first: a procedure runs on its session\n');
      const hostname = hostnameOf(s.polled);
      if (!hostname) return res.writeHead(409).end("The box's hostname isn't known yet: wait for its snapshot\n");
      if (typed.toLowerCase() !== hostname.toLowerCase()) return res.writeHead(400).end(`Type the box's hostname, ${hostname}, to approve\n`);
      p.approve(by);
      return json(p.status());
    }
    // What the box at `host` reports, as its physical view synced it while connected: its device in the lab file gets
    // its cards, pluggables and fibers, in one write (lab.mjs). Answered with what changed.
    if (url.pathname === '/lab/sync' && post) {
      const text = await body(req);
      if (!live) return res.writeHead(409).end('Connect to the box first: the lab follows what it reports\n');
      let sync;
      try { sync = JSON.parse(text); } catch { return res.writeHead(400).end('slots and links, as JSON\n'); }
      const r = syncLab(host, sync);
      return r.why ? res.writeHead(r.status).end(`${r.why}\n`) : json(r);
    }
    // `by` stops the procedure on the box (?ref=): a waiting one at once, a running one at its next step.
    if (url.pathname === '/procedure/cancel' && post) {
      if (!by) return res.writeHead(400).end('by: who cancels\n');
      const p = s?.procedure;
      if (!p || p.over || p.ref !== ref) return res.writeHead(409).end('Nothing with that ref is running or waiting on this box\n');
      p.cancel(by);
      return json(p.status());
    }
    return res.writeHead(404).end();
  }
  // A box's recorded runs, read-only: ?box= is a folder under data/boxes/. /runs lists them with their meta.json. /run is
  // one (?run=, else the latest) as its snapshot read it, a fast one over the full one before it, with its meta.json and
  // the strands it was taken with (its own wiring.csv, else the box's); never its answer.json, which is for scoring
  // only. /history is the box's config log since ?since=.
  if (['/runs', '/run', '/history'].includes(url.pathname)) {
    const { box, run, since } = Object.fromEntries(url.searchParams);
    if (!boxes().includes(box)) return res.writeHead(404).end('A box under data/boxes/\n');
    const runs = runsOf(box);
    if (url.pathname === '/runs') return json(runs);
    if (url.pathname === '/run') {
      const s = (!run || runs.some((r) => r.run === run)) && latest(run, { box, polls: false });
      return s ? json({ ...s, meta: runs.find((r) => r.run === s.run), wiring: wiring(box, s.run) }) : res.writeHead(404).end('A run from /runs\n');
    }
    if (since && Number.isNaN(Date.parse(since))) return res.writeHead(400).end('since: an ISO time\n');
    return json(lines(join(boxDir(box), 'history.jsonl')).filter((e) => e.kind === 'config' && (!since || Date.parse(e.at) >= Date.parse(since))));
  }
  res.writeHead(404).end();
}

// A request that fails, such as on a run file broken by hand, is answered with why: it never takes the bridge down
// with everyone's sessions.
const server = createServer((req, res) => answer(req, res).catch((e) => {
  console.log(`${req.method} ${req.url}: ${e.message}`);
  if (!res.headersSent) res.writeHead(500);
  res.end(`${e.message}\n`);
}));

/**
 * A terminal window: a new shell on box `host` (its own SSH connection, shared with the box's other windows), with
 * `steps` typed in first, each once the prompt is back, so it opens in its mode. Output goes to the window as it comes,
 * steps and all; the window's keystrokes go to the shell once it is open. Closing either closes the other.
 */
async function openWindow(ws, params) {
  const host = params.get('host') ?? '';
  let steps = null;
  try { steps = JSON.parse(params.get('steps') ?? '[]'); } catch {}
  const say = (text) => ws.readyState === ws.OPEN && ws.send(Buffer.from(`\x1b[90m${text}\x1b[0m\r\n`));
  ws.on('error', () => {});
  if (!/^[\w.:-]+$/.test(host) || !validSteps(steps)) {
    say('[a terminal needs a box IP and its steps, one line each]');
    return ws.close();
  }
  let ch = null;
  let gone = false;
  let size = { cols: 120, rows: 30 };
  ws.on('message', (m) => {
    let msg;
    try { msg = JSON.parse(m); } catch { return; }
    if (msg.cols > 0 && msg.rows > 0) {
      size = { cols: msg.cols, rows: msg.rows };
      ch?.setWindow(size.rows, size.cols, 0, 0);
    } else if (typeof msg.d === 'string') ch?.write(msg.d);
  });
  ws.on('close', () => {
    gone = true;
    ch?.close();
    logins.release(host);
    console.log(`terminal window on ${host} closed`);
  });
  console.log(`terminal window on ${host}${steps.length ? `: ${steps.join(' → ')}` : ', show mode'}`);
  let c;
  try {
    c = await logins.open(host);
  } catch (e) {
    say(`[could not log in to ${host}: ${e.message}]`);
    return ws.close();
  }
  if (gone) return;
  c.shell({ term: 'xterm-256color', ...size }, async (err, sh) => {
    if (err || gone) {
      if (err) say(`[no shell on ${host}: ${err.message}]`);
      sh?.close();
      return ws.close();
    }
    ch = sh;
    sh.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d)).on('close', () => { say('\r\n[shell closed]'); ws.close(); });
    sh.setWindow(size.rows, size.cols, 0, 0); // resized while it opened
    if (INIT.length) sh.write(INIT.map((cmd) => cmd + '\n').join(''));
    const { stuck } = await typeSteps(sh, steps, { prompt: PROMPT, timeout: TIMEOUT, settle: 300, login: TIMEOUT + BANNER, loginQuiet: BANNER });
    if (stuck !== undefined && !gone) say(`\r\n[no prompt came before "${stuck}", so it and the steps after it were not typed: carry on by hand]`);
  });
}

// A terminal attaches. A browser cannot add the header to a WebSocket, but always sends the page's Origin, which a page
// cannot fake: only a page served from the host it connects to (the app, through Vite's proxy) gets a terminal.
// Without it, any web page could type commands on the box. /term?host= is a physical view's, on that box's session;
// /shell a terminal window's.
server.on('upgrade', (req, socket, head) => {
  const { host: to = '', origin = '' } = req.headers;
  const url = new URL(req.url ?? '', 'http://bridge');
  if (!['/term', '/shell'].includes(url.pathname) || !LOCAL.test(to) || origin.replace(/^https?:\/\//, '') !== to) return socket.destroy();
  if (url.pathname === '/shell') return windows.handleUpgrade(req, socket, head, (ws) => void openWindow(ws, url.searchParams));
  const s = sessions.get(url.searchParams.get('host') ?? '');
  if ([...url.searchParams.keys()].join() !== 'host' || !s) return socket.destroy();
  terminals.handleUpgrade(req, socket, head, (ws) => {
    ws.send(s.log);
    s.terms.add(ws);
    ws.on('close', () => s.terms.delete(ws));
    ws.on('error', () => {});
    // Keystrokes as typed, { d }, or the terminal's new size, { cols, rows }.
    ws.on('message', (m) => {
      let msg;
      if (!s.conn) return; // closed: its screen is gone
      try { msg = JSON.parse(m); } catch { return; }
      if (msg.cols > 0 && msg.rows > 0) {
        s.size = { cols: msg.cols, rows: msg.rows };
        s.shell?.setWindow(s.size.rows, s.size.cols, 0, 0);
        s.screen.resize(s.size);
      } else if (typeof msg.d === 'string' && s.shell) {
        s.shell.write(msg.d);
        if (msg.d.includes('\r')) s.screen.enter(); // the line it ends is read back once the box echoes it
      }
    });
  });
});

if (!existsSync(PYTHON)) {
  console.error(`bridge: no Python at ${PYTHON}, so nothing would parse. Run npm run bridge:setup first.`);
  process.exit(1);
}
// Without them every run would be recorded unparsed, as eight were while the box folders were renamed.
if (!existsSync(TEMPLATES_DIR)) {
  console.error(`bridge: no TTP templates at ${TEMPLATES_DIR}, so nothing would parse. Check BOX_DATA_BOX and BOX_DATA_ROOT in bridge/.env.`);
  process.exit(1);
}
server.listen(PORT, '127.0.0.1', () => console.log(`bridge on http://127.0.0.1:${PORT}: connect to a box from its physical view`));

// CLI bridge: keeps one SSH session open to the box the physical view connects to, and gives the view a terminal on it.
// A browser cannot speak SSH, so the app posts the box's IP to /bridge/connect, attaches its terminal (xterm.js) to the
// session's shell over a WebSocket at /bridge/term, and posts /bridge/disconnect when the view closes. The shell gets
// keystrokes as they are typed, so the box's own Tab completion, history, Ctrl-C and modes work as they do over ssh.
// A poller runs the commands in poll.json on shells of its own in the session (BOX_WORKERS of them share a snapshot's
// commands), records them as runs under
// data/boxes/<box>/runs/ (recorder.mjs), parses their output with TTP (parse.py) and serves the latest results at
// /bridge/state. A `show` command typed in the terminal is run again there and saved in the latest run (typed.mjs), and
// a pull marked in the view (/bridge/pull) takes a snapshot with its answer.json.
// A terminal window (/bridge/shell) gets a shell of its own on its box, apart from all that (terminals.mjs).
// Every box's recorded runs are read at /runs, /run and /history, by the MCP server, which calls the bridge directly.
// Login settings come from bridge/.env (see .env.example). Listens on localhost only.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import { WebSocketServer } from 'ws';
import { record } from './history.mjs';
import { accepted, boxDir, boxes, boxOf, ensureWiring, latest, lines, PYTHON, Run, runsOf, wiring } from './recorder.mjs';
import { shareOut, worker } from './shells.mjs';
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
/** The template of `show alarm`, whose result changing starts a new snapshot. */
const ALARMS = 'cli_shortcut_cmds_platform__alarm__show__alarm';
/**
 * Alarms that come and go with the light's ripple, so they never start a snapshot: threshold warnings (box 3's AD11
 * input sits on its 3 dBm one) and a WSS attenuation at its limit. A fault raises a LOS or a failure with them.
 */
const FLAPS = /_WARNING$|^REACH_MAX_ATT/;
/** The box's prompt: a regex the last line of output matches once a command is done. */
const PROMPT = new RegExp(env.BOX_PROMPT ?? '[#>$] ?$');
/** How long the poller waits for a command's prompt before it sends Ctrl-C, in ms. */
const TIMEOUT = Number(env.BOX_TIMEOUT ?? 20000);
/** How long the prompt has to stay quiet before a command counts as done, in ms. */
const SETTLE = 100;
/** How many shells the poller opens, each a CLI session of its own, to share a snapshot's commands: 1 to 8. */
const WORKERS = Math.min(8, Math.max(1, Math.round(Number(env.BOX_WORKERS)) || 1));

let host = ''; // the box asked for, '' once disconnected
let conn = null; // its SSH connection
let state = 'down'; // connecting | connected | down
let error = '';
let shell = null;
let size = { cols: 120, rows: 30 }; // the terminal's, which the box wraps and pages its output to
let log = Buffer.alloc(0); // the session's output so far (its last LOG bytes)
let polled = {}; // command → its latest { at, raw, data } or { at, raw, error }
let taking = null; // the snapshot being taken, { done, of } commands, for /status
let retry;
let typed = []; // show commands typed in the terminal, waiting to run again on the poller's shell
let marks = []; // strands marked as pulled, { strand, from, to, via, at }, waiting for their snapshot
/** The terminal's screen, read back for the commands typed in it. */
const newScreen = () => new Screen(size, (cmd) => { if (POLLS.length && state === 'connected') typed.push(cmd); });
let screen = newScreen();

const terminals = new WebSocketServer({ noServer: true }); // the physical view's, on the session's shell
const windows = new WebSocketServer({ noServer: true }); // terminal windows, each on a shell of its own

/** How to log in to `host`: bridge/.env's user, and its password or key. */
const loginOptions = (host) => ({
  host, port: Number(env.BOX_PORT ?? 22), username: env.BOX_USER,
  password: env.BOX_PASSWORD, privateKey: env.BOX_KEY && readFileSync(env.BOX_KEY), tryKeyboard: true,
  keepaliveInterval: 15000, readyTimeout: 20000,
});
/** The terminal windows' SSH connections, one per box. */
const logins = new Logins(loginOptions, { password: env.BOX_PASSWORD ?? '' });

/** Output for the terminals: to every one attached, kept for those that attach later, and on the screen. */
const out = (d) => {
  const b = Buffer.from(d);
  log = Buffer.concat([log, b]).subarray(-LOG);
  for (const ws of terminals.clients) ws.send(b);
  screen.write(b);
};

/** Opens the session to `host`, and opens it again with backoff whenever it drops, until disconnect(). */
function connect(delay = 1000) {
  state = 'connecting';
  const c = (conn = new ssh2.Client());
  c
    .on('ready', () => {
      c.shell({ term: 'xterm-256color', ...size }, (err, ch) => {
        if (err || c !== conn) return c.end();
        shell = ch;
        ch.on('data', out).on('close', () => c.end());
        // Typed ahead: the box reads them once its shell is up.
        if (INIT.length) ch.write(INIT.map((cmd) => cmd + '\n').join(''));
        state = 'connected';
        error = '';
        delay = 1000;
        console.log(`connected to ${host}`);
      });
      // The poller's own shells, so it never types into the terminal's. Dumb and very tall: no colors, no paging.
      if (POLLS.length) {
        const opening = Array.from({ length: WORKERS }, () => new Promise((ok) => c.shell({ term: 'dumb', cols: 500, rows: 10000 }, (err, ch) => ok(err ? null : ch))));
        Promise.all(opening).then((chs) => {
          const got = chs.filter(Boolean);
          if (got.length < WORKERS) console.log(`${got.length} of ${WORKERS} poller shells opened on ${host}`);
          if (got.length && c === conn) poll(c, got);
        });
      }
    })
    // RADIUS or TACACS+ logins usually come as keyboard-interactive: answer every prompt with the password.
    .on('keyboard-interactive', (_name, _info, _lang, prompts, finish) => finish(prompts.map(() => env.BOX_PASSWORD ?? '')))
    .on('error', (e) => { error = e.message; })
    .on('close', () => {
      if (c !== conn) return; // disconnected, or replaced by a session to another box
      if (shell) out(`\r\n[session closed${error ? `: ${error}` : ''}: opening it again]\r\n`);
      shell = null;
      state = 'down';
      console.log(`disconnected from ${host}${error ? `: ${error}` : ''}, retrying in ${delay / 1000} s`);
      retry = setTimeout(() => connect(Math.min(delay * 2, 30000)), delay);
    })
    .connect(loginOptions(host));
}

/** Closes the session and stops reopening it. */
function disconnect() {
  const c = conn;
  clearTimeout(retry);
  if (host) console.log(`disconnected from ${host}`);
  conn = shell = null;
  host = error = '';
  state = 'down';
  log = Buffer.alloc(0);
  polled = {};
  taking = null;
  typed = [];
  marks = [];
  screen.dispose();
  screen = newScreen();
  c?.end();
}

/**
 * Records the session and polls the box on the shells `chs` of session `c`, until the first one closes: a snapshot into
 * a new run when the session opens and whenever the active alarms change, its commands shared out over the shells, and
 * the polls as they fall due, on the first shell.
 */
async function poll(c, chs) {
  const ws = chs.map((ch) => worker(ch, { prompt: PROMPT, timeout: TIMEOUT, settle: SETTLE }));
  const [main] = ws;
  const live = () => main.open && c === conn;
  let run; // the run being recorded
  let alarms; // the active alarm ids last seen
  let changed = false; // a poll saw them change
  const last = {}; // command → when it last ran

  /** Runs `cmd`, records it in the run as `source` (prereq, snapshot, poll or typed), and keeps its result for /bridge/state. */
  const take = async (cmd, source, w = main) => {
    const at = (last[cmd] = Date.now());
    const { raw, ok } = await w.output(cmd);
    const { template, data = null, error } = source === 'poll' ? await run.poll(cmd, at, raw) : await run.record(cmd, at, raw, ok, source);
    if (c === conn) polled[cmd] = { at, raw, ...(ok ? (error ? { error } : { data }) : { error: `no prompt within ${TIMEOUT / 1000} s` }) };
    // A typed `show alarm` doesn't move the alarms the polls compare against, so it never hides a change from them.
    if (template !== ALARMS || !data || source === 'typed') return;
    const ids = Object.entries(data.alarms ?? {}).filter(([, a]) => !FLAPS.test(a['alarm-abbreviate'])).map(([id]) => id).sort().join(' ');
    if (source === 'poll' && alarms !== undefined && ids !== alarms) changed = true;
    alarms = ids;
  };
  // Every shell logs in at once. The others are set up after the first, one at a time, as its prerequisites set up the
  // first (unrecorded), so no two are in `configure` together; one that doesn't come up is dropped.
  const login = ws.map((w) => {
    if (INIT.length) w.ch.write(INIT.map((cmd) => cmd + '\n').join(''));
    return w.prompt(TIMEOUT, 2000); // logged in and through INIT
  });
  let ready = ws.map(() => Promise.resolve());
  const setUp = async (w, i) => {
    const drop = (why) => { console.log(`poller shell ${i + 1} of ${ws.length} on ${host}: ${why}, so it is not used`); w.open = false; w.ch.close(); };
    if (!(await login[i])) return drop('no prompt after login');
    for (const cmd of PREREQS) if (!accepted(await w.output(cmd))) return drop(`"${cmd}" failed`);
  };
  /**
   * A new run: the prerequisites and every command once if the session just opened, else the fast ones, shared out over
   * the shells as each is free (one not set up yet joins once it is). A `pull` run gets the marked strand's answer.json
   * first. Then the box's history takes in its logs. False if a prerequisite failed on the first shell.
   */
  const snapshot = async (trigger, mark) => {
    run = new Run(trigger, host);
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
    if (c === conn) taking = p;
    const took = await shareOut(ws, ready, cmds, async ({ cmd }, w) => { await take(cmd, 'snapshot', w); p.done++; }, () => c === conn);
    p.workers = took.size;
    run.save();
    if (taking === p) taking = null;
    record(dirname(dirname(run.dir)));
    console.log(`recorded ${run.dir}`);
    return true;
  };

  await login[0];
  // Paging left on could cut any output short, so after a failed prerequisite nothing more is recorded or polled.
  if (!(await snapshot('connect'))) return console.log(`a prerequisite failed on ${host}, so it is not polled: see ${run.dir}/meta.json`);
  while (live()) {
    if (changed) {
      changed = false;
      await snapshot('alarms');
      continue;
    }
    // A typed command first: it is one command, and belongs in the run it was typed during.
    if (typed.length) {
      await take(typed.shift(), 'typed');
      continue;
    }
    // A marked pull gets its own snapshot, so even a pull the box can't see (no alarm changes) has a run to score.
    if (marks.length) {
      await snapshot('pull', marks.shift());
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

const hostnameOf = (commands = {}) => commands['show system']?.raw?.match(/^hostname\s+(\S+)/m)?.[1]
  ?? commands['show system']?.data?.state?.hostname
  ?? commands['show system']?.data?.config?.hostname;

/** The box's strands: from wiring.csv, generated from command output only when missing. */
const strands = (commands = {}) => {
  const hostname = hostnameOf(commands);
  return hostname ? ensureWiring(commands, boxOf(hostname)) : ensureWiring(commands);
};

const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

const server = createServer(async (req, res) => {
  // Only the app, through Vite's proxy. Browsers send a custom header from another site only after a preflight, which
  // fails here (no CORS), and the Host check stops DNS rebinding. Without it, any web page could pick the box the
  // password goes to.
  if (req.headers['x-ols-tracer'] !== '1' || !LOCAL.test(req.headers.host ?? '')) return res.writeHead(403).end();
  if (req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ state, host, error, snapshot: taking }));
  }
  // While connected, what the poller read this session; otherwise the last state on disk, so the view still has values.
  if (req.url === '/state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(state === 'connected' ? { live: true, host, commands: polled } : { live: false, ...(latest() ?? { run: null, commands: {} }) }));
  }
  if (req.url === '/connect' && req.method === 'POST') {
    const to = await body(req);
    if (!/^[\w.:-]+$/.test(to)) return res.writeHead(400).end('An IP or host name\n');
    if (to !== host) {
      disconnect();
      host = to;
      connect();
    }
    return res.end();
  }
  if (req.url === '/disconnect' && req.method === 'POST') {
    disconnect();
    return res.end();
  }
  // The box's strands (wiring.csv), to mark one as pulled.
  if (req.url === '/wiring') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(state === 'connected' ? strands(polled) : strands(latest()?.commands ?? {})));
  }
  // A strand pulled on the box, by its wiring.csv name: recorded in a snapshot of its own, with its answer.json.
  if (req.url === '/pull' && req.method === 'POST') {
    const id = await body(req);
    if (state !== 'connected' || !POLLS.length) return res.writeHead(409).end('Connect to the box first: a pull is recorded in a snapshot\n');
    const strand = strands(polled).find((s) => s.strand === id);
    if (!strand) return res.writeHead(400).end('A strand from wiring.csv\n');
    marks.push({ ...strand, at: Date.now() });
    return res.end();
  }
  // A box's recorded runs, read-only: ?box= is a folder under data/boxes/. /runs lists them with their meta.json. /run is
  // one (?run=, else the latest) as its snapshot read it, a fast one over the full one before it, with its meta.json and
  // the box's strands; never its answer.json, which is for scoring only. /history is the box's config log since ?since=.
  const url = new URL(req.url ?? '', 'http://bridge');
  if (['/runs', '/run', '/history'].includes(url.pathname)) {
    const { box, run, since } = Object.fromEntries(url.searchParams);
    if (!boxes().includes(box)) return res.writeHead(404).end('A box under data/boxes/\n');
    const json = (v) => res.setHeader('content-type', 'application/json').end(JSON.stringify(v));
    const runs = runsOf(box);
    if (url.pathname === '/runs') return json(runs);
    if (url.pathname === '/run') {
      const s = (!run || runs.some((r) => r.run === run)) && latest(run, { box, polls: false });
      return s ? json({ ...s, meta: runs.find((r) => r.run === s.run), wiring: wiring(box) }) : res.writeHead(404).end('A run from /runs\n');
    }
    if (since && Number.isNaN(Date.parse(since))) return res.writeHead(400).end('since: an ISO time\n');
    return json(lines(join(boxDir(box), 'history.jsonl')).filter((e) => e.kind === 'config' && (!since || Date.parse(e.at) >= Date.parse(since))));
  }
  res.writeHead(404).end();
});

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
    const { stuck } = await typeSteps(sh, steps, { prompt: PROMPT, timeout: TIMEOUT, settle: 300, login: TIMEOUT, loginQuiet: 2000 });
    if (stuck !== undefined && !gone) say(`\r\n[no prompt came before "${stuck}", so it and the steps after it were not typed: carry on by hand]`);
  });
}

// A terminal attaches. A browser cannot add the header to a WebSocket, but always sends the page's Origin, which a page
// cannot fake: only a page served from the host it connects to (the app, through Vite's proxy) gets a terminal.
// Without it, any web page could type commands on the box. /term is the physical view's, /shell a terminal window's.
server.on('upgrade', (req, socket, head) => {
  const { host: to = '', origin = '' } = req.headers;
  const url = new URL(req.url ?? '', 'http://bridge');
  if (!['/term', '/shell'].includes(url.pathname) || !LOCAL.test(to) || origin.replace(/^https?:\/\//, '') !== to) return socket.destroy();
  if (url.pathname === '/shell') return windows.handleUpgrade(req, socket, head, (ws) => void openWindow(ws, url.searchParams));
  if (url.search) return socket.destroy();
  terminals.handleUpgrade(req, socket, head, (ws) => {
    ws.send(log);
    ws.on('error', () => {});
    // Keystrokes as typed, { d }, or the terminal's new size, { cols, rows }.
    ws.on('message', (m) => {
      let msg;
      try { msg = JSON.parse(m); } catch { return; }
      if (msg.cols > 0 && msg.rows > 0) {
        size = { cols: msg.cols, rows: msg.rows };
        shell?.setWindow(size.rows, size.cols, 0, 0);
        screen.resize(size);
      } else if (typeof msg.d === 'string' && shell) {
        shell.write(msg.d);
        if (msg.d.includes('\r')) screen.enter(); // the line it ends is read back once the box echoes it
      }
    });
  });
});

if (!existsSync(PYTHON)) {
  console.error(`bridge: no Python at ${PYTHON}, so nothing would parse. Run npm run bridge:setup first.`);
  process.exit(1);
}
server.listen(PORT, '127.0.0.1', () => console.log(`bridge on http://127.0.0.1:${PORT}: connect to a box from its physical view`));

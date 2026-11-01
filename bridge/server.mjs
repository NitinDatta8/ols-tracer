// CLI bridge: keeps one SSH session open to the box the physical view connects to, and gives the view a terminal on it.
// A browser cannot speak SSH, so the app posts the box's IP to /bridge/connect, attaches its terminal (xterm.js) to the
// session's shell over a WebSocket at /bridge/term, and posts /bridge/disconnect when the view closes. The shell gets
// keystrokes as they are typed, so the box's own Tab completion, history, Ctrl-C and modes work as they do over ssh.
// A poller runs the commands in poll.json on a second shell of the session, records them as runs under
// data/boxes/<box>/runs/ (recorder.mjs), parses their output with TTP (parse.py) and serves the latest results at
// /bridge/state.
// Login settings come from bridge/.env (see .env.example). Listens on localhost only.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import { WebSocketServer } from 'ws';
import { latest, Run } from './recorder.mjs';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 8022);
/** Run once after login, e.g. to start the CLI; separated by ";". */
const INIT = (env.BOX_INIT ?? '').split(';').map((c) => c.trim()).filter(Boolean);
/** How much of the session a terminal that attaches is shown again, in bytes. */
const LOG = 256 * 1024;
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
/**
 * What the poller runs (poll.json): `prereqs` once per session before anything else, then `commands`, [{ cmd, every }].
 * Each snapshot runs every command once; those with `every` > 0 are also polled that often, in s.
 */
const { prereqs: PREREQS = [], commands: POLLS = [] } = existsSync(here('poll.json')) ? JSON.parse(readFileSync(here('poll.json'), 'utf8')) : {};
/** The template of `show alarm`, whose result changing starts a new snapshot. */
const ALARMS = 'cli_shortcut_cmds_platform__alarm__show__alarm';
/** The box's prompt: a regex the last line of output matches once a command is done. */
const PROMPT = new RegExp(env.BOX_PROMPT ?? '[#>$] ?$');
/** How long the poller waits for a command's prompt before it sends Ctrl-C, in ms. */
const TIMEOUT = Number(env.BOX_TIMEOUT ?? 20000);

let host = ''; // the box asked for, '' once disconnected
let conn = null; // its SSH connection
let state = 'down'; // connecting | connected | down
let error = '';
let shell = null;
let size = { cols: 120, rows: 30 }; // the terminal's, which the box wraps and pages its output to
let log = Buffer.alloc(0); // the session's output so far (its last LOG bytes)
let polled = {}; // command → its latest { at, raw, data } or { at, raw, error }
let retry;

const terminals = new WebSocketServer({ noServer: true });

/** Output for the terminals: to every one attached, and kept for those that attach later. */
const out = (d) => {
  const b = Buffer.from(d);
  log = Buffer.concat([log, b]).subarray(-LOG);
  for (const ws of terminals.clients) ws.send(b);
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
      // The poller's own shell, so it never types into the terminal's. Dumb and very tall: no colors, no paging.
      if (POLLS.length) c.shell({ term: 'dumb', cols: 500, rows: 10000 }, (err, ch) => { if (!err && c === conn) poll(c, ch); });
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
    .connect({
      host, port: Number(env.BOX_PORT ?? 22), username: env.BOX_USER,
      password: env.BOX_PASSWORD, privateKey: env.BOX_KEY && readFileSync(env.BOX_KEY), tryKeyboard: true,
      keepaliveInterval: 15000, readyTimeout: 20000,
    });
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
  c?.end();
}

/**
 * Records the session and polls the box, one command at a time on the shell `ch` of session `c`, until it closes: a
 * snapshot into a new run when the session opens and whenever the active alarms change, and the polls as they fall due.
 */
async function poll(c, ch) {
  let buf = '';
  let open = true;
  let wake = () => {};
  ch.on('data', (d) => { buf += d; wake(); }).on('close', () => { open = false; wake(); });
  const lines = () => buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
  /** True once the shell shows its prompt and stays quiet for `settle` ms; false after `ms`, or when it closes. */
  const prompt = (ms, settle = 300) => new Promise((done) => {
    let quiet;
    const give = setTimeout(() => done(false), ms);
    wake = () => {
      clearTimeout(quiet);
      if (!open) { clearTimeout(give); return done(false); }
      if (PROMPT.test(lines().at(-1))) quiet = setTimeout(() => { clearTimeout(give); done(true); }, settle);
    };
    wake();
  });
  /** A command's output, the lines between its echo and the next prompt, and whether the prompt came back. */
  const output = async (cmd) => {
    buf = '';
    ch.write(cmd + '\n');
    if (await prompt(TIMEOUT)) return { raw: lines().slice(1, -1).join('\n'), ok: true };
    const raw = lines().slice(1).join('\n');
    ch.write('\x03'); // Ctrl-C, so a hung command does not spill into the next one
    await prompt(TIMEOUT);
    return { raw, ok: false };
  };
  const live = () => open && c === conn;
  let run; // the run being recorded
  let alarms; // the active alarm ids last seen
  let changed = false; // a poll saw them change
  const last = {}; // command → when it last ran

  /** Runs `cmd`, records it in the run as `source` (prereq, snapshot or poll), and keeps its result for /bridge/state. */
  const take = async (cmd, source) => {
    const at = (last[cmd] = Date.now());
    const { raw, ok } = await output(cmd);
    const { template, data = null, error } = source === 'poll' ? await run.poll(cmd, at, raw) : await run.record(cmd, at, raw, ok, source);
    if (c === conn) polled[cmd] = { at, raw, ...(ok ? (error ? { error } : { data }) : { error: `no prompt within ${TIMEOUT / 1000} s` }) };
    if (template !== ALARMS || !data) return;
    const ids = Object.keys(data.alarms ?? {}).sort().join(' ');
    if (source === 'poll' && alarms !== undefined && ids !== alarms) changed = true;
    alarms = ids;
  };
  /** A new run: the prerequisites if the session just opened, then every command once. False if a prerequisite failed. */
  const snapshot = async (trigger) => {
    run = new Run(trigger, host);
    for (const cmd of trigger === 'connect' ? PREREQS : []) if (live()) await take(cmd, 'prereq');
    if (run.meta.prereqs.some((p) => !p.ok)) return false;
    for (const { cmd } of POLLS) if (live()) await take(cmd, 'snapshot');
    console.log(`recorded ${run.dir}`);
    return true;
  };

  if (INIT.length) ch.write(INIT.map((cmd) => cmd + '\n').join(''));
  await prompt(TIMEOUT, 2000); // logged in and through INIT
  // Paging left on could cut any output short, so after a failed prerequisite nothing more is recorded or polled.
  if (!(await snapshot('connect'))) return console.log(`a prerequisite failed on ${host}, so it is not polled: see ${run.dir}/meta.json`);
  while (live()) {
    if (changed) {
      changed = false;
      await snapshot('alarms');
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

const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

const server = createServer(async (req, res) => {
  // Only the app, through Vite's proxy. Browsers send a custom header from another site only after a preflight, which
  // fails here (no CORS), and the Host check stops DNS rebinding. Without it, any web page could pick the box the
  // password goes to.
  if (req.headers['x-ols-tracer'] !== '1' || !LOCAL.test(req.headers.host ?? '')) return res.writeHead(403).end();
  if (req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ state, host, error }));
  }
  // While connected, what the poller read this session; otherwise the last state on disk, so the view still has values.
  if (req.url === '/state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(state === 'connected' ? { live: true, commands: polled } : { live: false, ...(latest() ?? { run: null, commands: {} }) }));
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
  res.writeHead(404).end();
});

// A terminal attaches. A browser cannot add the header to a WebSocket, but always sends the page's Origin, which a page
// cannot fake: only a page served from the host it connects to (the app, through Vite's proxy) gets a terminal.
// Without it, any web page could type commands on the box.
server.on('upgrade', (req, socket, head) => {
  const { host: to = '', origin = '' } = req.headers;
  if (req.url !== '/term' || !LOCAL.test(to) || origin.replace(/^https?:\/\//, '') !== to) return socket.destroy();
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
      } else if (typeof msg.d === 'string') shell?.write(msg.d);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`bridge on http://127.0.0.1:${PORT}: connect to a box from its physical view`));

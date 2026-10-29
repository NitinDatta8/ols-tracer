// CLI bridge: keeps one SSH session open to the box the physical view connects to, and runs its commands on it.
// A browser cannot speak SSH, so the app posts the box's IP to /bridge/connect, a command to /bridge/run (and gets the
// box's output streamed back) and /bridge/disconnect when the view closes.
// Login settings come from bridge/.env (see .env.example). Listens on localhost only.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import ssh2 from 'ssh2';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 8022);
/** The box's prompt at the end of the output: the command is done. Default: a name ending in #, > or $, or (kgdb), on its own line. */
const PROMPT = new RegExp(env.BOX_PROMPT ?? '\\n([\\w.@:/~()-]+ ?[#>$]|\\(kgdb\\)) ?$');
const TIMEOUT = Number(env.BOX_TIMEOUT ?? 30) * 1000;
/** Run once after login, e.g. to turn paging off; separated by ";". */
const INIT = (env.BOX_INIT ?? '').split(';').map((c) => c.trim()).filter(Boolean);

let host = ''; // the box asked for, '' once disconnected
let conn = null; // its SSH connection
let state = 'down'; // connecting | connected | down
let error = '';
let shell = null;
let logins = 0; // counts logins: each new session starts in the CLI's normal mode
let retry;
let queue = Promise.resolve();

/** Terminal colours and carriage returns out. */
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

/** Waits until the shell's output ends in the prompt (true) or the shell is lost (false), passing the output on to `write`. */
const untilPrompt = (ch, write) => new Promise((resolve) => {
  let tail = '\n';
  const done = (ok, note = '') => { clearTimeout(timer); ch.off('data', onData).off('close', onClose); write(note); resolve(ok); };
  const onClose = () => done(false, '\n[session closed]\n');
  const onData = (d) => {
    const s = clean(d.toString());
    tail = (tail + s).slice(-500);
    write(s);
    if (PROMPT.test(tail)) done(true);
  };
  // No prompt in time: Ctrl-C, then wait for the prompt once more, so nothing spills into the next command.
  // Still none: the shell is closed, and with it the session, which then opens again.
  let timer = setTimeout(() => {
    write(`\n[no prompt after ${TIMEOUT / 1000} s: sent Ctrl-C]\n`);
    ch.write('\x03');
    timer = setTimeout(() => { done(false, '\n[still no prompt: opening the session again]\n'); ch.close(); }, TIMEOUT);
  }, TIMEOUT);
  ch.on('data', onData).once('close', onClose);
});

/** Runs one command on the box, one at a time. */
const run = (command, write) => {
  const job = queue.then(async () => {
    if (!shell) return write(`Box not connected${error ? `: ${error}` : ''}\n`);
    const done = untilPrompt(shell, write);
    shell.write(command + '\n');
    await done;
  });
  queue = job.catch(() => {}); // one failed command does not stop the next
  return job;
};

/** Opens the session to `host`, and opens it again with backoff whenever it drops, until disconnect(). */
function connect(delay = 1000) {
  state = 'connecting';
  const c = (conn = new ssh2.Client());
  c
    .on('ready', () => c.shell({ term: 'vt100', cols: 250, rows: 1000 }, async (err, ch) => {
      if (err) return c.end();
      ch.on('close', () => c.end());
      // Login banner, then the first prompt.
      if (!(await untilPrompt(ch, () => {}))) return void (error ||= 'No prompt after login: check BOX_PROMPT');
      if (c !== conn) return;
      shell = ch;
      for (const cmd of INIT) await run(cmd, () => {});
      state = 'connected';
      error = '';
      delay = 1000;
      logins++;
      console.log(`connected to ${host}`);
    }))
    // RADIUS or TACACS+ logins usually come as keyboard-interactive: answer every prompt with the password.
    .on('keyboard-interactive', (_name, _info, _lang, prompts, finish) => finish(prompts.map(() => env.BOX_PASSWORD ?? '')))
    .on('error', (e) => { error = e.message; })
    .on('close', () => {
      if (c !== conn) return; // disconnected, or replaced by a session to another box
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
  c?.end();
}

const body = async (req) => {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s.trim();
};

createServer(async (req, res) => {
  // Only the app, through Vite's proxy. Browsers send a custom header from another site only after a preflight, which
  // fails here (no CORS), and the Host check stops DNS rebinding. Without it, any web page could pick the box the
  // password goes to, or run commands.
  if (req.headers['x-ols-tracer'] !== '1' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) {
    return res.writeHead(403).end();
  }
  if (req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ state, host, error, logins }));
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
  if (req.url === '/run' && req.method === 'POST') {
    const command = await body(req);
    // One line only: a newline would slip a second command in.
    if (!command || /[\r\n]/.test(command)) return res.writeHead(400).end('One command, on one line\n');
    if (!shell) return res.writeHead(409).end(`Box not connected${error ? `: ${error}` : ''}\n`);
    console.log(`${new Date().toISOString()} run: ${command}`);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    await run(command, (s) => res.write(s));
    return res.end();
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`bridge on http://127.0.0.1:${PORT}: connect to a box from its physical view`));

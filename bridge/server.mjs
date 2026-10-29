// CLI bridge: keeps one SSH session open to the box the physical view connects to, and gives the view a terminal on it.
// A browser cannot speak SSH, so the app posts the box's IP to /bridge/connect, attaches its terminal (xterm.js) to the
// session's shell over a WebSocket at /bridge/term, and posts /bridge/disconnect when the view closes. The shell gets
// keystrokes as they are typed, so the box's own Tab completion, history, Ctrl-C and modes work as they do over ssh.
// Login settings come from bridge/.env (see .env.example). Listens on localhost only.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import ssh2 from 'ssh2';
import { WebSocketServer } from 'ws';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 8022);
/** Run once after login, e.g. to start the CLI; separated by ";". */
const INIT = (env.BOX_INIT ?? '').split(';').map((c) => c.trim()).filter(Boolean);
/** How much of the session a terminal that attaches is shown again, in bytes. */
const LOG = 256 * 1024;

let host = ''; // the box asked for, '' once disconnected
let conn = null; // its SSH connection
let state = 'down'; // connecting | connected | down
let error = '';
let shell = null;
let size = { cols: 120, rows: 30 }; // the terminal's, which the box wraps and pages its output to
let log = Buffer.alloc(0); // the session's output so far (its last LOG bytes)
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
    .on('ready', () => c.shell({ term: 'xterm-256color', ...size }, (err, ch) => {
      if (err || c !== conn) return c.end();
      shell = ch;
      ch.on('data', out).on('close', () => c.end());
      // Typed ahead: the box reads them once its shell is up.
      if (INIT.length) ch.write(INIT.map((cmd) => cmd + '\n').join(''));
      state = 'connected';
      error = '';
      delay = 1000;
      console.log(`connected to ${host}`);
    }))
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
  c?.end();
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

// Terminal windows (the app's right-click → Open terminal, Telnet, Engineering mode): each is a shell of its own on the
// box, on one SSH connection per box shared by its windows, apart from the physical view's session and the poller's.
// The steps that put it in its mode are typed in first, each once the prompt is back.
import ssh2 from 'ssh2';

/** Steps a window may ask for: up to 10 lines of printable text, so none can slip in a second command. */
export const validSteps = (steps) => Array.isArray(steps) && steps.length <= 10
  && steps.every((s) => typeof s === 'string' && s.length <= 200 && !/[\x00-\x1f\x7f]/.test(s));

/**
 * Types `steps` into shell `ch`, one line each, each once the last line of output matches `prompt` and nothing more
 * comes for `settle` ms: the first after login (`login` ms at most, quiet for `loginQuiet` ms, for banners), the others
 * within `timeout` ms. Resolves with how many were typed, and `stuck`, the step whose prompt never came, if one did not:
 * the rest is left to the user. Nothing is typed after the last step, so a telnet's login prompt is the user's.
 */
export async function typeSteps(ch, steps, { prompt: PROMPT, timeout, settle, login = timeout, loginQuiet = settle }) {
  let buf = '';
  let closed = false;
  let wake = () => {};
  const onData = (d) => { buf += d; wake(); };
  const onClose = () => { closed = true; wake(); };
  ch.on('data', onData).on('close', onClose);
  const last = () => buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').at(-1);
  const prompted = (ms, quietMs) => new Promise((done) => {
    let quiet;
    const give = setTimeout(() => done(false), ms);
    wake = () => {
      clearTimeout(quiet);
      if (closed) { clearTimeout(give); return done(false); }
      if (PROMPT.test(last())) quiet = setTimeout(() => { clearTimeout(give); done(true); }, quietMs);
    };
    wake();
  });
  try {
    for (const [i, step] of steps.entries()) {
      if (!(await prompted(i ? timeout : login, i ? settle : loginQuiet))) return { typed: i, stuck: step };
      buf = '';
      ch.write(step + '\r');
    }
    return { typed: steps.length };
  } finally {
    wake = () => {};
    ch.removeListener('data', onData).removeListener('close', onClose);
  }
}

/**
 * One SSH connection per box for its terminal windows: opened with the first window, closed with the last.
 * `options(host)` is ssh2's connect config; a keyboard-interactive login (RADIUS, TACACS+) gets `password` at every prompt.
 */
export class Logins {
  constructor(options, { password = '', Client = ssh2.Client } = {}) {
    Object.assign(this, { options, password, Client, boxes: new Map() });
  }

  /** The connection to `host`, once it is up; call release(host) when the window closes, whether it came up or not. */
  open(host) {
    let box = this.boxes.get(host);
    if (!box) {
      const c = new this.Client();
      const ready = new Promise((ok, fail) => {
        c.on('ready', () => ok(c))
          .on('error', fail)
          .on('close', () => {
            if (this.boxes.get(host) === box) this.boxes.delete(host);
            fail(new Error('connection closed'));
          })
          .on('keyboard-interactive', (_name, _info, _lang, prompts, finish) => finish(prompts.map(() => this.password)));
      });
      ready.catch(() => {}); // each window waiting on it reports it
      box = { c, ready, users: 0 };
      this.boxes.set(host, box);
      c.connect(this.options(host));
    }
    box.users++;
    return box.ready;
  }

  /** One window fewer on `host`; the last one closes the connection. */
  release(host) {
    const box = this.boxes.get(host);
    if (!box || --box.users > 0) return;
    this.boxes.delete(host);
    box.c.end();
  }
}

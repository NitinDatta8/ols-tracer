// A fake of ssh2 for the bridge's tests (lab.mjs): its Client never opens a socket. connect() finds its box in `boxes`
// by the host it is given, a made-up name such as box-1.test, and the box's shells echo each line, answer it and show
// the prompt, as box 3's CLI does. A test swaps it in with vi.mock('ssh2', ...), so a session the bridge opens there
// never leaves the test process and nothing can reach a real box.
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The fake boxes, by host. */
export const boxes = new Map();

/** The CSP release a fake box runs, as `show software` prints it: its stream's CLI index is csp's. */
export const RELEASE = 'CSP-2.10.100.10_20261013';

/**
 * A fake box at `host`, named `hostname` (show system). `answers` maps a command to its output, a string or a function
 * of the command, else it prints None. Each answer comes `delay` ms after the Enter. A command in `hang` is never
 * answered until Ctrl-C. `refuse` fails every login with that error, and `password` asks for it keyboard-interactive,
 * as a RADIUS login does. A shell shows its first prompt `welcome` ms after it opens. It keeps every line typed into
 * it (`typed`), its open `connections` and `shells`, how many Ctrl-Cs it got (`interrupts`), and how often a poller
 * typed a line before the last one was answered (`overlaps`).
 */
export function fakeBox(host, { hostname = host.split('.')[0].toUpperCase(), answers = {}, delay = 2, hang = [], refuse, password, welcome = 1 } = {}) {
  const box = {
    host, hostname, answers, delay, hang: new Set(hang), refuse, password, welcome,
    typed: [], connections: new Set(), shells: new Set(), logins: 0, interrupts: 0, overlaps: 0,
    /** What the box prints for `cmd`. */
    answer(cmd) {
      const a = box.answers[cmd];
      if (a !== undefined) return typeof a === 'function' ? a(cmd) : a;
      if (cmd === 'show system') return `hostname ${box.hostname}\nlocation lab`;
      if (cmd === 'show software') return `active ${RELEASE}`;
      return 'None';
    },
    /** Drops every connection to the box, as a reboot or a cable pulled does. */
    drop(why = 'read ECONNRESET') { for (const c of [...box.connections]) c.drop(why); },
    /** The lines typed into it that are `cmd`. */
    count(cmd) { return box.typed.filter((t) => t === cmd).length; },
  };
  boxes.set(host, box);
  return box;
}

/** A shell on a fake box: it echoes what is typed, and answers each line once Enter comes, with the prompt after. */
class Shell extends EventEmitter {
  constructor(box, { term = 'xterm', cols = 80, rows = 24 } = {}) {
    super();
    Object.assign(this, { box, term, size: { cols, rows }, mode: '>', line: '', open: true, timers: new Set(), answering: 0 });
    box.shells.add(this);
    this.later(() => this.say(`Welcome to ${box.hostname}\r\n${this.prompt()}`), box.welcome);
  }

  prompt() { return `admin@${this.box.hostname}${this.mode} `; }

  /** Output, as it comes over SSH: a moment after what caused it, in order. */
  say(text) { setImmediate(() => { if (this.open) this.emit('data', Buffer.from(text)); }); }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  write(d) {
    for (const ch of String(d)) {
      if (ch === '\x03') {
        for (const t of this.timers) clearTimeout(t);
        this.timers.clear();
        this.box.interrupts++;
        this.answering = 0;
        this.line = '';
        this.say(`^C\r\n${this.prompt()}`);
      } else if (ch === '\r' || ch === '\n') this.enter();
      else if (ch === '\x7f' || ch === '\b') {
        if (this.line) this.say('\b \b');
        this.line = this.line.slice(0, -1);
      } else {
        this.line += ch;
        this.say(ch);
      }
    }
    return true;
  }

  enter() {
    const cmd = this.line.trim().replace(/\s+/g, ' ');
    this.line = '';
    this.say('\r\n');
    if (!cmd) return this.say(this.prompt());
    this.box.typed.push(cmd);
    if (this.answering && this.term === 'dumb') this.box.overlaps++;
    this.answering++;
    if (this.box.hang.has(cmd)) return;
    if (cmd === 'configure') this.mode = '#';
    else if (cmd === 'exit') this.mode = '>';
    const out = String(this.box.answer(cmd) ?? '');
    this.later(() => {
      this.answering--;
      this.say(`${out ? `${out.replace(/\r?\n/g, '\r\n')}\r\n` : ''}${this.prompt()}`);
    }, this.box.delay);
  }

  setWindow(rows, cols) { this.size = { rows, cols }; }

  close() {
    if (!this.open) return;
    this.open = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.box.shells.delete(this);
    this.emit('close');
  }

  end() { this.close(); }
}

/** ssh2's Client, as the bridge uses it: connect, ready, keyboard-interactive, shell, error, end and close. */
export class Client extends EventEmitter {
  constructor() {
    super();
    Object.assign(this, { box: null, ended: false, shells: new Set() });
  }

  connect(opts) {
    this.opts = opts;
    setTimeout(() => {
      const box = boxes.get(opts.host);
      if (!box) return this.fail(`getaddrinfo ENOTFOUND ${opts.host}`);
      box.logins++;
      if (box.refuse) return this.fail(box.refuse);
      const ready = () => {
        if (this.ended) return;
        this.box = box;
        box.connections.add(this);
        this.emit('ready');
      };
      if (!box.password) return ready();
      if (!opts.tryKeyboard || !this.listenerCount('keyboard-interactive')) return this.fail('All configured authentication methods failed');
      this.emit('keyboard-interactive', '', '', '', [{ prompt: 'Password: ', echo: false }], (answers) => {
        if (answers?.[0] === box.password) ready();
        else this.fail('All configured authentication methods failed');
      });
    }, 1);
    return this;
  }

  shell(opts, cb) {
    setTimeout(() => {
      if (!this.box || this.ended) return cb(new Error('Not connected'));
      const sh = new Shell(this.box, opts);
      this.shells.add(sh);
      sh.on('close', () => this.shells.delete(sh));
      cb(undefined, sh);
    }, 1);
    return this;
  }

  fail(why) {
    this.emit('error', new Error(why));
    this.end();
  }

  /** The box drops the connection: an error, then its shells and the connection close. */
  drop(why) { this.fail(why); }

  end() {
    if (this.ended) return this;
    this.ended = true;
    for (const sh of [...this.shells]) sh.close();
    this.box?.connections.delete(this);
    setImmediate(() => this.emit('close'));
    return this;
  }
}

/**
 * A stand-in for the bridge's Python in `dir`: it prints what it is given, so a command whose answer is JSON parses as
 * that JSON, with no TTP. `templates` are the command ids it parses: each gets an empty template under `root`/ttp, where
 * the recorder looks for them. Returns its path, for PYTHON.
 */
export function fakePython(dir, root, templates = []) {
  mkdirSync(join(root, 'ttp', 'templates'), { recursive: true });
  for (const id of templates) writeFileSync(join(root, 'ttp', 'templates', `${id}.ttp`), '');
  const python = join(dir, 'python');
  writeFileSync(python, '#!/bin/sh\nexec cat\n');
  chmodSync(python, 0o755);
  return python;
}

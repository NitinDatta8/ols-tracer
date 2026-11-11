import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Logins, typeSteps, validSteps } from '../../bridge/terminals.mjs';

const OPTS = { prompt: /[#>$] ?$/, timeout: 200, settle: 20 };

/**
 * A shell like the box's: it echoes each line, then after `delay` ms shows the prompt of the mode it moved to
 * (configure → #, ^^^ → (eng)#, bash → $), or nothing at all for a line in `hang`.
 */
function fakeShell({ delay = 15, hang = [] } = {}) {
  const ch = new EventEmitter();
  ch.typed = [];
  let prompt = 'admin@BOX> ';
  const next = { configure: 'admin@BOX# ', '^^^': 'admin@BOX(eng)# ', bash: 'root@CU:~# ' };
  ch.write = (d) => {
    const line = d.replace(/\r$/, '');
    ch.typed.push(d);
    ch.emit('data', `${line}\r\n`);
    if (hang.includes(line)) return;
    prompt = next[line] ?? prompt;
    setTimeout(() => ch.emit('data', prompt), delay);
  };
  setTimeout(() => ch.emit('data', 'Welcome\r\n'), 1);
  setTimeout(() => ch.emit('data', prompt), 10);
  return ch;
}

describe('typeSteps', () => {
  it('types each step once the prompt is back, ending each with Enter, and nothing after the last', async () => {
    const ch = fakeShell();
    const steps = ['configure', '^^^', 'bash', 'telnet 1.0.1.28'];
    expect(await typeSteps(ch, steps, OPTS)).toEqual({ typed: 4 });
    expect(ch.typed).toEqual(steps.map((s) => s + '\r'));
    expect(ch.listenerCount('data')).toBe(0); // the window's own reader is all that is left
  });

  it('waits for the prompt after login, however slow, before the first step', async () => {
    const ch = new EventEmitter();
    ch.typed = [];
    ch.write = (d) => ch.typed.push(d);
    const done = typeSteps(ch, ['configure'], { ...OPTS, login: 500 });
    setTimeout(() => ch.emit('data', 'Last login: today\r\n'), 50);
    await new Promise((r) => setTimeout(r, 100));
    expect(ch.typed).toEqual([]);
    ch.emit('data', 'admin@BOX> ');
    expect(await done).toEqual({ typed: 1 });
  });

  it('stops at a step whose prompt never comes, and leaves the rest to the user', async () => {
    const ch = fakeShell({ hang: ['^^^'] });
    expect(await typeSteps(ch, ['configure', '^^^', 'bash'], OPTS)).toEqual({ typed: 2, stuck: 'bash' });
    expect(ch.typed).toEqual(['configure\r', '^^^\r']);
  });

  it('stops when the shell closes', async () => {
    const ch = fakeShell({ hang: ['configure'] });
    const done = typeSteps(ch, ['configure', '^^^'], { ...OPTS, timeout: 5000 });
    setTimeout(() => ch.emit('close'), 60);
    expect(await done).toEqual({ typed: 1, stuck: '^^^' });
  });

  it('types nothing for show mode', async () => {
    const ch = fakeShell();
    expect(await typeSteps(ch, [], OPTS)).toEqual({ typed: 0 });
    expect(ch.typed).toEqual([]);
  });
});

it('takes only short lines of printable text as steps', () => {
  expect(validSteps([])).toBe(true);
  expect(validSteps(['configure', '^^^', 'bash', 'telnet 1.0.1.4'])).toBe(true);
  expect(validSteps(['configure\nreboot'])).toBe(false);
  expect(validSteps(['configure\r'])).toBe(false);
  expect(validSteps('configure')).toBe(false);
  expect(validSteps([1])).toBe(false);
  expect(validSteps(Array(11).fill('show card'))).toBe(false);
});

describe('Logins', () => {
  /** An SSH client that comes up at once, or fails with `fail`. */
  const fakeClient = (made, fail) => class extends EventEmitter {
    constructor() { super(); made.push(this); this.ended = false; }
    connect(opts) { this.opts = opts; setTimeout(() => (fail ? this.emit('error', new Error(fail)) : this.emit('ready')), 1); }
    end() { this.ended = true; this.emit('close'); }
  };

  it("shares one connection per box between its windows, and closes it with the last", async () => {
    const made = [];
    const logins = new Logins((host) => ({ host }), { Client: fakeClient(made) });
    const [a, b] = await Promise.all([logins.open('box.test'), logins.open('box.test')]);
    expect(a).toBe(b);
    expect(made.map((c) => c.opts)).toEqual([{ host: 'box.test' }]);
    await logins.open('other.test');
    expect(made).toHaveLength(2);
    logins.release('box.test');
    expect(a.ended).toBe(false);
    logins.release('box.test');
    expect(a.ended).toBe(true);
    await logins.open('box.test');
    expect(made).toHaveLength(3); // a new one for the next window
  });

  it('fails every window waiting on a login that fails, and the next window tries again', async () => {
    const made = [];
    const logins = new Logins((host) => ({ host }), { Client: fakeClient(made, 'All configured authentication methods failed') });
    await expect(logins.open('box.test')).rejects.toThrow('authentication');
    logins.release('box.test');
    await expect(logins.open('box.test')).rejects.toThrow();
    expect(made).toHaveLength(2);
  });

  it('answers a keyboard-interactive login with the password', async () => {
    const made = [];
    const logins = new Logins((host) => ({ host }), { password: 'pw', Client: fakeClient(made) });
    await logins.open('box.test');
    let answers;
    made[0].emit('keyboard-interactive', '', '', '', [{ prompt: 'Password:' }], (a) => { answers = a; });
    expect(answers).toEqual(['pw']);
  });
});

describe('terminal edge cases', () => {
  it('takes a step of up to 200 characters, an empty one as just Enter, and nothing else', () => {
    expect(validSteps(['x'.repeat(200), ''])).toBe(true);
    for (const steps of [['x'.repeat(201)], ['configure\t'], ['configure\x7f'], [null], null, undefined, {}, [['configure']]]) expect(validSteps(steps), JSON.stringify(steps)).toBe(false);
  });

  it('waits for the whole prompt when it comes in pieces, colored or not', async () => {
    const ch = new EventEmitter();
    ch.typed = [];
    ch.write = (d) => ch.typed.push(d);
    const done = typeSteps(ch, ['configure'], { ...OPTS, login: 1000, loginQuiet: 20 });
    ch.emit('data', 'admin@B');
    await new Promise((r) => setTimeout(r, 50));
    expect(ch.typed).toEqual([]);
    ch.emit('data', '\x1b[32mOX>\x1b[0m ');
    expect(await done).toEqual({ typed: 1 });
  });

  it("is harmless to release a box with no window, or a window's box twice", () => {
    const logins = new Logins((host) => ({ host }), { Client: class extends EventEmitter { connect() {} end() {} } });
    expect(() => logins.release('never.test')).not.toThrow();
    logins.open('box.test');
    logins.release('box.test');
    expect(() => logins.release('box.test')).not.toThrow();
    expect(logins.boxes.size).toBe(0);
  });

  it('opens a new connection after the last one closed by itself, and shares one still logging in', async () => {
    const made = [];
    class Slow extends EventEmitter {
      constructor() { super(); made.push(this); }
      connect() { setTimeout(() => this.emit('ready'), 30); }
      end() { this.emit('close'); }
    }
    const logins = new Logins((host) => ({ host }), { Client: Slow });
    const [a, b] = [logins.open('box.test'), logins.open('box.test')];
    expect(made).toHaveLength(1);
    await Promise.all([a, b]);
    made[0].emit('close'); // the box dropped it
    await logins.open('box.test');
    expect(made).toHaveLength(2);
  });

  it('answers every prompt of a keyboard-interactive login with the password', async () => {
    const made = [];
    const logins = new Logins((host) => ({ host }), { password: 'pw', Client: class extends EventEmitter { constructor() { super(); made.push(this); } connect() { setTimeout(() => this.emit('ready'), 1); } end() {} } });
    await logins.open('box.test');
    let answers;
    made[0].emit('keyboard-interactive', '', '', '', [{ prompt: 'Password:' }, { prompt: 'Token:' }], (a) => { answers = a; });
    expect(answers).toEqual(['pw', 'pw']);
  });
});

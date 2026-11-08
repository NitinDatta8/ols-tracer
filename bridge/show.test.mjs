// POST /show's line check and its run on a shell of the session, on a fake shell: no box.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { worker } from './shells.mjs';
import { runShow, showLine } from './show.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const python = process.env.PYTHON ?? here('.venv/bin/python');
const OPTS = { prompt: /[#>$] ?$/, timeout: 200, settle: 20 };
const FIXTURE = here('../data/boxes/box3/ttp/fixtures/cli_shortcut_cmds_l1__och__show__och');

/** A shell like the box's: it echoes a command, then prints its output in `outputs` and the prompt, or for any other nothing. */
function fakeShell(outputs) {
  const ch = new EventEmitter();
  ch.typed = [];
  ch.write = (d) => {
    if (d === '\x03') return void setTimeout(() => ch.emit('data', '^C\r\nadmin@BOX> '), 5);
    const cmd = d.trim();
    ch.typed.push(cmd);
    const out = cmd in outputs ? `${outputs[cmd].replace(/\n/g, '\r\n')}\r\nadmin@BOX> ` : '';
    setTimeout(() => ch.emit('data', `${cmd}\r\n${out}`), 5);
  };
  setTimeout(() => ch.emit('data', 'admin@BOX> '), 1);
  return ch;
}

describe('showLine', () => {
  it('takes a show command the CLI index has, its spaces evened out', () => {
    expect(showLine(' show  och 1-7-5 ')).toEqual({ cmd: 'show och 1-7-5' });
    expect(showLine('show log alarm -l 200')).toEqual({ cmd: 'show log alarm -l 200' });
    expect(showLine('show card 1-* fan')).toEqual({ cmd: 'show card 1-* fan' });
  });

  it('says why it refuses anything else', () => {
    const why = (line) => showLine(line).why;
    expect(why('show alarm | save x')).toMatch(/pipe/);
    expect(why('show och ?')).toMatch(/\?/);
    expect(why('set och 1-7-5 target-output-power 0')).toMatch(/^set is not show/);
    for (const line of ['delete media-channel 2', 'commit', 'rpc reboot ne cold', 'reboot ne cold', 'clear alarm']) expect(why(line)).toMatch(/is not show/);
    expect(why('show flux-capacitor')).toMatch(/not a show command in the CLI index/);
    expect(why('show och 1-7-5 extra')).toMatch(/not a show command in the CLI index/);
    expect(why('show card\nreboot ne cold')).toMatch(/one line/);
    expect(why('show card\x15reboot ne cold')).toMatch(/one line/); // Ctrl-U would rub the line out on the box
    expect(why('')).toMatch(/an empty line is not show/);
  });
});

describe('runShow', () => {
  it.skipIf(!existsSync(python))("answers a show's output, as the box printed it, and its parse (needs npm run bridge:setup)", async () => {
    const raw = readFileSync(`${FIXTURE}.txt`, 'utf8').replace(/\n$/, '');
    const ch = fakeShell({ 'show och 1-7-5': raw });
    const w = worker(ch, OPTS);
    await w.prompt(300);
    const got = await runShow(w, 'show och 1-7-5');
    expect(got).toMatchObject({ cmd: 'show och 1-7-5', ok: true, raw, template: 'cli_shortcut_cmds_l1__och__show__och' });
    expect(got.data).toEqual(JSON.parse(readFileSync(`${FIXTURE}.json`, 'utf8')));
    expect(typeof got.at).toBe('number');
    expect(ch.typed).toEqual(['show och 1-7-5']);
  });

  it('answers a show whose prompt never comes as not ok, with no parse, and the shell gets a Ctrl-C', async () => {
    const ch = fakeShell({});
    const w = worker(ch, OPTS);
    await w.prompt(300);
    const got = await runShow(w, 'show alarm');
    expect(got).toMatchObject({ cmd: 'show alarm', ok: false });
    expect(got).not.toHaveProperty('data');
    expect(await w.prompt(300)).toBe(true);
  });
});

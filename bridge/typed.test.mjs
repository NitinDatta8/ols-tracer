// Typed commands are read back from the terminal's screen as the box left the line: after Tab completion, backspaces
// and wrapping, and only for `show` at the operational prompt.
import { describe, expect, it } from 'vitest';
import { Screen, typedShow } from './typed.mjs';

const PROMPT = 'admin@PAHO-GS2000-03> ';

/** A screen of `cols` columns, the commands it read, and a way to wait until everything written is on it. */
function screen(cols = 80) {
  const shown = [];
  const s = new Screen({ cols, rows: 24 }, (cmd) => shown.push(cmd));
  const settled = () => new Promise((done) => s.term.write('', done));
  return { s, shown, settled };
}

describe('typedShow', () => {
  it('takes show commands at the operational prompt only', () => {
    expect(typedShow(`${PROMPT}show  och 1-7-5 `)).toBe('show och 1-7-5');
    expect(typedShow(`${PROMPT}show`)).toBe('show');
    expect(typedShow('admin@PAHO-GS2000-03# show och 1-7-5')).toBeNull(); // configure mode
    expect(typedShow(`${PROMPT}set cli length 0`)).toBeNull();
    expect(typedShow(`${PROMPT}showx`)).toBeNull();
    expect(typedShow(`${PROMPT}show och ?`)).toBeNull();
    expect(typedShow(`${PROMPT}show log alarm | save x`)).toBeNull();
    expect(typedShow('show och 1-7-5')).toBeNull(); // output, not a prompt line
  });
});

describe('Screen', () => {
  it('reads the line after Tab completion and backspaces', async () => {
    const { s, shown, settled } = screen();
    s.write(PROMPT);
    s.write('sh');
    s.write('ow '); // the box completes "sh" on Tab
    s.write('och 1-7-6\b \b5'); // a typo, rubbed out
    s.enter();
    await settled();
    expect(shown).toEqual([]); // the box hasn't echoed the Enter yet
    s.write(`\r\nname 1-7-5\r\n${PROMPT}`);
    await settled();
    expect(shown).toEqual(['show och 1-7-5']);
  });

  it('reads a Run button command that the box echoes after the Enter is sent', async () => {
    const { s, shown, settled } = screen();
    s.write(PROMPT);
    s.enter();
    s.write(`show port\r\nport 1-7-4\r\n${PROMPT}`);
    await settled();
    expect(shown).toEqual(['show port']);
  });

  it('joins a command that wraps at the terminal width', async () => {
    const { s, shown, settled } = screen(20);
    s.write(PROMPT);
    s.enter();
    s.write('show transceiver 1-7-4 physical-channel 1');
    await settled();
    expect(shown).toEqual([]); // wrapped onto new lines, but no Enter echoed yet
    s.write(`\r\n${PROMPT}`);
    await settled();
    expect(shown).toEqual(['show transceiver 1-7-4 physical-channel 1']);
  });

  it('skips other commands and other modes', async () => {
    const { s, shown, settled } = screen();
    for (const line of ['configure', 'show running-config', 'exit', 'set cli width 80', '']) {
      s.write(line === 'show running-config' ? 'admin@PAHO-GS2000-03# ' : PROMPT);
      s.write(line);
      s.enter();
      s.write('\r\n');
    }
    s.write(PROMPT);
    await settled();
    expect(shown).toEqual([]);
  });
});

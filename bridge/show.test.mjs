// POST /show's line check: no box.
import { describe, expect, it } from 'vitest';
import { showLine } from './show.mjs';

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

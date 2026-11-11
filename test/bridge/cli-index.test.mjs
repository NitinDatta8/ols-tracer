// commandFor: which CLI index command a typed line runs, on a small index of its own, and csp's index against what
// the poller runs and the templates it parses with.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandFor } from '../../bridge/cli-index.mjs';

const index = [
  { commandId: 'och', op: 'show', syntax: 'show och <name>' },
  { commandId: 'och-frequency', op: 'show', syntax: 'show och <name> frequency' },
  { commandId: 'port', op: 'show', syntax: 'show port <name>' },
  { commandId: 'port-all', op: 'show', syntax: 'show port all' },
  { commandId: 'log-alarm', op: 'show', syntax: 'show log alarm' },
  { commandId: 'reboot', op: 'rpc', syntax: 'rpc reboot ne <type>' },
  { commandId: 'mc-admin', op: 'set', syntax: 'set media-channel <index> admin-state <value>' },
];
const id = (line, cmds = index) => commandFor(cmds, line)?.commandId ?? null;

describe('commandFor', () => {
  it('matches the syntax word for word, a <key> taking any one word, however the line is spaced', () => {
    expect(id('show log alarm')).toBe('log-alarm');
    expect(id('show och 1-7-5')).toBe('och');
    expect(id('show och 1-7-5 frequency')).toBe('och-frequency');
    expect(id('  show   och\t1-7-5  ')).toBe('och');
  });

  it("lets a list's last key be left out, and nothing else", () => {
    expect(id('show och')).toBe('och');
    expect(id('show och frequency')).toBe('och'); // the och named frequency
    expect(id('show')).toBeNull();
    expect(id('show log')).toBeNull();
    expect(id('set media-channel 2')).toBeNull();
    // A set's value too: check_commands matches a set line exactly, so it refuses this one.
    expect(id('set media-channel 2 admin-state')).toBe('mc-admin');
  });

  it('takes options after the command, never another word', () => {
    expect(id('show log alarm -l 200')).toBe('log-alarm');
    expect(id('show och 1-7-5 -x 2')).toBe('och');
    expect(id('show log alarm extra')).toBeNull();
    expect(id('show och 1-7-5 typo')).toBeNull();
    expect(id('show och 1-7-5 frequency now')).toBeNull();
  });

  it('picks the match with the most literal words, wherever it is in the index', () => {
    expect(id('show port all')).toBe('port-all');
    expect(id('show port all', [...index].reverse())).toBe('port-all');
    expect(id('show port 1-7-4')).toBe('port');
  });

  it('takes an rpc typed with or without its rpc', () => {
    expect(id('reboot ne cold')).toBe('reboot');
    expect(id('rpc reboot ne cold')).toBe('reboot');
    expect(id('reboot ne')).toBe('reboot');
    expect(id('rpc reboot')).toBeNull();
  });

  it('matches nothing for a typo or an empty line', () => {
    for (const line of ['shwo och 1-7-5', 'show ochs 1-7-5', '', '   ', 'SHOW och 1-7-5']) expect(id(line), JSON.stringify(line)).toBeNull();
  });
});

describe("csp's CLI index", () => {
  const { commands } = JSON.parse(readFileSync(new URL('../../data/cli/csp/cli-index.source.json', import.meta.url), 'utf8'));
  const poll = JSON.parse(readFileSync(new URL('../../bridge/poll.json', import.meta.url), 'utf8'));

  it('has its commands once each', () => {
    expect(new Set(commands.map((c) => c.commandId)).size).toBe(commands.length);
    expect(commands.every((c) => ['show', 'set', 'delete', 'rpc'].includes(c.op) && c.syntax.split(' ')[c.op === 'rpc' ? 1 : 0])).toBe(true);
  });

  it('has every command the poller runs, each show a show, so each finds its template', () => {
    const cmds = poll.commands.map((p) => p.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
    expect(cmds.filter((c) => !commandFor(commands, c) && !/^help( |$)/.test(c))).toEqual([]);
    expect(cmds.filter((c) => c.startsWith('show ') && commandFor(commands, c).op !== 'show')).toEqual([]);
    expect(poll.commands.filter((p) => !(Number.isInteger(p.every) && p.every >= 0))).toEqual([]);
    expect(poll.prereqs.map((c) => commandFor(commands, c)?.op ?? null)).toEqual([null, 'set', 'set', null]); // configure and exit are the CLI's own
  });

  it('names every TTP template of every box, but the parts they extend', () => {
    const ids = new Set(commands.map((c) => c.commandId));
    const boxes = new URL('../../data/boxes/', import.meta.url);
    for (const box of readdirSync(boxes)) {
      const dir = new URL(`${box}/ttp/templates/`, boxes);
      if (!existsSync(dir)) continue;
      const names = readdirSync(dir).filter((f) => f.endsWith('.ttp')).map((f) => f.slice(0, -4));
      expect(names.filter((n) => !n.startsWith('_') && !ids.has(n)), box).toEqual([]);
    }
  });
});

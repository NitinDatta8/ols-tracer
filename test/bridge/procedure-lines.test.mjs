// Every line a procedure types is one the box takes (docs/procedures-plan.md#4-mcp): a show, set or delete line is a
// command of the CLI index, a set or delete with no word left out; an rpc line starts with an index rpc, and since the
// index lists most rpcs without their arguments, its shape was typed on some box (a history.jsonl), each value of an
// enum param too. The checks' shows count as lines. Shown to catch made-up lines on procedures of the test's own, then
// run on the catalog's. First fillsStep, which matches a line against a step.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandFor, rpcOf } from '../../bridge/cli-index.mjs';
import { fillsStep } from '../../bridge/fill.mjs';
import { CHECKS, definitions, planOf } from '../../bridge/procedures.mjs';

const { commands } = JSON.parse(readFileSync(new URL('../../data/cli/csp/cli-index.source.json', import.meta.url), 'utf8'));
const BOXES = new URL('../../data/boxes/', import.meta.url);
/** Every rpc line typed on a box, from each box's config log. */
const sent = readdirSync(BOXES).flatMap((box) => {
  const f = new URL(`${box}/history.jsonl`, BOXES);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'config' && e.type === 'rpc').map((e) => e.details);
});

/** Each way `def` can be asked for, as far as its lines go: each value of each enum param, a pattern's left as its placeholder. */
const asked = (def) => Object.entries(def.params ?? {})
  .reduce((sets, [name, spec]) => sets.flatMap((s) => (spec.enum ?? [`{${name}}`]).map((v) => ({ ...s, [name]: v }))), [{}]);

/** Why the box wouldn't take `line`, a line of a procedure whose params are `specs`, or null when it would. */
function lineProblem(line, specs) {
  if (line === null) return 'a placeholder times a number, on a pattern param: not checked';
  const words = line.trim().split(/\s+/);
  if (['show', 'set', 'delete'].includes(words[0])) {
    const c = commandFor(commands, line);
    if (c?.op !== words[0]) return `not a ${words[0]} command in the CLI index`;
    if (words[0] !== 'show' && c.syntax.split(' ').length !== words.length) return `a word left out: the CLI index's is ${c.syntax}`;
    return null;
  }
  if (!rpcOf(commands, line)) return 'starts with no rpc of the CLI index';
  return sent.some((t) => fillsStep(line, specs, t)) ? null : 'no box was sent a line of its shape (history.jsonl)';
}

/** What is wrong with the lines `def` types, each as `line: why`: its steps, its restore and its checks' shows. */
function problems(def) {
  const out = new Set();
  for (const params of asked(def)) {
    const plan = planOf(def, params);
    const lines = [...plan.pre.flatMap((c) => c.shows), ...plan.steps.flatMap((s) => ('send' in s ? [s.send] : s.shows)), ...(plan.verify?.shows ?? []), ...plan.restore];
    for (const line of lines) {
      const why = lineProblem(line, def.params ?? {});
      if (why) out.add(`${line}: ${why}`);
    }
  }
  return [...out];
}

describe('fillsStep', () => {
  const specs = { card: { pattern: '\\d+-\\d+' }, mode: { enum: ['cold', 'warm'] }, slot: { pattern: '\\d' } };

  it('takes a line that is the step filled in, each placeholder one word its param takes', () => {
    expect(fillsStep('reboot card {card} {mode}', specs, 'reboot card 1-6 cold')).toBe(true);
    expect(fillsStep('reboot card {card} {mode}', specs, 'reboot card 1-16 warm')).toBe(true);
    expect(fillsStep('show och {card}-5', specs, 'show och 1-7-5')).toBe(true); // in a word, up to the text after it
    expect(fillsStep('telnet 1.0.1.{slot*4}', specs, 'telnet 1.0.1.28')).toBe(true);
    expect(fillsStep('save configuration', {}, 'save configuration')).toBe(true);
  });

  it('refuses any other line: another value, a word more or less, other spacing or case', () => {
    for (const line of ['reboot card 1-6 hot', 'reboot card 1-6', 'reboot card 1-6 cold now', 'reboot card 1-6 cold ', 'reboot  card 1-6 cold',
      'Reboot card 1-6 cold', 'reboot card x cold', 'reboot card 1-6;reboot cold', 'reboot card 1-6 cold\nreboot ne cold', '']) {
      expect(fillsStep('reboot card {card} {mode}', specs, line), JSON.stringify(line)).toBe(false);
    }
    expect(fillsStep('telnet 1.0.1.{slot*4}', specs, 'telnet 1.0.1.30')).toBe(false); // not a value times 4
    expect(fillsStep('telnet 1.0.1.{slot*4}', specs, 'telnet 1.0.1.40')).toBe(false); // 10 times 4, and 10 isn't one digit
    expect(fillsStep('show {constructor}', specs, 'show x')).toBe(false); // not a param
  });
});

describe('the lines a procedure types', () => {
  CHECKS.cards = { shows: ({ card }) => [card ? `show card ${card}` : 'show card'], test: () => ({ ok: true }) };
  CHECKS.flux = { shows: () => ['show flux-capacitor'], test: () => ({ ok: true }) };
  const def = (id, steps, more = {}) => ({ id, label: id, level: 'chassis', tier: 'change', steps, ...more });
  const card = { pattern: '\\d+-\\d+' };
  const mode = { enum: ['cold', 'warm'] };
  const port = { pattern: '\\d+-\\d+-\\w+' };

  it('pass when the CLI index has them, and an rpc line has the shape of one sent to a box', () => {
    const good = [
      def('reboot-ne', [{ send: 'reboot ne {mode}', drops: true, timeout: 360 }, { wait: 'cards', timeout: 360 }], { params: { mode }, verify: 'cards' }),
      def('reboot-card', [{ send: 'reboot card {card} {mode}' }, { wait: 'cards', every: 5, timeout: 180 }], { params: { card, mode } }),
      def('upgrade', [{ send: 'download sw-image path {path} file-name {file}' }, { send: 'activate candidate-sw-image', drops: true }, { wait: 'cards', timeout: 1800 }],
        { params: { path: { pattern: 'sftp://\\S+' }, file: { pattern: 'Release_\\S+\\.tar' } } }),
      def('trim', [{ send: 'set och {port} target-output-power {dbm}' }, { send: 'save configuration' }], { params: { port, dbm: { pattern: '-?\\d+' } } }),
      def('drop-channel', [{ send: 'delete media-channel {index}' }], { params: { index: { pattern: '\\d+' } } }),
      def('look', [{ send: 'show software' }, { send: 'show card {card}' }], { tier: 'read', params: { card }, pre: ['cards'] }),
    ];
    for (const d of good) expect(problems(d), d.id).toEqual([]);
  });

  it('catch a made-up line, a word left out, and an rpc no box was sent', () => {
    const made = [
      [def('flux', [{ send: 'show flux-capacitor' }], { tier: 'read' }), ['show flux-capacitor: not a show command in the CLI index']],
      [def('colour', [{ send: 'set och {port} colour blue' }], { params: { port } }), ['set och {port} colour blue: not a set command in the CLI index']],
      [def('no-value', [{ send: 'set och {port} target-output-power' }], { params: { port } }),
        ["set och {port} target-output-power: a word left out: the CLI index's is set och <name> target-output-power <target-output-power-value>"]],
      [def('every-channel', [{ send: 'delete media-channel' }]), ["delete media-channel: a word left out: the CLI index's is delete media-channel <index>"]],
      [def('frobnicate', [{ send: 'frobnicate now' }]), ['frobnicate now: starts with no rpc of the CLI index']],
      [def('reboot-chassis', [{ send: 'reboot chassis now' }]), ['reboot chassis now: no box was sent a line of its shape (history.jsonl)']],
      [def('lukewarm', [{ send: 'reboot ne {mode}' }], { params: { mode: { enum: ['cold', 'lukewarm'] } } }), ['reboot ne lukewarm: no box was sent a line of its shape (history.jsonl)']],
      [def('lettered', [{ send: 'reboot card {card} cold' }], { params: { card: { pattern: '[a-z]+' } } }), ['reboot card {card} cold: no box was sent a line of its shape (history.jsonl)']],
      [def('check-flux', [{ send: 'save configuration' }], { verify: 'flux' }), ['show flux-capacitor: not a show command in the CLI index']],
    ];
    for (const [d, want] of made) expect(problems(d), d.id).toEqual(want);
  });

  it("pass in every procedure of the catalog, for each stream with a CLI index", () => {
    for (const stream of readdirSync(new URL('../../data/cli/', import.meta.url))) {
      for (const d of definitions(stream)) expect(problems(d), `${stream}: ${d.id}`).toEqual([]);
    }
  });
});

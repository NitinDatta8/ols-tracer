// Procedure definitions (procedures.mjs), from a catalog of the test's own: common/'s, each replaced by a stream's of
// the same id; every field checked, so a bad file is refused with which and why; a param one word of its values; and
// the plan, every line filled in. The runner itself is in sessions-procedures.test.mjs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'ols-procedures-'));
vi.stubEnv('BRIDGE_CATALOG', root);
const { CHECKS, definitions, paramsOf, planOf } = await import('../../bridge/procedures.mjs');
CHECKS.cardUp = { shows: ({ card }) => [`show card ${card}`], test: () => ({ ok: true }) };

const write = (folder, procedures) => {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, 'procedures.json'), JSON.stringify({ procedures }));
};
const reboot = {
  id: 'reboot-card', label: 'Reboot a card', level: 'card', tier: 'change',
  params: { card: { pattern: '\\d+-\\d+' }, mode: { enum: ['cold', 'warm'], default: 'cold' } },
  steps: [{ send: 'reboot card {card} {mode}' }, { wait: 'cardUp', every: 5, timeout: 180 }], verify: 'cardUp',
};
const audit = { id: 'audit', label: 'Software audit', level: 'chassis', tier: 'read', steps: [{ send: 'show software' }] };
const locate = { id: 'locate', label: 'Locate', level: 'chassis', tier: 'reversible', steps: [{ send: 'locate-chassis start' }], restore: [{ send: 'locate-chassis stop' }] };

beforeEach(() => rmSync(root, { recursive: true, force: true }));

describe('definitions', () => {
  it("are common/'s, each replaced by its stream's own of the same id, then the stream's others", () => {
    write('common', [reboot, audit]);
    write('csp', [{ ...audit, label: 'CSP software audit' }, locate]);
    expect(definitions('csp').map((p) => [p.id, p.label])).toEqual([['reboot-card', 'Reboot a card'], ['audit', 'CSP software audit'], ['locate', 'Locate']]);
    expect(definitions('ctc').map((p) => p.id)).toEqual(['reboot-card', 'audit']); // no file of its own
    expect(definitions(null).map((p) => p.id)).toEqual(['reboot-card', 'audit']); // a box whose release isn't known
    expect(definitions('../csp').map((p) => p.id)).toEqual(['reboot-card', 'audit']); // a release is never a path
  });

  it('are none with no file', () => {
    expect(definitions('csp')).toEqual([]);
  });

  it('refuse a file with a bad one, saying which and why', () => {
    const bad = [
      [{ ...audit, tier: 'risky' }, 'tier: one of read, reversible, change'],
      [{ ...audit, owner: 'me' }, 'owner: not a field of a procedure'],
      [{ ...audit, steps: [{ send: 'set ntp enabled' }] }, 'steps[0].send: a read procedure sends only show lines'],
      [{ ...audit, steps: [{ send: 'show card\nreboot ne cold' }] }, 'steps[0].send: one line of printable text'],
      [{ ...audit, steps: [{ send: ' show card' }] }, 'steps[0].send: one line of printable text'],
      [{ ...audit, steps: [{ send: 'show {constructor}' }] }, 'steps[0].send: {constructor} is not a param'],
      [{ ...reboot, steps: [{ send: 'reboot card {slot} cold' }] }, 'steps[0].send: {slot} is not a param'],
      [{ ...reboot, steps: [{ send: 'configure' }] }, 'steps[0].send: the runner enters and leaves configure itself, and no line may change its mode'],
      [{ ...reboot, steps: [{ send: 'bash' }] }, 'steps[0].send: the runner enters and leaves configure itself, and no line may change its mode'],
      [{ ...reboot, steps: [{ send: 'reboot ne cold', drops: true }] }, 'steps[0]: a step that drops the session is followed by a wait for the box'],
      [{ ...locate, steps: [{ send: 'reboot ne cold', drops: true }, { wait: 'cardUp', timeout: 60 }] }, 'steps[0].drops: only a change may drop the session'],
      [{ ...reboot, steps: [{ wait: 'cardUp' }] }, 'steps[0].timeout: seconds'],
      [{ ...reboot, steps: [{ wait: 'cardUp', timeout: 60, args: { card: 7 } }] }, 'steps[0].args: an object of strings'],
      [{ ...reboot, steps: [], verify: undefined }, 'steps: a list, or none with a verify'],
      [{ ...reboot, verify: 'cardDown' }, 'verify: cardDown is not a check'],
      [{ ...reboot, pre: 'cardUp' }, 'pre: a list of checks'],
      [{ ...reboot, params: { card: { enum: ['1 2'] } } }, 'params.card.enum: a list of words'],
      [{ ...reboot, params: { card: { pattern: '(' } } }, 'params.card.pattern: not a regex'],
      [{ ...reboot, params: { card: { pattern: '.*', enum: ['1-6'] } } }, 'params.card: an enum or a pattern, one of them'],
      [{ ...reboot, params: { card: { pattern: '\\d+-\\d+' }, mode: { enum: ['cold'], default: 'hot' } } }, 'params.mode.default: not one of its values'],
      [{ ...audit, restore: [] }, 'restore: a reversible procedure has one, and only it'],
      [{ ...locate, restore: undefined }, 'restore: a reversible procedure has one, and only it'],
      [{ ...locate, restore: [] }, 'restore: at least one line'],
    ];
    for (const [p, why] of bad) {
      write('common', [p]);
      expect(() => definitions('csp'), why).toThrow(`common/procedures.json: ${p.id}: ${why}`);
    }
    write('common', [audit, audit]);
    expect(() => definitions('csp')).toThrow('common/procedures.json: audit: a second definition of it');
    write('common', { audit });
    expect(() => definitions('csp')).toThrow('common/procedures.json: no procedures list');
  });
});

describe('paramsOf', () => {
  it('takes each param as one word of its values, defaults filled in', () => {
    expect(paramsOf(reboot, { card: '1-6' })).toEqual({ params: { card: '1-6', mode: 'cold' } });
    expect(paramsOf(reboot, { card: '1-6', mode: 'warm' })).toEqual({ params: { card: '1-6', mode: 'warm' } });
    expect(paramsOf({ ...audit, params: { seconds: { pattern: '\\d{1,3}' } } }, { seconds: 60 })).toEqual({ params: { seconds: '60' } });
  });

  it('refuses anything else, so no param can add to a line', () => {
    expect(paramsOf(reboot, {})).toEqual({ why: 'card: missing' });
    expect(paramsOf(reboot, { card: '1-6', mode: 'hot' })).toEqual({ why: 'mode: one of cold, warm' });
    for (const card of ['1-6x', '1-6 cold', '1-6\nreboot ne cold', '1-6;reboot', '', 16]) {
      expect(paramsOf(reboot, { card }), String(card)).toEqual({ why: 'card: one word matching \\d+-\\d+' });
    }
    expect(paramsOf(reboot, { card: '1-6', force: 'yes' })).toEqual({ why: 'force: not a param of reboot-card' });
    expect(paramsOf(reboot, { card: '1-6', constructor: 'x' })).toEqual({ why: 'constructor: not a param of reboot-card' });
    expect(paramsOf(reboot, ['1-6'])).toEqual({ why: 'params: a JSON object' });
  });
});

describe('planOf', () => {
  it('fills in every line, and lists the shows each check reads', () => {
    const { params } = paramsOf(reboot, { card: '1-6' });
    expect(planOf(reboot, params)).toEqual({
      pre: [],
      steps: [{ send: 'reboot card 1-6 cold' }, { wait: 'cardUp', shows: ['show card 1-6'], args: { card: '1-6', mode: 'cold' }, every: 5, timeout: 180 }],
      verify: { check: 'cardUp', shows: ['show card 1-6'] },
      restore: [],
    });
    expect(planOf(locate, {}).restore).toEqual(['locate-chassis stop']);
  });
});

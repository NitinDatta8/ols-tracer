// The Procedures panel's model (src/procedures.ts): what is offered where and why not, the params a procedure starts
// with, a param's value as the bridge takes it, the lines it will type, and how far one asked for got, step by step.
import { describe, expect, it } from 'vitest';
import { active, draft, paramProblem, procedureItems, span, startParams, timeline, type Asked, type BoxProcedures, type ProcedureDef } from '../../src/procedures';

const audit: ProcedureDef = { id: 'audit', label: 'Software audit', level: 'chassis', tier: 'read', steps: [{ send: 'show software' }] };
const reboot: ProcedureDef = {
  id: 'reboot-card', label: 'Reboot a card', level: 'card', tier: 'change',
  params: { card: { pattern: '\\d+-\\d+' }, mode: { enum: ['cold', 'warm'], default: 'cold' } },
  steps: [{ send: 'reboot card {card} {mode}' }, { wait: 'cardUp', every: 5, timeout: 180 }],
};
const locate: ProcedureDef = { id: 'locate', label: 'Locate', level: 'chassis', tier: 'reversible', params: { seconds: { pattern: '\\d+', default: '60' } }, steps: [{ send: 'locate-chassis start {seconds}' }], restore: [{ send: 'locate-chassis stop' }] };
const asked = (state: Asked['state']): Asked => ({
  id: 'audit', label: 'Software audit', tier: 'read', ref: 'r', params: {}, plan: { pre: [], steps: [], verify: null, restore: [] }, state,
  by: 'codex:1', askedAt: '2026-11-12T23:00:00-05:00', startedAt: null, endedAt: null, why: null, waiting: null, log: [], sent: [], runs: [],
});
const box = (current: Asked | null = null): BoxProcedures => ({ host: 'box.test', stream: 'csp', procedures: [audit, reboot], current });
const why = (items: ReturnType<typeof procedureItems>) => Object.fromEntries(items.map((i) => [i.def.id, i.why]));

describe('procedureItems', () => {
  it("offers the level's procedures, and greys out the others with where to go for them", () => {
    expect(why(procedureItems(box(), { level: 'chassis', tester: false, connected: true }))).toEqual({ audit: undefined, 'reboot-card': 'A card procedure: open the card for it' });
    expect(why(procedureItems(box(), { level: 'card', tester: false, connected: true }))).toEqual({ audit: 'A chassis procedure: go back to the chassis for it', 'reboot-card': undefined });
  });

  it('greys out every one on test equipment, a box not connected, or while one waits or runs; none once it is over', () => {
    const all = (current: Asked | null, o: { tester?: boolean; connected?: boolean } = {}) => new Set(Object.values(why(procedureItems(box(current), { level: 'chassis', tester: false, connected: true, ...o }))));
    expect(all(null, { tester: true })).toEqual(new Set(['Test equipment: no procedures']));
    expect(all(null, { connected: false })).toEqual(new Set(['Connect to the box first']));
    expect(all(asked('pending'))).toEqual(new Set(['Software audit is waiting for Approve: one at a time']));
    expect(all(asked('running'))).toEqual(new Set(['Software audit is running: one at a time']));
    expect(why(procedureItems(box(asked('failed')), { level: 'chassis', tester: false, connected: true })).audit).toBeUndefined();
    expect(procedureItems(null, { level: 'chassis', tester: false, connected: true })).toEqual([]);
  });

  it('knows which are still to end', () => {
    expect(['pending', 'running', 'done', 'failed', 'cancelled', 'expired'].map((s) => active(asked(s as Asked['state'])))).toEqual([true, true, false, false, false, false]);
    expect(active(null)).toBe(false);
  });
});

describe('startParams', () => {
  it("starts each param at its default, and a card at the card shown", () => {
    expect(startParams(reboot, { chassis: 1, slot: '7' })).toEqual({ card: '1-7', mode: 'cold' });
    expect(startParams(reboot, { chassis: 2, slot: null })).toEqual({ card: '', mode: 'cold' });
    expect(startParams(audit, { chassis: 1, slot: '7' })).toEqual({});
  });
});

describe('paramProblem', () => {
  it('takes a value as the bridge does: one word, one of its values or matching its pattern whole', () => {
    expect(paramProblem(reboot.params!.card, '1-7')).toBeNull();
    for (const v of ['', '1-7 cold', '1-7;reboot', '1-7x']) expect(paramProblem(reboot.params!.card, v)).toBe('one word matching \\d+-\\d+');
    expect(paramProblem(reboot.params!.mode, 'hot')).toBe('one of cold, warm');
  });
});

describe('draft', () => {
  it("fills in each line, a line with a param missing being null, and gives a wait's check and times, and the undo", () => {
    expect(draft(reboot, { card: '1-7', mode: 'warm' })).toEqual([
      { kind: 'send', what: 'type', code: 'reboot card 1-7 warm', state: 'todo' },
      { kind: 'wait', what: 'wait for cardUp', code: null, more: 'every 5 s, up to 3 min', state: 'todo' },
    ]);
    expect(draft(reboot, { mode: 'warm' })[0].code).toBeNull();
    expect(draft(locate, { seconds: '60' }).map((r) => [r.kind, r.code])).toEqual([['send', 'locate-chassis start 60'], ['restore', 'locate-chassis stop']]);
    expect([30, 120, 600, 7200, 5400].map(span)).toEqual(['30 s', '2 min', '10 min', '2 h', '90 min']);
  });
});

describe('timeline', () => {
  const at = '2026-11-16T19:00:00-05:00';
  const rebootNe = (state: Asked['state'], log: Asked['log']): Asked => ({
    ...asked(state), id: 'reboot-ne', label: 'Reboot NE', tier: 'change', log,
    plan: {
      pre: [], before: [{ check: 'cards-up', shows: ['show card', 'show alarm'] }],
      steps: [{ send: 'reboot ne cold', drops: true, timeout: 600 }, { wait: 'cards-up', shows: ['show card', 'show alarm'], every: 15, timeout: 600 }],
      verify: { check: 'health', shows: ['show card', 'show alarm', 'show system'] }, restore: [],
    },
  });
  const marks = (p: Asked) => timeline(p).rows.map((r) => [r.kind, r.state, r.note ?? null]);

  it('marks each step from the log: a drop as its line is typed passes that line, and the box coming back is noted on it', () => {
    const p = rebootNe('done', [
      { at, step: 'before', check: 'cards-up', ok: true }, { at, step: 'drop', line: 'reboot ne cold', ok: true }, { at, step: 'back', ok: true },
      { at, step: 'wait', check: 'cards-up', ok: true, tries: 3 }, { at, step: 'verify', check: 'health', ok: true },
      { at, step: 'finding', check: 'health', ok: false, why: 'card 1-4 (800MX) is absent' },
    ]);
    expect(marks(p)).toEqual([
      ['before', 'ok', null], ['send', 'ok', 'the box dropped the session, as expected; it came back'], ['wait', 'ok', 'passed on try 3'], ['verify', 'ok', null],
    ]);
    expect(timeline(p).findings).toEqual(['card 1-4 (800MX) is absent']);
    expect(timeline(p).rows[1]).toMatchObject({ code: 'reboot ne cold', more: 'drops the session', at });
  });

  it('marks the next step now while it runs, a drop in a wait on that wait, and where it stopped when it failed', () => {
    expect(marks(rebootNe('running', [{ at, step: 'before', check: 'cards-up', ok: true }]))).toEqual([['before', 'ok', null], ['send', 'now', null], ['wait', 'todo', null], ['verify', 'todo', null]]);
    const typed = [{ at, step: 'before', check: 'cards-up', ok: true }, { at, step: 'send', line: 'reboot ne cold', ok: true }, { at, step: 'drop', line: 'reboot ne cold', ok: true }];
    expect(marks(rebootNe('running', typed))[2]).toEqual(['wait', 'now', 'the box dropped the session']);
    expect(marks(rebootNe('failed', typed.slice(0, 2)))).toEqual([['before', 'ok', null], ['send', 'ok', null], ['wait', 'bad', null], ['verify', 'todo', null]]);
    expect(marks(rebootNe('pending', []))).toEqual([['before', 'todo', null], ['send', 'todo', null], ['wait', 'todo', null], ['verify', 'todo', null]]);
  });

  it('a check that failed is where it stopped, saying why; a reversible one marks its undo', () => {
    const p: Asked = { ...rebootNe('failed', [{ at, step: 'pre', check: 'upgradable', ok: false, why: 'not committed' }]), plan: { pre: [{ check: 'upgradable', shows: ['show software'] }], steps: [{ send: 'commit active-sw-image' }], verify: null, restore: [] } };
    expect(marks(p)).toEqual([['pre', 'bad', 'not committed'], ['send', 'todo', null]]);
    const held: Asked = { ...asked('cancelled'), tier: 'reversible', plan: { pre: [], steps: [{ send: 'set led on' }], verify: null, restore: ['set led off'] },
      log: [{ at, step: 'send', line: 'set led on', ok: true }, { at, step: 'restore', line: 'set led off', ok: true }] };
    expect(marks(held)).toEqual([['send', 'ok', null], ['restore', 'ok', null]]);
  });
});

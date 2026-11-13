// The Procedures panel's model (src/procedures.ts): what is offered where and why not, the params a procedure starts
// with, a param's value as the bridge takes it, and the lines it will type.
import { describe, expect, it } from 'vitest';
import { active, paramProblem, procedureItems, restoreOf, startParams, stepsOf, type Asked, type BoxProcedures, type ProcedureDef } from '../../src/procedures';

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

describe('stepsOf and restoreOf', () => {
  it("fill in each line, a line with a param missing being null, and give a wait's check and times", () => {
    expect(stepsOf(reboot, { card: '1-7', mode: 'warm' })).toEqual([{ send: 'reboot card 1-7 warm', drops: false }, { wait: 'cardUp', every: 5, timeout: 180 }]);
    expect(stepsOf(reboot, { mode: 'warm' })[0]).toEqual({ send: null, drops: false });
    expect(restoreOf(locate, { seconds: '60' })).toEqual(['locate-chassis stop']);
    expect(restoreOf(audit, {})).toEqual([]);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferWiring } from '../../bridge/recorder.mjs';

/** A run's commands as the live session has them: each command's raw output, and its parse when it has one. */
function commandsOf(run) {
  const dir = new URL(`../../data/boxes/${run}/`, import.meta.url).pathname;
  const commands = {};
  for (const line of readFileSync(join(dir, 'raw', 'index.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const { cmd, file } = JSON.parse(line);
    const parsed = join(dir, 'parsed', file.replace(/\.txt$/, '.json'));
    commands[cmd] = { raw: readFileSync(join(dir, 'raw', file), 'utf8'), ...(existsSync(parsed) ? { data: JSON.parse(readFileSync(parsed, 'utf8')) } : {}) };
  }
  return commands;
}

const ends = ({ strands }) => strands.map((s) => `${s.from} -> ${s.to}`).sort();

describe('inferWiring', () => {
  it('takes an internal/external connection as a duplex patch, both ways', () => {
    const raw = `[config]\n\nid          description    connection-type    source-port    dest-port\n--------    -----------    ---------------    -----------    ------------\nad1solt5                   data               port-1-5-1     port-1-1-ad1\n\n[state]\n\nid          description    connection-type    source-port    dest-port\n--------    -----------    ---------------    -----------    ------------\nad1solt5                   data               port-1-5-1     port-1-1-ad1\n`;
    expect(inferWiring({ 'show internal-connection': { raw } }).strands).toEqual([
      { from: '1-5-1', to: '1-1-ad1', via: 'ad1solt5', notes: 'auto: show internal-connection' },
      { from: '1-1-ad1', to: '1-5-1', via: 'ad1solt5', notes: 'auto: show internal-connection' },
    ]);
  });

  it("draws box 3's fibers on the box, as its wiring.csv has them: the OCH into its media channel, the line looped back", () => {
    const { strands } = inferWiring(commandsOf('paho-gs2000-03/runs/20261105-164500-connect'));
    expect(ends({ strands })).toEqual(['1-1-ad11 -> 1-7-5', '1-1-line -> 1-1-line', '1-7-5 -> 1-1-ad11']);
    expect(strands[0].notes).toBe('auto: och 1-7-5 at 193500000 MHz is in media channel CH-6; carries 1-7-4 (CC5_4)');
    expect(strands[2]).toMatchObject({ via: 'power', notes: 'auto: power fallback (low confidence)' });
  });

  it('pairs by power only the kinds a fiber joins, when no media channel says', () => {
    // Before show media-channel was captured: 1-7-5's Tx is nearer 1-1-line's Rx, but an OCH goes into an add/drop port.
    expect(ends(inferWiring(commandsOf('paho-gs2000-03/runs/20261103-104506-connect')))).toEqual(['1-1-ad11 -> 1-7-5', '1-1-line -> 1-1-line', '1-7-5 -> 1-1-ad11']);
    // Box 4: 1-4-5 on the TMUXC_25's sig port, not the sig port looped onto itself.
    expect(ends(inferWiring(commandsOf('paho-gs2000-04/runs/20261105-131514-connect')))).toEqual(['1-1-line -> 1-1-line', '1-1-sig -> 1-4-5', '1-4-5 -> 1-1-sig']);
  });

  it('falls back to power matches when no table says, ports of unknown kind pairing with any', () => {
    const stats = (tx, rx, key = 'input-power') => ({ data: { state: { stats: { 'output-power': { instant: tx }, [key]: { instant: rx } } } } });
    const { strands } = inferWiring({
      'show internal-connection': { raw: 'None\n' },
      'show och 1-7-5': stats(-5, -12, 'total-input-power'),
      'show transceiver 1-7-4': stats(-12, -5),
    });
    expect(strands).toEqual(expect.arrayContaining([
      { from: '1-7-5', to: '1-7-4', via: 'power', loss_db: '0.00', notes: 'auto: power fallback (low confidence)' },
      { from: '1-7-4', to: '1-7-5', via: 'power', loss_db: '0.00', notes: 'auto: power fallback (low confidence)' },
    ]));
  });

  it('returns none when no source gives a usable strand', () => {
    expect(inferWiring({})).toEqual({ strands: [] });
  });
});

describe('inferWiring, case by case', () => {
  /** A table as this CLI prints one: each column as wide as its widest cell, dashes under the header. */
  const table = (cols, rows) => {
    const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? '').length)));
    const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(w[i])).join('    ').trimEnd();
    return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map(line), ''].join('\n');
  };
  const och = (...rows) => ({ raw: table(['name', 'laser', 'frequency', 'output-power', 'total-input-power'], rows) });
  const channel = (port, state = 'in-service', [mid, width, lo = '', hi = ''] = ['193500000', '100000']) =>
    ({ raw: table(['index', 'name', 'add-drop-port', 'admin-state', 'center-frequency', 'bandwidth', 'lower-frequency', 'upper-frequency'], [['6', 'ch6', port, state, mid, width, lo, hi]]) });
  const stats = (tx, rx) => ({ data: { state: { stats: { 'output-power': { instant: tx }, 'input-power': { instant: rx } } } } });
  const lit = och(['1-7-5', 'enabled', '193500000', '', '']);

  it('puts a lit OCH into the one media channel its frequency is in, and only then', () => {
    expect(ends(inferWiring({ 'show och': lit, 'show media-channel': channel('port-1-1-ad11') }))).toEqual(['1-1-ad11 -> 1-7-5', '1-7-5 -> 1-1-ad11']);
    for (const [why, commands] of [
      ['out of service', { 'show och': lit, 'show media-channel': channel('port-1-1-ad11', 'out-of-service') }],
      ['two OCHs in it', { 'show och': och(['1-7-5', 'enabled', '193500000', '', ''], ['1-8-1', 'enabled', '193500000', '', '']), 'show media-channel': channel('port-1-1-ad11') }],
      ['its laser off', { 'show och': och(['1-7-5', 'disabled', '193500000', '', '']), 'show media-channel': channel('port-1-1-ad11') }],
      ['its edges narrower than its width', { 'show och': lit, 'show media-channel': channel('port-1-1-ad11', 'in-service', ['193600000', '100000', '193550000', '193650000']) }],
      ['no add/drop port', { 'show och': lit, 'show media-channel': channel('none') }],
    ]) expect(inferWiring(commands).strands, why).toEqual([]);
  });

  it('takes the strongest source first: a connection over a media channel on the same port', () => {
    const raw = table(['id', 'source-port', 'dest-port'], [['x1', 'port-1-5-1', 'port-1-1-ad11']]);
    expect(ends(inferWiring({ 'show internal-connection': { raw }, 'show och': lit, 'show media-channel': channel('port-1-1-ad11') }))).toEqual(['1-1-ad11 -> 1-5-1', '1-5-1 -> 1-1-ad11']);
  });

  it("reads a connection's ends with or without port-, once each across [config] and [state], and skips a row with one end", () => {
    const rows = table(['name', 'from', 'to'], [['x1', '1-1-ad1', '1-8-1'], ['only', '1-1-ad2', '']]);
    const { strands } = inferWiring({ 'show external-connection': { raw: `[config]\n${rows}\n[state]\n${rows}` } });
    expect(strands).toEqual([
      { from: '1-1-ad1', to: '1-8-1', via: 'x1', notes: 'auto: show external-connection' },
      { from: '1-8-1', to: '1-1-ad1', via: 'x1', notes: 'auto: show external-connection' },
    ]);
    expect(inferWiring({ 'show internal-connection': { raw: 'None\n' }, 'show external-connection': { raw: '  none  \n' } }).strands).toEqual([]);
  });

  it('pairs by power only a clear nearest match, of light that is there and a loss a fiber can have', () => {
    const tx = { 'show transceiver 1-7-4': stats(-5, -50) };
    expect(inferWiring({ ...tx, 'show transceiver 1-8-1': stats(-50, -10), 'show transceiver 1-8-2': stats(-50, -14) }).strands)
      .toEqual([{ from: '1-7-4', to: '1-8-1', via: 'power', loss_db: '5.00', notes: 'auto: power fallback (low confidence)' }]);
    expect(inferWiring({ ...tx, 'show transceiver 1-8-1': stats(-50, -10), 'show transceiver 1-8-2': stats(-50, -10.5) }).strands).toEqual([]); // within 1 dB: either
    expect(inferWiring({ ...tx, 'show transceiver 1-8-1': stats(-50, -36) }).strands).toEqual([]); // no light
    expect(inferWiring({ ...tx, 'show transceiver 1-8-1': stats(-50, -34.9) }).strands.map((s) => s.loss_db)).toEqual(['29.90']);
    expect(inferWiring({ 'show transceiver 1-7-4': stats(-30, -50), 'show transceiver 1-8-1': stats(-50, -4) }).strands).toEqual([]); // 26 dB of gain
  });

  it("loops back by power only an OCH or a span port, never two ports of one mux or a client port onto itself", () => {
    expect(ends(inferWiring({ 'show och': och(['1-7-5', 'enabled', '193500000', '-3', '-3.5']) }))).toEqual(['1-7-5 -> 1-7-5']);
    const ports = { data: { state: { ports: { 'port-1-1-ad1': { in: { 'optical-power': -50 }, out: { 'optical-power': 3 } }, 'port-1-1-ad2': { in: { 'optical-power': 2 }, out: { 'optical-power': -50 } } } } }, raw: table(['name'], [['port-1-1-ad1'], ['port-1-1-ad2']]) };
    expect(inferWiring({ 'show optical-port': ports }).strands).toEqual([]);
    const assignment = { raw: 'assignment-id    type\n-------------    ----\n1    eth 1-7-4 och 1-7-4\n' };
    expect(inferWiring({ 'show assignment': assignment, 'show transceiver 1-7-4': stats(-3, -3.5) }).strands).toEqual([]);
  });
});

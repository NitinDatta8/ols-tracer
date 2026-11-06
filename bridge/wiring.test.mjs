import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferWiring } from './recorder.mjs';

/** A run's commands as the live session has them: each command's raw output, and its parse when it has one. */
function commandsOf(run) {
  const dir = new URL(`../data/boxes/${run}/`, import.meta.url).pathname;
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
    const { strands } = inferWiring(commandsOf('box3/runs/20261105-164500-connect'));
    expect(ends({ strands })).toEqual(['1-1-ad11 -> 1-7-5', '1-1-line -> 1-1-line', '1-7-5 -> 1-1-ad11']);
    expect(strands[0].notes).toBe('auto: och 1-7-5 at 193500000 MHz is in media channel CH-6; carries 1-7-4 (CC5_4)');
    expect(strands[2]).toMatchObject({ via: 'power', notes: 'auto: power fallback (low confidence)' });
  });

  it('pairs by power only the kinds a fiber joins, when no media channel says', () => {
    // Before show media-channel was captured: 1-7-5's Tx is nearer 1-1-line's Rx, but an OCH goes into an add/drop port.
    expect(ends(inferWiring(commandsOf('box3/runs/20261103-104506-connect')))).toEqual(['1-1-ad11 -> 1-7-5', '1-1-line -> 1-1-line', '1-7-5 -> 1-1-ad11']);
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

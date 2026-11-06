import { describe, expect, it } from 'vitest';
import { inferWiring } from './recorder.mjs';

describe('inferWiring', () => {
  it('prefers internal/external connection rows when present', () => {
    const raw = `[config]\n\nid          description    connection-type    source-port    dest-port\n--------    -----------    ---------------    -----------    ------------\nad1solt5                   data               port-1-5-1     port-1-1-ad1\n\n[state]\n\nid          description    connection-type    source-port    dest-port\n--------    -----------    ---------------    -----------    ------------\nad1solt5                   data               port-1-5-1     port-1-1-ad1\n`;
    const { source, strands } = inferWiring({ 'show internal-connection': { raw } });
    expect(source).toBe('connections');
    expect(strands).toEqual([{ from: '1-5-1', to: '1-1-ad1', via: 'ad1solt5', notes: 'auto: show internal-connection' }]);
  });

  it('falls back to power matches when connection commands have no rows', () => {
    const { source, strands } = inferWiring({
      'show internal-connection': { raw: 'None\n' },
      'show external-connection': { raw: 'None\n' },
      'show och 1-7-5': {
        data: {
          state: {
            stats: {
              'output-power': { instant: -5 },
              'total-input-power': { instant: -12 },
            },
          },
        },
      },
      'show transceiver 1-7-4': {
        data: {
          state: {
            stats: {
              'output-power': { instant: -12 },
              'input-power': { instant: -5 },
            },
          },
        },
      },
    });
    expect(source).toBe('power');
    expect(strands).toEqual(expect.arrayContaining([
      {
        from: '1-7-5',
        to: '1-7-4',
        via: 'power',
        loss_db: '0.00',
        notes: 'auto: power fallback (low confidence)',
      },
      {
        from: '1-7-4',
        to: '1-7-5',
        via: 'power',
        loss_db: '0.00',
        notes: 'auto: power fallback (low confidence)',
      },
    ]));
  });

  it('returns none when neither source gives a usable strand', () => {
    expect(inferWiring({})).toEqual({ source: 'none', strands: [] });
  });
});

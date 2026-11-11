import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import box3 from '../../examples/box3.olst.json';
import { byId, cliAddress } from '../../src/catalog';
import { catalogFor } from '../../src/catalog-vite';
import { activePorts, firstLoss, heads, hopName, inside, judge, l0Problems, limitsAt, mediaChannels, portPower, tables, trace, type Limit, type Stage } from '../../src/l0';
import { light, type BoxState } from '../../src/live';
import type { Link, Topology } from '../../src/types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { latest } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/recorder.mjs'));

const t = box3 as unknown as Topology;
const cat = catalogFor(t.stream);
const device = t.devices[0];
const c1125 = byId(cat.linecards, 'lc-c1125')!;
/** The last healthy run on box 3: light on AD11, with IN_OPTICAL_HIGH_WARNING standing at 2.61 dBm. */
const healthy: BoxState = { live: false, ...latest('20261103-104506-connect') };
/** Box 3's fibers on another add/drop port, for runs from before they moved to AD11, or to move them away from it. */
const fiberedOn = (port: string): Topology => ({
  ...t, links: t.links.map((l) => JSON.parse(JSON.stringify(l).replaceAll('"AD11"', `"${port}"`)) as Link),
});
const without = (s: BoxState, cmd: string): BoxState => { const { [cmd]: _, ...commands } = s.commands; return { ...s, commands }; };
const withRaw = (s: BoxState, cmd: string, raw: string): BoxState => ({ ...s, commands: { ...s.commands, [cmd]: { at: 0, raw } } });

/**
 * `show media-channel` as this CLI prints a table, with its columns from the CLI index. No run has this command yet, so
 * this is the shape we expect, not the box's output.
 */
const channels = (port: string, frequency = 193500000) => `[config]

index    name    line-port        add-drop-port    admin-state    center-frequency    bandwidth
                                                                  (MHz)               (MHz)
-----    ----    -------------    -------------    -----------    ----------------    ---------
6        ch6     port-1-1-line    port-1-1-${port.padEnd(4)}    in-service     ${frequency}           100000


[state]

index    actual-add-voa-attenuation    actual-drop-voa-attenuation
         (dB)                          (dB)
-----    --------------------------    ---------------------------
6        15.00                         3.20
`;

describe('media channels', () => {
  it('reads a table by its column names, a row merged across [config] and [state]', () => {
    expect(tables(channels('ad11'))).toEqual([{
      id: '6',
      cols: {
        index: '6', name: 'ch6', 'line-port': 'port-1-1-line', 'add-drop-port': 'port-1-1-ad11', 'admin-state': 'in-service',
        'center-frequency': '193500000', bandwidth: '100000', 'actual-add-voa-attenuation': '15.00', 'actual-drop-voa-attenuation': '3.20',
      },
    }]);
  });

  it('reads a table the box really printed: show och, and show amplifier with its stats', () => {
    const raw = (name: string) => readFileSync(resolve(repoRoot, `data/boxes/paho-gs2000-03/runs/20261103-104506-connect/raw/${name}.txt`), 'utf8');
    const och = tables(raw('032_show-och'));
    expect(och.find((r) => r.id === '1-7-5')?.cols).toMatchObject({ frequency: '193500000', laser: 'enabled', 'operational-mode-name': 'ZR400-16QAMSS-60G-OFEC' });
    const amp = tables(raw('042_show-amplifier'));
    expect(amp.find((r) => r.id === '1-1-pa')?.cols).toMatchObject({ 'target-gain': '25.00', 'ingress-port': 'port-1-1-line', 'ingress-span-loss': '10.13' });
  });

  it('knows them only when the box printed them', () => {
    expect(mediaChannels(healthy)).toBeNull(); // no run has the command yet
    expect(mediaChannels(withRaw(healthy, 'show media-channel', 'None\n'))).toEqual([]);
    expect(mediaChannels(withRaw(healthy, 'show media-channel', 'invalid command\n'))).toBeNull();
    expect(mediaChannels(withRaw(healthy, 'show media-channel', channels('ad11')))).toMatchObject([{ id: '6', line: '1-1-line', addDrop: '1-1-ad11', up: true }]);
  });

  it('finds the active ports from the media channels, else from the light', () => {
    expect(activePorts(healthy, c1125, 1, '1')).toEqual({ from: 'light', ports: new Set(['1-1-line', '1-1-ad11']) });
    expect(activePorts(withRaw(healthy, 'show media-channel', channels('ad3')), c1125, 1, '1')).toEqual({ from: 'media-channel', ports: new Set(['1-1-ad3']) });
  });
});

describe('the light path', () => {
  const names = (s: BoxState | null, topology = t) => trace(topology, cat, s, heads(topology, cat)[0]).map(hopName);

  it('starts on the transponder, not on the C1125', () => {
    expect(heads(t, cat).map((l) => l.id)).toEqual(['F03']);
  });

  it('runs F03, the mux and booster, F05 and the preamp and demux to F04', () => {
    expect(names(healthy)).toEqual([
      '1-7-5 out', 'F03', '1-1-ad11 in', 'mux', 'BA', '1-1-line out', 'F05', '1-1-line in', 'PA', 'demux', '1-1-ad11 out', 'F04', '1-7-5 in',
    ]);
  });

  it('needs no box to follow the fibers', () => {
    expect(names(null)).toHaveLength(13);
  });

  it('takes the active way out when two ports have a fiber', () => {
    const extra: Link = { id: 'F99', type: 'smf', a: { device: 'd1', slot: '1', port: 'AD3' }, b: { device: 'd1', slot: '8', port: 'PORT5' } };
    const two = { ...t, links: [extra, ...t.links] };
    expect(names(healthy, two).at(-2)).toBe('F04');
  });

  it('stops at a WSS with no media channel through it', () => {
    const elsewhere = withRaw(healthy, 'show media-channel', channels('ad1'));
    expect(names(elsewhere)).toEqual(['1-7-5 out', 'F03', '1-1-ad11 in', 'mux (no media channel)']);
    expect(names(withRaw(healthy, 'show media-channel', channels('ad11')))).toHaveLength(13);
  });

  it('finds the most upstream loss of signal on a run with the fiber out of AD1', () => {
    const s: BoxState = { live: false, ...latest('20261102-115853-connect-ad2-nonworking') };
    const onAd1 = fiberedOn('AD1');
    const loss = firstLoss(s, trace(onAd1, cat, s, heads(onAd1, cat)[0]))!;
    expect(hopName(loss.hop)).toBe('1-1-ad1 in');
    expect(loss.alarm['alarm-abbreviate']).toBe('IN_LOS');
    // The alarms downstream of it are there too: the amplifiers, the line, and the transponder's Rx.
    expect(Object.values<{ resource: string }>(s.commands['show alarm'].data.alarms).map((a) => a.resource)).toEqual(expect.arrayContaining(['amplifier 1-1-ba', 'port 1-1-line', 'och 1-7-5']));
  });

  it('has no loss to find on a healthy run', () => {
    expect(firstLoss(healthy, trace(t, cat, healthy, heads(t, cat)[0]))).toBeNull();
  });
});

describe('a port\'s power', () => {
  const ports = (port: string, dBm: number) => ({ state: { ports: { [`port-${port}`]: { in: { 'optical-power': dBm, flag: '' } } } } });
  const read = (one: number, all: number, list = ports('1-1-ad11', -99.99)): BoxState => ({
    live: true, commands: { 'show optical-port 1-1-ad11': { at: one, data: ports('1-1-ad11', 2.61) }, 'show optical-port': { at: all, data: list } },
  });

  it('is the reading of whichever of show optical-port <at> and its list form read it last, the port\'s own on a tie', () => {
    expect(portPower(read(1000, 2000), '1-1-ad11', 'in')).toEqual({ dBm: undefined, flag: '', dark: true }); // dark since
    expect(portPower(read(3000, 2000), '1-1-ad11', 'in')).toEqual({ dBm: 2.61, flag: '', dark: false });
    expect(portPower(read(2000, 2000), '1-1-ad11', 'in')?.dBm).toBe(2.61);
  });

  it('is the port\'s own reading when the list read since has no line for it, and none when neither has', () => {
    expect(portPower(read(1000, 2000, ports('1-1-ad1', 1)), '1-1-ad11', 'in')?.dBm).toBe(2.61);
    expect(portPower(read(1000, 2000), '1-1-ad11', 'out')).toBeUndefined();
  });
});

describe('thresholds', () => {
  const warning: Limit = { name: 'IN_OPTICAL_HIGH_WARNING', level: 'warning', side: 'high', declare: 3, clear: 2.5 };
  const failure: Limit = { name: 'IN_OPTICAL_HIGH_FAILURE', level: 'failure', side: 'high', declare: 6, clear: 5.5 };
  const low: Limit = { name: 'IN_OPTICAL_LOW_WARNING', level: 'warning', side: 'low', declare: -15, clear: -14.5 };
  const limits = [warning, failure, low];

  it('the catalog holds what the box prints, on every C1125 port that has limits', () => {
    const noBox = without(healthy, 'show profile-threshold');
    for (const port of c1125.ports.filter((p) => /^(AD\d+|LINE)$/.test(p.id))) {
      const at = cliAddress(1, '1', port.id);
      for (const dir of ['in', 'out'] as const) {
        expect(limitsAt(noBox, c1125, port.id, at, dir), `${port.id} ${dir}`).toEqual(limitsAt(healthy, c1125, port.id, at, dir));
      }
    }
  });

  it('raises a limit past its declare level', () => {
    expect(judge(3.01, limits, [])).toMatchObject({ level: 'warning', side: 'high' });
    expect(judge(2.99, limits, [])).toBeNull();
    expect(judge(-15.5, limits, [])).toMatchObject({ level: 'warning', side: 'low' });
  });

  it('keeps a raised limit until past its clear level: AD11 at 2.61 still has the alarm the box raised at 3', () => {
    expect(judge(2.61, limits, ['IN_OPTICAL_HIGH_WARNING'])).toMatchObject({ level: 'warning', fill: 0 });
    expect(judge(2.61, limits, [])).toBeNull();
    expect(judge(2.49, limits, ['IN_OPTICAL_HIGH_WARNING'])).toBeNull();
  });

  it('grows with the power from warning to failure', () => {
    expect(judge(4.5, limits, [])).toMatchObject({ level: 'warning', fill: 0.5 });
    expect(judge(6.5, limits, [])).toMatchObject({ level: 'failure', fill: 1 });
  });

  it('colours F03, whose C1125 end has the alarm standing, and not F04', () => {
    const [f03, f04] = t.links;
    expect(light(healthy, t, f03, cat)!.heat).toMatchObject({ level: 'warning', side: 'high', fill: 0 });
    expect(light(healthy, t, f03, cat)!.notes).toContain('Rx 1-1-ad11: IN_OPTICAL_HIGH_WARNING: 2.61 dBm stands, declared over 3.00, clears under 2.50');
    expect(light(healthy, t, f04, cat)!.heat).toBeNull();
  });

  it('falls back on the catalog when the box has not shown its thresholds', () => {
    const noBox = without(healthy, 'show profile-threshold');
    expect(light(noBox, t, t.links[0], cat)!.heat).toMatchObject({ level: 'warning' });
    expect(light(noBox, t, t.links[0])!.heat).toBeNull(); // no catalog given, so nothing to judge it by
  });

  it('judges an amplifier and an OCH by their TCAs, never past a warning', () => {
    const amp = limitsAt(healthy, undefined, undefined, '1-1-ba', 'in');
    expect(amp.map((l) => [l.name, l.level, l.declare])).toEqual([['TCA_OPT_INPUT_POWER_H_15MIN', 'warning', 14], ['TCA_OPT_INPUT_POWER_L_15MIN', 'warning', -20]]);
    expect(limitsAt(healthy, undefined, 'PORT5', '1-7-5', 'out').map((l) => l.declare)).toEqual([3, -6]);
  });
});

describe('no light', () => {
  it('is what -99.99 means: the strand is dark and shows no power', () => {
    const left = fiberedOn('AD1'); // AD1 reads -99.99 on the runs with the light on AD11
    const [f03, f04] = left.links;
    const lit03 = light(healthy, left, f03, cat)!;
    expect(lit03).toMatchObject({ dark: true, rx: undefined });
    expect(lit03.tx).toBeLessThan(0);
    expect(lit03.notes).toContain('No light at 1-1-ad1');
    expect(lit03.notes.join()).not.toContain('Tx − Rx');
    expect(light(healthy, left, f04, cat)).toMatchObject({ dark: true, tx: undefined });
  });
});

describe('inside a card', () => {
  const rowsOf = (s: BoxState | null) => inside(t, cat, s, device, '1');
  const stage = (s: Stage[], i: number) => s[i] as Extract<Stage, { kind: 'wss' | 'amp' }>;

  it('has the way out over the way back, the C1125 ports fanned to the one with light', () => {
    const [out, back] = rowsOf(healthy);
    expect(out.back).toBe(false);
    expect(back.back).toBe(true);
    expect(out.stages.map((x) => x.kind)).toEqual(['ports', 'wss', 'amp', 'ports']);
    expect(back.stages.map((x) => x.kind)).toEqual(['ports', 'amp', 'wss', 'ports']);
    expect(out.stages[0]).toMatchObject({ cells: [{ id: 'AD11', dir: 'in', dBm: 2.61, flag: 'C' }] });
    expect((out.stages[0] as { idle: string[] }).idle).toHaveLength(10);
    expect(out.stages[3]).toMatchObject({ cells: [{ id: 'LINE', dir: 'out', flag: 'M' }] });
  });

  it('shows the box\'s numbers at each stage, and the step over a WSS as the difference of the two sides', () => {
    const [out, back] = rowsOf(healthy);
    expect(stage(out.stages, 2)).toMatchObject({ id: 'BA', facts: expect.arrayContaining([{ label: 'Gain', value: '22.99 dB of 23.00' }, { label: 'Gain range', value: '15 to 25 dB' }]) });
    expect(stage(back.stages, 1).facts).toEqual(expect.arrayContaining([{ label: 'VOA', value: '14.62 dB' }, { label: 'Span loss', value: '10.13 dB' }]));
    expect(stage(out.stages, 1).facts).toContainEqual({ label: 'AD11 to BA', value: '24.50 dB' });
    expect(stage(back.stages, 2).facts).toHaveLength(1);
  });

  it('puts the channel alarm on the add side and the BA input against its TCA', () => {
    const [out, back] = rowsOf(healthy);
    expect(stage(out.stages, 1).alarms).toEqual(['MAJOR REACH_MAX_ATT_SRC_TO_DEST: Channel add direction attenuation reach to maximum working range']);
    expect(stage(back.stages, 2).alarms).toEqual([]);
    expect(stage(out.stages, 2).facts[0]).toMatchObject({ label: 'In', heat: { level: 'warning', side: 'low' } });
  });

  it('adds what the media channel says', () => {
    const [out] = rowsOf(withRaw(healthy, 'show media-channel', channels('ad11')));
    expect(stage(out.stages, 1).facts.slice(0, 2)).toEqual([{ label: 'Channel', value: '6 · 193500000 MHz · 100000 MHz wide' }, { label: 'VOA', value: '15.00 dB' }]);
  });

  it('still draws its stages with no box', () => {
    const [out] = rowsOf(null);
    expect(out.stages[0]).toMatchObject({ cells: [{ id: 'AD11', dark: false, dBm: undefined }] });
    expect(stage(out.stages, 2).facts).toEqual([{ label: 'Gain range', value: '15 to 25 dB' }]);
  });

  it('uses the amplifiers alone on a card with no internal paths: box 4\'s C25, every reading measured', () => {
    // Box 4 (PAHO-GS2000-04) as `show optical-port` read it on 2026-11-03; its run was dropped from box 3's.
    const port = (dBm: number) => ({ 'optical-power': dBm, flag: 'M' });
    const ports = { 'port-1-1-sig': { in: port(-3.14), out: port(3.24) }, 'port-1-1-line': { in: port(-5.88), out: port(4.89) } };
    const s: BoxState = { live: false, commands: { 'show optical-port': { at: 0, data: { state: { ports } } } } };
    const d = { ...device, slots: { 1: { linecard: 'lc-c25', ports: {} } } };
    const [out, back] = inside({ ...t, devices: [d], links: [] }, cat, s, d, '1');
    expect(out.stages[0]).toMatchObject({ cells: [{ id: 'SIG', dBm: -3.14, flag: 'M' }] });
    expect(stage(out.stages, 1)).toMatchObject({ id: 'BA' });
    expect(out.stages[2]).toMatchObject({ cells: [{ id: 'LINE', dBm: 4.89, flag: 'M' }] });
    expect(back.back).toBe(true);
    expect(stage(back.stages, 1)).toMatchObject({ id: 'PA' });
  });
});

describe('the most-upstream-LOS baseline on box 3\'s episodes', async () => {
  // Step 10's baseline against what the box's own logs say was done on 2026-11-02: the alarms up 10 s into each outage,
  // replayed from history.jsonl, on the path as it was wired then (a media channel's add/drop port).
  const { lines } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/recorder.mjs'));
  const { episodes, alarmsAt } = await import(/* @vite-ignore */ resolve(repoRoot, 'bridge/history.mjs'));
  const h = lines(resolve(repoRoot, 'data/boxes/paho-gs2000-03/history.jsonl'));
  type Episode = { at: string; cause: string | null; what: string; lossAt: string | null };
  const scored = (episodes(h) as Episode[]).filter((e) => e.cause && e.lossAt && e.at.startsWith('2026-11-02'));
  /** Right when it names the card the episode was about, or the WSS whose media channel went. */
  const right = (e: Episode, at: string) => {
    const card = e.what.match(/card (\d+-\d+)/)?.[1];
    return card ? at === card || at.startsWith(`${card}-`) : /^delete media-channel/.test(e.what) && at === 'wss';
  };
  const answers = scored.map((e) => {
    let port = 'AD11';
    for (const x of h) if (x.kind === 'config' && x.at <= e.at) port = x.details.match(/add-drop-port port-1-1-(ad\d+)/)?.[1].toUpperCase() ?? port;
    const wired = fiberedOn(port);
    const s: BoxState = { live: false, commands: { 'show alarm': { at: 0, data: { alarms: alarmsAt(h, new Date(Date.parse(e.lossAt!) + 10000).toISOString()) } } } };
    const loss = firstLoss(s, trace(wired, cat, s, heads(wired, cat)[0]));
    const at = !loss ? '' : loss.hop.kind === 'wss' ? 'wss' : loss.hop.kind === 'fiber' ? loss.hop.id : loss.hop.at;
    return `${e.what} → ${loss ? hopName(loss.hop) : 'nothing'}${right(e, at) ? ' ✓' : ''}`;
  });

  it('never names what was done, so the agent has something to beat', () => {
    expect(answers).toEqual([
      'delete media-channel 5 → BA',
      'delete media-channel 6 → BA',
      'delete media-channel 6 → BA',
      'delete media-channel 6 → BA',
      'delete media-channel 6 → BA',
      'reboot ne cold → BA',
      'reboot card 1-1 cold → 1-7-5 in',
      'reboot ne cold → BA',
      'card 1-1 → 1-7-5 in',
      'card 1-7 → BA',
      'card 1-7 → BA',
    ]);
  });
});

describe('range checks', () => {
  const box = (key: string, value: string): BoxState => {
    const data = structuredClone(healthy.commands['show amplifier'].data);
    data.state.amplifiers['1-1-pa'][key] = value;
    return { ...healthy, commands: { ...healthy.commands, 'show amplifier': { at: 0, data } } };
  };

  it('has nothing to say about box 3 as it stands', () => {
    expect(l0Problems(t, cat, healthy, device)).toEqual([]);
    expect(l0Problems(t, cat, withRaw(healthy, 'show media-channel', channels('ad11')), device)).toEqual([]);
  });

  it('lists an amplifier target outside the catalog range', () => {
    expect(l0Problems(t, cat, box('target-gain', '26.00'), device)).toEqual(['PAHO-GS2000-03: 1-1-pa target gain 26 dB is outside 15 to 25 dB']);
    expect(l0Problems(t, cat, box('target-gain-tilt', '1.00'), device)).toEqual(['PAHO-GS2000-03: 1-1-pa target tilt 1 dB is outside -3 to 0 dB']);
  });

  it('lists a media channel outside the channel plan', () => {
    const s = withRaw(healthy, 'show media-channel', channels('ad11', 197000000));
    expect(l0Problems(t, cat, s, device)).toEqual(["PAHO-GS2000-03: media channel 6 at 197000000 MHz is outside C1125's 191350000 to 196150000 MHz"]);
  });

  it('lists a fiber and a media channel on different ports', () => {
    expect(l0Problems(t, cat, withRaw(healthy, 'show media-channel', channels('ad1')), device)).toEqual([
      'PAHO-GS2000-03: media channel 6 uses 1-1-ad1, which has no fiber',
      'PAHO-GS2000-03: fiber F04 is on 1-1-ad11, which has no media channel',
    ]);
  });
});

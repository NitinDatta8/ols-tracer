// The catalog's checks (CHECKS in bridge/procedures.mjs) on the boxes' own recorded output: each show a check reads,
// as the box last printed it in a snapshot, parsed again with its TTP template, as the runner parses what it types.
// The software audit flags exactly the boxes whose release isn't committed and passes the rest; the health check names
// box 3's problems against its latest healthy baseline, and says when a box has none. Needs npm run bridge:setup's
// Python, as the template tests do, and is skipped without it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '../../bridge/procedures.mjs';
import { boxDir, boxes, lines, parse, PYTHON, runsOf, TEMPLATES_DIR } from '../../bridge/recorder.mjs';

/** The box's latest snapshot output of `cmd`, as it printed it: from the newest run that has one. */
function printed(box, cmd) {
  for (const { run } of runsOf(box).reverse()) {
    const dir = join(boxDir(box), 'runs', run, 'raw');
    const line = lines(join(dir, 'index.jsonl')).findLast((l) => l.cmd === cmd && ['snapshot', 'prereq'].includes(l.source ?? 'snapshot'));
    if (line) return readFileSync(join(dir, line.file), 'utf8');
  }
  throw new Error(`${box} never printed ${cmd}`);
}

/** What check `name` reads of `box`, as the runner hands it over: each show's output and its parse. */
async function outputs(name, box) {
  const out = {};
  for (const cmd of CHECKS[name].shows({})) {
    const raw = printed(box, cmd);
    out[cmd] = { raw, data: (await parse(cmd, raw)).data };
  }
  return out;
}

const BOX3 = 'paho-gs2000-03';

describe.skipIf(!existsSync(PYTHON) || !existsSync(TEMPLATES_DIR))("the catalog's checks on each box's recorded output (needs npm run bridge:setup)", () => {
  it('the software audit flags exactly the boxes whose release is not committed, 03, 04, 05, test01 and test02, and passes 06 to 08', async () => {
    const found = {};
    for (const box of boxes()) {
      const r = CHECKS.software.test(await outputs('software', box));
      expect(r.ok, box).toBe(true);
      found[box] = r.findings;
    }
    expect(Object.keys(found).filter((b) => found[b].length).sort()).toEqual(['03', '04', '05', 'test01', 'test02'].map((n) => `paho-gs2000-${n}`));
    expect(['06', '07', '08'].map((n) => found[`paho-gs2000-${n}`])).toEqual([[], [], []]);
    expect(found[BOX3]).toEqual([
      'active-status active: CSP-2.10.100.10_20261013 is not committed',
      'candidate Release_CSP-2.9.0.235_20260209.tar left behind (candidate-status inactive)',
    ]);
  });

  it("the software audit names a card on another release, and leaves a TMUX card's own OS alone", async () => {
    const out = await outputs('software', BOX3);
    const cards = out['show card'].data.state.cards;
    cards['1-7']['software-version'] = '800mx_CSP-2.9.0.235_20260209';
    cards['1-1']['software-version'] = 'TWSOA25_OS_GE_2.7.0 (2.7.0)';
    expect(CHECKS.software.test(out).findings.slice(2)).toEqual(['card 1-7 (800MX) runs CSP-2.9.0.235_20260209, not CSP-2.10.100.10_20261013']);
  });

  it("the health check names box 3's problems since its latest healthy baseline, threshold flaps left out", async () => {
    expect(runsOf(BOX3).filter((m) => m.state === 'healthy').at(-1).run).toBe('20261108-151528-baseline');
    expect(CHECKS.health.test(await outputs('health', BOX3), {}, BOX3)).toEqual({ ok: true, findings: [
      'card 1-4 (800MX) is absent',
      'card 1-8 (800MX) is absent',
      'card 1-21 (PSU) is inactive',
      'NO_CMT_SW on software: No committed software',
      'DATETIME_UNCHANGED on system: Datetime unchanged',
      'EQPT_ABSENCE on card 1-8 (CRITICAL), not in baseline 20261108-151528-baseline',
      'RX_LOS on och 1-7-5 (CRITICAL), not in baseline 20261108-151528-baseline',
      'IN_LOS on amplifier 1-1-pa (CRITICAL), not in baseline 20261108-151528-baseline',
      'OUT_LOS on amplifier 1-1-pa (CRITICAL), not in baseline 20261108-151528-baseline',
      'IN_OPTICAL_LOW_FAILURE on port 1-1-line (CRITICAL), not in baseline 20261108-151528-baseline',
      'RX_LOS on transceiver 1-7-4 (CRITICAL), not in baseline 20261108-151528-baseline',
    ] });
  });

  it('the health check on a box with no healthy baseline says so, and warns of a manual config-saving-mode', async () => {
    const box = 'paho-gs2000-06';
    const out = await outputs('health', box);
    expect(CHECKS.health.test(out, {}, box).findings).toEqual([
      'card 1-21 (PSU) is inactive',
      'DATETIME_UNCHANGED on system: Datetime unchanged',
      'no healthy baseline to compare its alarms with: capture one once the box is healthy',
    ]);
    out['show system'].data.state['config-saving-mode'] = 'manual';
    expect(CHECKS.health.test(out, {}, box).findings.at(-1)).toBe('warning: config-saving-mode manual, so a cold reboot loses what was not saved');
  });
});

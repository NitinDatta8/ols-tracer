// The terminals a right-click opens: each a floating window on a new shell of the box (bridge/terminals.mjs), opened in
// show mode, telnetted into a linecard or in engineering mode by typing the catalog's steps (cli.json `terminals`).
import { fillStep } from '../bridge/fill.mjs';
import { byId } from './catalog';
import type { Catalog, Device } from './types';

export type TermKind = 'normal' | 'telnet' | 'engineering';

/** A terminal window: a new shell on `host`, `steps` typed into it first, one line each. */
export interface Term { id: number; host: string; steps: string[]; title: string }

/** A line of the right-click menu: `open` when it can, else `why` it is greyed out. */
export interface TermItem { kind: TermKind; label: string; open?: Omit<Term, 'id'>; why?: string }

const MODE: Record<TermKind, string> = { normal: 'show mode', telnet: 'telnet', engineering: 'engineering mode' };

/**
 * What a right-click on device `d` offers: at the chassis (no `slot`) a terminal in show mode, where the session starts;
 * at a linecard also a telnet into the card and engineering mode. Each one that can't open says why: test equipment, no
 * box IP yet, a card in `noTelnet`, or steps the catalog doesn't have.
 */
export function termItems(cat: Catalog, d: Device, slot?: string): TermItem[] {
  const chassis = byId(cat.chassis, d.chassis);
  const lc = slot ? byId(cat.linecards, d.slots[slot]?.linecard) : undefined;
  const no = d.chassisNo ?? 1;
  const host = d.host?.trim() ?? '';
  const config = cat.cli.terminals;
  const kinds: TermKind[] = lc ? ['normal', 'telnet', 'engineering'] : ['normal'];
  return kinds.map((kind) => {
    const label = kind === 'normal' ? 'Open terminal · show mode' : kind === 'telnet' ? `Telnet to card ${no}-${slot}` : 'Engineering mode';
    const steps = kind === 'normal' ? [] : (config?.[kind] ?? []).map((s) => fillStep(s, { chassis: no, slot }));
    const why = chassis?.tester ? `${chassis.name} is test equipment: no CLI`
      : !host ? 'No box IP yet: open the device and type it in the header'
        : kind === 'telnet' && lc && config?.noTelnet.includes(lc.id) ? `${lc.name} cannot be telnetted into`
          : kind !== 'normal' && !config?.[kind]?.length ? `No ${MODE[kind]} steps in cli.json`
            : steps.includes(null) ? `Slot ${slot} has no number to fill in` : undefined;
    if (why) return { kind, label, why };
    const title = [d.name, host, lc && `card ${no}-${slot} ${lc.name}`, MODE[kind]].filter(Boolean).join(' · ');
    return { kind, label, open: { host, steps: steps as string[], title } };
  });
}

/** The right-click menu at `slot` of device `d`: a card's terminals if a card is there, else the chassis's. */
export function termMenu(cat: Catalog, d: Device, slot?: string | null) {
  const lc = slot ? byId(cat.linecards, d.slots[slot]?.linecard) : undefined;
  return lc && slot
    ? { title: `${d.name} · slot ${slot} · ${lc.name}`, items: termItems(cat, d, slot) }
    : { title: d.name, items: termItems(cat, d) };
}

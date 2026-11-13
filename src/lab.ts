// The lab (bridge/lab.mjs, at /bridge/lab): the fixed lab the app shows everyone, loaded from the bridge on start and
// saved there as it changes. The browser keeps its last copy, shown read-only while the bridge is down. A save names the
// file it was made on, and once the file has changed since (a pull, another view's save) the bridge refuses it and the
// page says to reload. A connected box's sync goes to the bridge, which applies it to its device in the file in one
// write, locked or not. The lock opens with the lab's password, checked against its SHA-256 here: a check, not security.
import { useEffect } from 'react';
import { changes } from '../bridge/changes.mjs';
import { bridge } from './bridge';
import { byId } from './catalog';
import { touches } from './rules';
import { filledLinks, useStore } from './store';
import type { Device, Link, Topology } from './types';

/** Why the lab is read-only while the bridge is down. */
const OFFLINE = 'Bridge not running: the lab is shown as last loaded here, read-only. Start it with npm run bridge';
/** How long after a change the lab is saved, and how often the bridge is asked again while it is down, in ms. */
const SAVE_MS = 500;
const RETRY_MS = 5000;

/** The lab as it was last loaded or saved: what a change is one from. */
let saved: Topology | null = null;
/** The lab's requests, one after another, so each names the mtime the one before it left. */
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(fn: () => Promise<T>) => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};

/** No answer from the bridge: the request failed, or the dev server's proxy found nothing there. */
const down = (r?: Response) => !r || r.status >= 502;

/** The SHA-256 of `text`, in hex, as the lab's lock keeps its password. */
export async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Saves the lab if it changed since it was loaded or saved: refused once the file changed, kept for later while the bridge is down. */
const save = (): Promise<void> => inTurn(async () => {
  const { topology: t, labMtime, readOnly, notify, setLab } = useStore.getState();
  if (!t || t === saved || readOnly || labMtime === null) return;
  const r = await bridge(`lab?mtime=${labMtime}`, JSON.stringify(t), 'PUT').catch(() => undefined);
  if (r?.ok) {
    saved = t;
    return setLab({ labMtime: (await r.json()).mtime });
  }
  if (down(r)) {
    notify('Bridge not running: the lab is not saved yet. Start it with npm run bridge');
    return void setTimeout(save, RETRY_MS);
  }
  const why = (await r!.text()).trim();
  notify(why);
  setLab({ readOnly: why });
});

/** Loads the lab from the bridge, again every 5 s while it is down, and saves it half a second after it changes. */
export function useLab() {
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let later: ReturnType<typeof setTimeout> | undefined;
    let gone = false; // unmounted: what comes back after is not shown
    const load = async () => {
      const r = await bridge('lab').catch(() => undefined);
      if (gone) return;
      const { openLab, setLab } = useStore.getState();
      if (!r?.ok) {
        setLab({ readOnly: down(r) ? OFFLINE : (await r!.text()).trim() });
        retry = setTimeout(load, RETRY_MS);
        return;
      }
      const { topology, mtime } = await r.json();
      if (gone) return;
      openLab(topology, mtime);
      saved = useStore.getState().topology;
    };
    void load();
    const stop = useStore.subscribe((s, was) => {
      if (s.topology === was.topology || s.topology === saved) return;
      clearTimeout(later);
      later = setTimeout(save, SAVE_MS);
    });
    return () => { gone = true; clearTimeout(retry); clearTimeout(later); stop(); };
  }, []);
}

/**
 * Device `id`'s box at `host` as it reports itself: its `slots` and the fibers wired from its strands, `links`, as fill
 * takes them. Applied here, and sent to the bridge, which applies it to the device in the lab file in one write, locked
 * or not. Gives what changed in the file; none, with nothing sent, when the lab here has it already.
 */
export async function syncLab(host: string, id: string, slots: Device['slots'], links: Link[]): Promise<string[]> {
  const before = useStore.getState().topology!;
  const d = byId(before.devices, id);
  const on = (l: Link) => touches(l, { device: id });
  const now = { slots, links: filledLinks(before, id, slots, links).filter(on) };
  if (!d || !changes({ slots: d.slots, links: before.links.filter(on) }, now).length) return [];
  useStore.getState().fill(id, slots, links);
  const after = useStore.getState().topology;
  return inTurn(async () => {
    const r = await bridge(`lab/sync?host=${encodeURIComponent(host)}`, JSON.stringify(now));
    if (!r.ok) throw new Error((await r.text()).trim());
    const { was, mtime, changed } = await r.json();
    const { labMtime, setLab } = useStore.getState();
    // The file was the one this page had: its own sync is no change of someone else's, nor one left to save.
    if (was === labMtime) {
      setLab({ labMtime: mtime });
      if (saved === before) saved = after;
    }
    return changed;
  });
}

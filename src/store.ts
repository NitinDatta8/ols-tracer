import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { byId } from './catalog';
import { catalogFor, streams } from './catalog-vite';
import { fiberError, isStrand, linecardError, pluggableError, touches, validate } from './rules';
import type { BoxState } from './live';
import type { Term } from './terminals';
import type { Device, End, Link, Topology, View } from './types';

/** Where a device goes: into a rack at `index` from the top, or onto the canvas at `x`, `y`. */
export type Place = { rack: string; index: number } | { x: number; y: number };

interface State {
  topology: Topology | null;
  view: View;
  selected: string | null; // device or link id on the canvas
  openDevice: string | null; // device shown in the physical view
  openSlot: string | null; // the linecard it opens at, if any
  terms: Term[]; // the terminal windows open, never saved
  toast: string | null;
  session: number; // bumped on new/open so the canvas remounts and fits the view
  live: BoxState | null; // what the CLI bridge read from the box, never saved

  load: (topology: Topology | null) => void;
  open: (json: string) => void;
  setView: (view: View) => void;
  select: (id: string, on: boolean) => void;
  setOpenDevice: (id: string | null, slot?: string | null) => void;
  openTerm: (term: Omit<Term, 'id'>) => void;
  closeTerm: (id: number) => void;
  notify: (msg: string) => void;
  setLive: (live: BoxState | null) => void;
  addDevice: (chassis: string, x: number, y: number, into?: Extract<Place, { rack: string }>) => void;
  addRack: (x: number, y: number) => void;
  moveRack: (id: string, x: number, y: number) => void;
  deleteRack: (id: string, at?: Record<string, { x: number; y: number }>) => void;
  place: (device: string, to: Place) => void;
  updateDevice: (id: string, patch: Partial<Pick<Device, 'host' | 'x' | 'y' | 'emptyBays'>>) => void;
  deleteDevice: (id: string) => void;
  fill: (device: string, slots: Device['slots'], links?: Link[]) => void;
  insertLinecard: (device: string, slot: string, linecard: string) => void;
  insertPluggable: (device: string, slot: string, port: string, pluggable: string) => void;
  remove: (at: { device: string; slot: string; port?: string }) => void;
  connect: (a: End, b: End) => void;
  deleteLink: (id: string) => void;
  setRoute: (id: string, view: string, route?: NonNullable<Link['routes']>[string]) => void;
}

const nextId = (prefix: string, items: { id: string }[]) =>
  prefix + (Math.max(0, ...items.map((x) => Number(x.id.slice(prefix.length)) || 0)) + 1);

/**
 * Ids renamed since files were saved: linecards C-1, C-9, C-11, MX-4 and MX-8 are now C25, C925, C1125, 400MX and 800MX,
 * and older common chassis ids map to profile-backed slot-count ids.
 */
const RENAMED: Record<string, string> = {
  'lc-c1': 'lc-c25',
  'lc-c9': 'lc-c925',
  'lc-c11': 'lc-c1125',
  'lc-mx4': 'lc-400mx',
  'lc-mx8': 'lc-800mx',
  'ch-2000': 'ch-8slot',
  'ch-2026': 'ch-8slot',
  'ch-2026-4ru': 'ch-16slot',
};
/** Earlier demo streams were corp-a/corp-b; profile-backed streams are now csp/ctc/polaris/tencent/ws. */
const RENAMED_STREAMS: Record<string, string> = { 'corp-a': 'csp', 'corp-b': 'tencent' };
const upgrade = (t: Topology | null) => {
  if (t) t.stream = RENAMED_STREAMS[t.stream] ?? t.stream;
  for (const d of t?.devices ?? []) {
    d.chassis = RENAMED[d.chassis] ?? d.chassis;
    for (const s of Object.values(d.slots)) s.linecard = RENAMED[s.linecard] ?? s.linecard;
  }
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let termId = 0;

/** Takes `device` out of every rack. */
const unrack = (t: Topology, device: string) => { for (const r of t.racks ?? []) r.devices = r.devices.filter((id) => id !== device); };
/** Puts `device` into a rack at `index` (clamped). */
const rackAt = (t: Topology, device: string, { rack, index }: Extract<Place, { rack: string }>) => {
  const r = byId(t.racks ?? [], rack);
  r?.devices.splice(Math.max(0, Math.min(index, r.devices.length)), 0, device);
};

export const useStore = create<State>()(
  persist(
    immer((set, get) => ({
      topology: null,
      view: 'L0',
      selected: null,
      openDevice: null,
      openSlot: null,
      terms: [],
      toast: null,
      session: 0,
      live: null,

      load: (topology) => set((s) => {
        s.topology = topology;
        s.selected = s.openDevice = s.openSlot = null;
        s.session++;
      }),

      open: (json) => {
        try {
          const t = JSON.parse(json) as Topology;
          upgrade(t); // first, so a file of a stream renamed since opens
          if (t.version !== 1 || !streams.some((st) => st.id === t.stream)) throw new Error('bad header');
          validate(t, catalogFor(t.stream)); // only to reject malformed files; problems are listed live in the UI
          get().load(t);
        } catch {
          get().notify('Not a valid .olst.json file for a known stream');
        }
      },

      setView: (view) => set({ view }),

      setLive: (live) => set({ live }),

      select: (id, on) => set((s) => {
        if (on) s.selected = id;
        else if (s.selected === id) s.selected = null;
      }),

      setOpenDevice: (openDevice, openSlot = null) => set({ openDevice, openSlot }),

      openTerm: (term) => set((s) => { s.terms.push({ ...term, id: ++termId }); }),

      closeTerm: (id) => set((s) => { s.terms = s.terms.filter((t) => t.id !== id); }),

      notify: (toast) => {
        set({ toast });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: null }), 4000);
      },

      // A tester is named after itself (BERT-2) and comes with its module in. Dropped on a rack, it goes into it.
      addDevice: (chassis, x, y, into) => set((s) => {
        const id = nextId('d', s.topology!.devices);
        const def = byId(catalogFor(s.topology!.stream).chassis, chassis);
        const slots = Object.fromEntries(Object.entries(def?.comesWith ?? {}).map(([slot, linecard]) => [slot, { linecard, ports: {} }]));
        const name = `${def?.tester ? def.name.split(' ')[0] : 'Site'}-${id.slice(1)}`;
        s.topology!.devices.push({ id, chassis, name, x, y, slots });
        if (into) rackAt(s.topology!, id, into);
      }),

      addRack: (x, y) => set((s) => {
        const t = s.topology!;
        const racks = (t.racks ??= []);
        const id = nextId('r', racks);
        racks.push({ id, name: `Rack-${id.slice(1)}`, x, y, devices: [] });
      }),

      moveRack: (id, x, y) => set((s) => {
        const r = byId(s.topology!.racks ?? [], id);
        if (r) Object.assign(r, { x, y });
      }),

      // Its devices stay on the canvas, at `at` (where they were drawn in it).
      deleteRack: (id, at = {}) => set((s) => {
        const t = s.topology!;
        for (const d of t.devices) if (at[d.id]) Object.assign(d, at[d.id]);
        t.racks = (t.racks ?? []).filter((r) => r.id !== id);
      }),

      place: (device, to) => set((s) => {
        const t = s.topology!;
        unrack(t, device);
        if ('rack' in to) rackAt(t, device, to);
        else Object.assign(byId(t.devices, device) ?? {}, to);
      }),

      updateDevice: (id, patch) => set((s) => {
        const d = byId(s.topology!.devices, id);
        if (d) Object.assign(d, patch);
      }),

      deleteDevice: (id) => set((s) => {
        const t = s.topology!;
        t.devices = t.devices.filter((d) => d.id !== id);
        t.links = t.links.filter((l) => !touches(l, { device: id }));
        unrack(t, id);
        if (s.openDevice === id) s.openDevice = null;
      }),

      // Syncs one device from the box (discover in live.ts) with its inferred wiring (wired in rules.ts).
      fill: (device, slots, links = []) => set((s) => {
        const d = byId(s.topology!.devices, device);
        if (!d) return;
        d.slots = slots;
        const cat = catalogFor(s.topology!.stream);
        const alive = (at: End) => {
          if (at.device !== device) return true;
          const slot = d.slots[at.slot];
          if (!slot) return false;
          const card = byId(cat.linecards, slot.linecard);
          const port = card?.ports.find((p) => p.id === at.port);
          return !!(port && (!port.allowedPluggables.length || slot.ports[at.port]?.pluggable));
        };
        const wanted = new Set(links.map((l) => l.id));
        s.topology!.links = s.topology!.links
          .filter((l) => !(touches(l, { device }) && isStrand(l)))
          .filter((l) => alive(l.a) && alive(l.b))
          .filter((l) => !wanted.has(l.id));
        s.topology!.links.push(...links);
      }),

      insertLinecard: (device, slot, linecard) => {
        const t = get().topology!;
        const d = byId(t.devices, device)!;
        const err = d.slots[slot] ? `Slot ${slot} already has a card` : linecardError(catalogFor(t.stream), d, slot, linecard);
        if (err) return get().notify(err);
        set((s) => { byId(s.topology!.devices, device)!.slots[slot] = { linecard, ports: {} }; });
      },

      insertPluggable: (device, slot, port, pluggable) => {
        const t = get().topology!;
        const card = byId(t.devices, device)!.slots[slot];
        const err = card.ports[port] ? `Port ${port} already has a pluggable` : pluggableError(catalogFor(t.stream), card.linecard, port, pluggable);
        if (err) return get().notify(err);
        set((s) => { byId(s.topology!.devices, device)!.slots[slot].ports[port] = { pluggable }; });
      },

      // Removes a card (no port given) or a pluggable, plus the fibers that ended there.
      remove: (at) => set((s) => {
        const t = s.topology!;
        const slots = byId(t.devices, at.device)!.slots;
        if (at.port) delete slots[at.slot].ports[at.port];
        else delete slots[at.slot];
        t.links = t.links.filter((l) => !touches(l, at));
      }),

      connect: (a, b) => {
        const t = get().topology!;
        const err = fiberError(t, catalogFor(t.stream), a, b);
        if (err) return get().notify(`Fiber refused: ${err}`);
        set((s) => { s.topology!.links.push({ id: nextId('f', t.links), type: 'smf', a, b }); });
      },

      setRoute: (id, view, route) => set((s) => {
        const l = byId(s.topology!.links, id);
        if (!l) return;
        l.routes ??= {};
        if (route) l.routes[view] = route;
        else delete l.routes[view];
      }),

      deleteLink: (id) => set((s) => {
        s.topology!.links = s.topology!.links.filter((l) => l.id !== id);
      }),
    })),
    // Browser autosave: the open topology and the current view. Version 1 has the renamed linecard ids, 2 the renamed chassis.
    {
      name: 'ols-tracer', version: 2, partialize: (s) => ({ topology: s.topology, view: s.view }),
      migrate: (saved) => { const s = saved as Pick<State, 'topology' | 'view'>; upgrade(s.topology); return s; },
    },
  ),
);

/** Catalog of the open project's stream. */
export const useCatalog = () => catalogFor(useStore((s) => s.topology?.stream ?? ''));

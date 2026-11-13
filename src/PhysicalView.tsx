import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { byId, cli } from './catalog';
import { Inside } from './Inside';
import { inside as insideOf, l0Problems, pathsThrough, routesOf } from './l0';
import { discover, light, stateFor, type BoxState } from './live';
import { termLines, useMenu } from './Menu';
import { PipeLayer, type PipeEnds } from './Pipe';
import { procedureItems } from './procedures';
import { ProceduresButton, ProceduresPanel, useProcedures } from './ProcedurePanel';
import { roleOf, toneOf } from './ports';
import { alarms, bays, coverage, fiberable, fiberError, fibersAt, isStrand, linecardError, path, pluggableError, resolve, sameEnd, span, touches, wired } from './rules';
import { bridge, sessionOf } from './bridge';
import { syncLab } from './lab';
import { useCatalog, useLocked, useStore } from './store';
import { BoxTerminal, type Keys } from './Terminal';
import { termMenu } from './terminals';
import type { Alarm, Catalog, CliLevel, Datasheet, End, LinecardDef, Link, PluggableDef, PortDef, Strand, Topology } from './types';

type Drag = { kind: 'card' | 'plug'; id: string };
type At = { slot: string; port?: string };
/**
 * The box's session as the CLI bridge sees it (bridge/server.mjs), and how far its snapshot is while one is being taken.
 * A session is shared: `holders` is how many views and Codex sessions hold it, `held` whether this view is one.
 */
type Box = { state: 'connected' | 'connecting' | 'down'; host?: string; error?: string; snapshot?: { done: number; of: number } | null; holders?: number; held?: boolean };
/** The hardware whose datasheet the inspector shows, and where it sits (for its CLI command). */
type Detail = { kind: 'card' | 'plug'; id: string; at?: At };
/** A level whose alarms to list: {} the chassis, { slot } a card, { slot, port } a port, { bay } a PSU or fan. */
type Where = Pick<Alarm, 'slot' | 'port' | 'bay'>;
/** The strand a fiber is being run from. */
type Wire = { end: End; strand: Strand };

const STRAND: Record<Strand, string> = { tx: 'Tx', rx: 'Rx' };
const OTHER: Record<Strand, Strand> = { tx: 'rx', rx: 'tx' };

/** The fiber between the strand being wired and `end`'s other strand, as [Tx end, Rx end]. */
const ends = (w: Wire, end: End): [End, End] => (w.strand === 'tx' ? [w.end, end] : [end, w.end]);

/**
 * The ports as they sit in the card's 1U slot, the same at the chassis and at the card level: one row of up to five
 * per slot of width, else two rows, the top one the longer (an 800MX's ten ports five over five). Each column is at
 * most `cage` wide, each row at most `row` high.
 */
export const portGrid = (lc: LinecardDef, cage: string, row = '1fr') => {
  const n = lc.ports.length;
  const columns = lc.columns ?? (n > 5 * (lc.width ?? 1) ? Math.ceil(n / 2) : n);
  return { gridTemplate: `repeat(${Math.ceil(n / columns)}, minmax(0, ${row})) / repeat(${columns}, minmax(0, ${cage}))` };
};

/** The form factors a port takes, e.g. "QSFP / QSFPDD"; none for a fixed LC connector. */
const takes = (cat: Catalog, p: PortDef) => [...new Set(p.allowedPluggables.map((a) => byId(cat.pluggables, a)?.formFactor ?? a))].join(' / ');

/** A link as is, or a file under public/. */
const asset = (path: string) => (/^https?:/.test(path) ? path : import.meta.env.BASE_URL + path);

/** Product photo, else a placeholder with its form factor and speed (or "No image"). */
const Pic = ({ p, big }: { p: Datasheet & { name: string; formFactor?: string; speed?: string }; big?: boolean }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [p.image]);
  if (p.image && !failed) {
    return <img className={`pic${big ? ' big' : ''}`} src={asset(p.image)} alt={p.name} draggable={false} onError={() => setFailed(true)} />;
  }
  return <div className={`pic none${big ? ' big' : ''}`}><b>{p.formFactor ?? 'No image'}</b>{p.speed && <small>{p.speed}</small>}</div>;
};

/** A strand's key for the pipes drawn over the faceplate. */
const pin = (e: End, s: Strand) => `${s}:${e.slot}/${e.port}`;

/**
 * Duplex LC: the Tx and Rx connectors, each lit while a fiber is on it; the tooltip says where it goes or comes from.
 * A fiber drawn as a pipe leaves a Tx and lands on an Rx. With `far`, each also says it: "Tx → 3/C1", "Rx ← 3/C2".
 */
const Strands = ({ t, end, onClick, far }: { t: Topology; end: End; onClick: (e: MouseEvent, s: Strand) => void; far?: (e: End) => string }) => {
  const at = fibersAt(t, end);
  return (
    <div className="lc">
      {(['tx', 'rx'] as const).map((s) => {
        const l = at[s];
        return (
          <span key={s} className={`strand wire${l ? ' lit' : ''}`} data-pipe-end={pin(end, s)} onClick={(e) => onClick(e, s)}
            title={l ? `${path(t, l.a)} Tx → ${path(t, l.b)} Rx` : `${STRAND[s]}: no fiber`}>
            {STRAND[s]}{far && l && (sameEnd(l.a, l.b) ? ' ↺ loop' : s === 'tx' ? ` → ${far(l.b)}` : ` ← ${far(l.a)}`)}
          </span>
        );
      })}
    </div>
  );
};

/** Where an alarm is raised: 3/C1, or a back bay such as PSU2. */
const place = (a: Alarm) => a.bay ?? `${a.slot}/${a.port}`;

/** Only there when there are alarms: a bell with their count, red if one is critical. Clicking it lists them. */
export function AlarmButton({ list, onOpen }: { list: Alarm[]; onOpen?: () => void }) {
  if (!list.length) return null;
  return (
    <button className={`alarm ${list.some((a) => a.severity === 'critical') ? 'critical' : 'major'}`}
      title={list.map((a) => `${place(a)} ${a.text}`).join('\n')} onClick={onOpen && ((e) => { e.stopPropagation(); onOpen(); })}>
      <svg viewBox="0 0 24 24" width="11" height="11"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
      {list.length}
    </button>
  );
}

/** Generic drawings of the units at the back, like the rest of the physical view. */
const FanIcon = () => (
  <svg viewBox="-20 -20 40 40" width="64" height="64">
    <circle r="19" fill="none" stroke="#52606d" strokeWidth="2" />
    {[20, 110, 200, 290].map((r) => <ellipse key={r} cy="-9" rx="4" ry="8" fill="#9aa5b1" transform={`rotate(${r})`} />)}
    <circle r="3" fill="#cbd2d9" />
  </svg>
);
const PsuIcon = () => <svg viewBox="0 0 24 24" width="48" height="48"><path d="M13 2 3 14h9l-1 8 10-12h-9z" fill="#fbbf24" /></svg>;

/** Management ports, one under the other in a strip as narrow as an RJ-45 jack: USB-C drawn as such, the rest as RJ-45. */
export const MgmtStrip = ({ ports }: { ports?: string[] }) => !ports?.length ? null : (
  <div className="mgmt">
    {ports.map((id) => (
      <div key={id} className="mgmt-port" title={id.startsWith('USB') ? `${id} port` : `${id} · RJ-45 Ethernet`}>
        {id.startsWith('USB')
          ? <svg viewBox="0 0 24 10" width="24" height="10"><rect x="1" y="1" width="22" height="8" rx="4" fill="#111820" stroke="#9aa5b1" /><rect x="6" y="4" width="12" height="2" rx="1" fill="#9aa5b1" /></svg>
          : <svg viewBox="0 0 24 22" width="24" height="22"><path d="M1 1h22v15h-6v5H7v-5H1z" fill="#111820" stroke="#9aa5b1" /><path d="M5 4v3M8 4v3M11 4v3M13 4v3M16 4v3M19 4v3" stroke="#facc15" /></svg>}
        <small>{id}</small>
      </div>
    ))}
  </div>
);

/**
 * Like Packet Tracer's Physical tab, two levels deep: the chassis shows its slot grid, each linecard with a mini
 * cage per port so what is plugged in shows at a glance, and clicking a linecard shows the whole faceplate.
 * Every level has the same fixed layout: the parts to put in (linecards or pluggables) as icons across the top, the
 * faceplate filling the area under them, and the CLI terminal and the inspector at the bottom. Rear turns the chassis
 * round to its PSU and fan bays.
 * Hovering a pluggable shows its part and photo; clicking it opens its datasheet in the inspector.
 * Each card, port, PSU or fan with alarms shows a bell; clicking it lists them in the inspector, which otherwise lists
 * the alarms of the level shown.
 * The CLI line at the bottom shows the command for what is hovered, else for the level shown.
 */
/**
 * Scales the element's only child up as far as its proportions allow, then stretches it the rest of the way, so it
 * fills the element edge to edge and never scrolls: the child reads --fit-w and --fit-h, the element's size before
 * scaling. Measured after every render, since what is drawn changes the child's natural size.
 */
function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0, k: 1 });
  const measure = useCallback(() => {
    const outer = ref.current, inner = outer?.firstElementChild as HTMLElement | null;
    if (!outer || !inner) return;
    const style = inner.style.cssText;
    inner.style.cssText = ''; // its natural size
    const [w, h, W, H] = [inner.offsetWidth, inner.offsetHeight, outer.clientWidth, outer.clientHeight];
    inner.style.cssText = style;
    const k = Math.min(W / w, H / h);
    setFit((f) => (f.k === k && f.w === W / k && f.h === H / k ? f : { w: W / k, h: H / k, k }));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);
  return [ref, fit.w ? { '--fit-w': `${fit.w}px`, '--fit-h': `${fit.h}px`, transform: `scale(${fit.k})` } as CSSProperties : undefined] as const;
}

const NO_BRIDGE: Box = { state: 'down', error: 'Bridge not running: npm run bridge' };

/**
 * The session with `host`, checked every 5 s while the view is open (every second while it connects). Closing the view
 * or the page leaves it if this view holds it: it closes then only if no one else holds it.
 */
function useBox(host: string) {
  const [box, setBox] = useState<Box>(NO_BRIDGE);
  const check = useCallback(() => { if (host) bridge(`status?${sessionOf(host)}`).then((r) => r.json()).then(setBox, () => setBox(NO_BRIDGE)); }, [host]);
  useEffect(() => {
    check();
    const id = setInterval(check, box.state === 'connecting' ? 1000 : 5000);
    return () => clearInterval(id);
  }, [check, box.state]);
  const leave = useRef(() => {});
  const held = !!box.held && box.host === host;
  useEffect(() => { leave.current = held ? () => void bridge(`disconnect?${sessionOf(host)}`, '').catch(() => {}) : () => {}; }, [held, host]);
  useEffect(() => {
    const gone = () => leave.current();
    window.addEventListener('pagehide', gone);
    return () => { window.removeEventListener('pagehide', gone); gone(); };
  }, []);
  return [box, check] as const;
}

/** The box's light, fetched while the view is open: fast while connected, else from the last run on disk. */
function useLight(host: string, state: Box['state']) {
  useEffect(() => {
    const { setLive } = useStore.getState();
    if (!host) return void setLive(null);
    const get = () => bridge(`state?host=${encodeURIComponent(host)}`).then((r) => r.json()).then(setLive, () => setLive(null));
    get();
    const id = setInterval(get, state === 'connected' ? 2000 : 10000);
    return () => clearInterval(id);
  }, [host, state]);
}

/** A strand of the box's fiber map (its wiring.csv, through the bridge), to mark as pulled. */
interface BoxStrand { strand: string; from: string; to: string; via: string; notes?: string }

/** The box's strands, fetched once the current snapshot is done: none while down, or while commands are still running. */
function useStrands(host: string, state: Box['state'], snapshot?: Box['snapshot']) {
  const [strands, setStrands] = useState<BoxStrand[] | null>(null);
  useEffect(() => {
    let gone = false;
    if (state !== 'connected') {
      setStrands(null);
      return () => { gone = true; };
    }
    if (snapshot) return () => { gone = true; };
    const get = () => bridge(`wiring?host=${encodeURIComponent(host)}`).then((r) => r.json()).then((s) => { if (!gone) setStrands(s); }, () => { if (!gone) setStrands([]); });
    get();
    const id = setInterval(get, 2000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [host, state, snapshot]);
  return strands;
}

/** The box's hostname, as its show system names it, or null. */
const hostnameOf = (s: BoxState | null) => s?.commands['show system']?.raw?.match(/^hostname\s+(\S+)/m)?.[1] ?? null;

/** Where the light on the fibers comes from: the box now, its last run, or nowhere. */
const lightLabel = (s: BoxState | null) => !s ? 'No light data for this box'
  : s.live ? 'Live' : `Last state · ${new Date(s.at ?? 0).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
const syncLabel = (at: number) => `Live sync · ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

export function PhysicalView() {
  const t = useStore((s) => s.topology)!;
  const live = useStore((s) => s.live);
  const openId = useStore((s) => s.openDevice);
  const [stage, fit] = useFit();
  const cat = useCatalog();
  // Slot of the linecard being shown: the one clicked in a rack, else none; a tester opens at its card, its two ports
  // being all there is to it.
  const [cardSlot, setCardSlot] = useState<string | null>(() => {
    const d = byId(t.devices, openId ?? undefined);
    const slot = useStore.getState().openSlot;
    if (slot && d?.slots[slot]) return slot;
    return (byId(cat.chassis, d?.chassis)?.tester && Object.keys(d?.slots ?? {})[0]) || null;
  });
  const [menuAt, menu] = useMenu(); // right-click: terminals in their own windows, and procedures
  const [inner, setInner] = useState(false); // an L0 card is shown from the inside, not its ports
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tip, setTip] = useState<{ p: PluggableDef; x: number; y: number; up: boolean } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null); // datasheet in the side panel
  const [focus, setFocus] = useState<At | null>(null); // hovered slot or port, for the CLI strip
  const [wire, setWire] = useState<Wire | null>(null);
  const [back, setBack] = useState(false); // chassis seen from the back: PSUs and fans
  const [alarmsFor, setAlarmsFor] = useState<Where | null>(null); // level whose alarms the side panel lists
  const host = byId(t.devices, openId ?? undefined)?.host?.trim() ?? ''; // the opened device's box
  const [box, checkBox] = useBox(host);
  useLight(host, box.state);
  // The Procedures panel, open at the chassis or a card (`slot`), with the one picked in the right-click menu.
  const [procs, setProcs] = useState<{ pick: string | null; slot: string | null } | null>(null);
  const opened = byId(t.devices, openId ?? undefined);
  const [procsGot, refreshProcs] = useProcedures(byId(cat.chassis, opened?.chassis)?.tester ? '' : host, box.host === host && box.state === 'connected', !!procs);
  const strands = useStrands(host, box.state, box.snapshot);
  const inferredPower = (strands ?? []).some((s) => /power fallback/i.test(s.notes ?? ''));
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [pulled, setPulled] = useState(''); // the strand picked to mark as pulled
  const keys = useRef<Keys>(null); // types into the CLI terminal
  const { setOpenDevice, updateDevice, insertLinecard, insertPluggable, remove, notify, connect, deleteLink } = useStore.getState();
  const locked = useLocked(); // the lab's layout: the box IP is part of it
  const synced = useRef(''); // this session's last synced snapshot for the opened device

  // While connected, keeps the opened device in sync with what the box reports once its current snapshot is complete,
  // here and in the lab file, locked or not (syncLab), and toasts what changed.
  useEffect(() => {
    if (box.state !== 'connected') {
      synced.current = '';
      setLastSyncAt(null);
    }
    const d = byId(t.devices, openId ?? undefined);
    const s = stateFor(live, d);
    if (!d || !s?.live) return;
    const found = discover(cat, d, s);
    if (!found || !strands || box.snapshot) return;
    const signature = JSON.stringify({ device: d.id, slots: found.slots, strands });
    if (signature === synced.current) return;
    const base = { ...t, links: t.links.filter((l) => !(touches(l, { device: d.id }) && isStrand(l))) };
    const { links, refused } = wired(cat, base, { ...d, slots: found.slots }, strands);
    synced.current = signature;
    setLastSyncAt(Date.now());
    const notes = `${found.missing.length ? `. Left out (not mapped from show inventory): ${found.missing.join(', ')}` : ''}${refused.map((r) => `. Fiber ${r}`).join('')}`;
    syncLab(host, d.id, found.slots, links).then((changed) => {
      if (changed.length || notes) notify(`Synced from the box${changed.length ? `: ${changed.join(', ')}` : ''}${notes}`);
    }, (e: Error) => notify(`Synced from the box, but not into the lab file: ${e.message}`));
  }, [box.state, box.snapshot, live, t, openId, cat, notify, strands, host]);

  // Escape goes up one level: fiber being run → picked part or side panel → linecard → chassis → canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (procs) setProcs(null);
      else if (wire) setWire(null);
      else if (detail || alarmsFor) { setDetail(null); setAlarmsFor(null); }
      else if (cardSlot) setCardSlot(null);
      else setOpenDevice(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [procs, wire, detail, alarmsFor, cardSlot, setOpenDevice]);

  // The hovered element, the level whose alarms were listed, and the Procedures panel opened there, are gone once the
  // level or side changes.
  useEffect(() => { setFocus(null); setWire(null); setAlarmsFor(null); setTip(null); setInner(false); setProcs(null); }, [cardSlot, back]);

  const device = byId(t.devices, openId ?? undefined);
  if (!device) return null;
  const chassis = byId(cat.chassis, device.chassis);
  const slots = chassis?.slots ?? [];
  const columns = chassis?.columns ?? slots.length;
  const ru = Math.ceil(slots.length / columns) || 1; // drawn one rack unit (1U) high per row of slots
  const card = cardSlot ? byId(cat.linecards, device.slots[cardSlot]?.linecard) : undefined;
  const builtIn = card && !card.ports.some((p) => p.allowedPluggables.length); // a card with fixed ports only
  const tester = !!chassis?.tester; // test equipment: no box to connect to, no CLI
  const command = (level: CliLevel, at?: At) => (tester ? '' : cli(cat, level, { chassis: device.chassisNo ?? 1, ...at }));
  const boxState = stateFor(live, device);
  const lightOf = (l: Link) => light(boxState, t, l, cat);
  const at = focus ?? (cardSlot ? { slot: cardSlot } : undefined);
  const strip = command(at?.port ? 'port' : at ? 'card' : 'chassis', at);

  /** The bridge's session with this device's box: down unless there is one. */
  const here: Box = host && box.host === host ? box
    : { state: 'down', error: host ? `Not connected to ${host}: click Connect` : 'Enter the box IP, then Connect' };
  const linked = !!here.held; // this view holds the session, connected or trying to
  /** Who else holds the session, so Disconnect leaves it open for them. */
  const others = (here.holders ?? 0) - (linked ? 1 : 0);
  /** Connecting to an empty device, or connected before its cards have come in: the chassis waits, greyed out. */
  const fetching = here.state !== 'down' && !Object.keys(device.slots).length && !(boxState?.live && discover(cat, device, boxState));
  const connectBox = () => {
    if (host) bridge(`${linked ? 'disconnect' : 'connect'}?${sessionOf(host)}`, '').then(checkBox, () => notify(NO_BRIDGE.error!));
  };
  /** Labels a pull for scoring: the bridge takes a snapshot of the box with the strand's answer.json in its run. */
  const markPull = () => bridge(`pull?host=${encodeURIComponent(host)}`, pulled).then(async (r) => {
    notify(r.ok ? `${pulled} marked as pulled: a snapshot with its answer.json is being recorded` : await r.text());
    if (r.ok) setPulled('');
  }, () => notify(NO_BRIDGE.error!));

  /**
   * Right-click a card (or anywhere at a card) for its terminals and procedures, anywhere else for the chassis's. A
   * procedure picked opens the Procedures panel at it, to check its params and lines before it runs.
   */
  const stageMenu = (e: MouseEvent) => {
    const slot = (e.target as Element).closest('[data-slot]')?.getAttribute('data-slot') ?? cardSlot;
    const { title, items } = termMenu(cat, device, slot);
    const at = slot && byId(cat.linecards, device.slots[slot]?.linecard) ? slot : null;
    const level = at ? 'card' : 'chassis';
    const procedures = procedureItems(procsGot.list, { level, tester, connected: here.state === 'connected' }).filter((i) => i.def.level === level)
      .map(({ def, why }) => ({ key: `procedure ${def.id}`, label: `${def.label}…`, why, pick: why ? undefined : () => setProcs({ pick: def.id, slot: at }) }));
    menuAt(e, { title, items: [...termLines(items), ...procedures] });
  };

  /** "3", or "1–2" for a card that spans slots. */
  const slotLabel = (slot: string, width?: number) => {
    const ids = (chassis && span(chassis, slot, width)) ?? [slot];
    return ids.length > 1 ? `${ids[0]}–${ids.at(-1)}` : slot;
  };

  const all = alarms(t, cat, device);
  /** The alarms at a level and below it. */
  const alarmsAt = (w: Where) => all.filter((a) => (Object.keys(w) as (keyof Where)[]).every((k) => a[k] === w[k]));
  const alarmButton = (w: Where) => <AlarmButton list={alarmsAt(w)} onOpen={() => { setDetail(null); setAlarmsFor(w); }} />;
  /** The side panel shows one thing: a datasheet or a level's alarms. */
  const show = (kind: Detail['kind'], id: string, at?: At) => { setAlarmsFor(null); setDetail({ kind, id, at }); };
  /**
   * The part being dragged, else the one picked in the tray (its datasheet is shown, not from where it sits): the slots
   * or ports it fits light up green, and clicking one puts it there.
   */
  const part: Drag | null = drag ?? (detail && !detail.at ? { kind: detail.kind, id: detail.id } : null);
  /** Clicking a part in the tray picks it, or drops the pick if it was picked. */
  const pick = (kind: Drag['kind'], id: string) => (part?.kind === kind && part.id === id ? setDetail(null) : show(kind, id));
  /** Runs the command on the box: types it into the CLI terminal, then Enter. */
  const runOnBox = (command: string) => keys.current?.type(command + '\r');
  const shown = (kind: Detail['kind'], id: string) => detail?.kind === kind && detail.id === id;
  /** Up to the chassis, seen from the front or the back. */
  const side = (b: boolean) => { setCardSlot(null); setDetail(null); setBack(b); };

  const psus = bays('PSU', chassis?.psus);
  const fans = bays('FAN', chassis?.fans);
  /** Pull a PSU or fan out of its bay, or put it back. */
  const fitBay = (bay: string, fitted: boolean) => {
    const empty = device.emptyBays ?? [];
    updateDevice(device.id, { emptyBays: fitted ? empty.filter((b) => b !== bay) : [...empty, bay] });
  };

  const removeAt = (slot: string, port?: string) => {
    const n = t.links.filter((l) => touches(l, { device: device.id, slot, port })).length;
    if (!n || confirm(`This also deletes ${n} fiber${n > 1 ? 's' : ''}. Continue?`)) remove({ device: device.id, slot, port });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const el = e.target as Element;
    const slot = el.closest('[data-slot]')?.getAttribute('data-slot');
    const port = el.closest('[data-port]')?.getAttribute('data-port');
    setDrag(null);
    if (drag?.kind === 'card' && slot) insertLinecard(device.id, slot, drag.id);
    else if (drag?.kind === 'plug' && cardSlot && port) insertPluggable(device.id, cardSlot, port, drag.id);
    else if (drag) notify(drag.kind === 'card' ? 'Drop the linecard on a slot' : 'Drop the pluggable on a port');
  };

  /** Click a free Tx (or Rx) to start a fiber, then a free Rx (or Tx) to land it; clicking a lit one removes its fiber. */
  const onStrand = (e: MouseEvent, end: End, strand: Strand) => {
    e.stopPropagation();
    const link = fibersAt(t, end)[strand];
    if (wire) {
      if (wire.strand !== strand) connect(...ends(wire, end));
      else if (!sameEnd(wire.end, end)) return notify(`A fiber runs from a Tx to an Rx: click an ${STRAND[OTHER[wire.strand]]}`);
      setWire(null);
    } else if (link) {
      if (confirm(`Remove fiber ${path(t, link.a)} Tx → ${path(t, link.b)} Rx?`)) deleteLink(link.id);
    } else if (!fiberable(t, cat, end)) notify(`${path(t, end)} has no pluggable`);
    else setWire({ end, strand });
  };
  /** Every port whose other strand a fiber from `w` could land on, this chassis first. */
  const freePorts = (w: Wire) =>
    [device, ...t.devices.filter((d) => d !== device)].flatMap((d) => Object.entries(d.slots).flatMap(([slot, s]) =>
      (byId(cat.linecards, s.linecard)?.ports ?? []).map((p) => ({ device: d.id, slot, port: p.id }))))
      .filter((e) => !fiberError(t, cat, ...ends(w, e)));
  /** Far end label: just slot/port when it is on this chassis. */
  const farLabel = (far: End) => (far.device === device.id ? `${far.slot}/${far.port}` : path(t, far));

  /** A linecard as a small tile: its name over its width and port count. */
  const cardTile = (lc: LinecardDef) => (
    <div key={lc.id} className={`tile${shown('card', lc.id) ? ' on' : ''}`} draggable
      title={`${lc.name} · ${lc.width ?? 1} slot${(lc.width ?? 1) > 1 ? 's' : ''} · ${lc.ports.length} port${lc.ports.length > 1 ? 's' : ''}`}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lc.id); setDrag({ kind: 'card', id: lc.id }); }}
      onDragEnd={() => setDrag(null)}
      onClick={() => pick('card', lc.id)}>
      <b>{lc.name}</b>
      <small>{lc.width ?? 1} slot{(lc.width ?? 1) > 1 ? 's' : ''} · {lc.ports.length} port{lc.ports.length > 1 ? 's' : ''}</small>
    </div>
  );

  const chassisLevel = () => {
    const taken = coverage(cat, device);
    return (
      <div className="faceplate rack-view" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="rack" style={{ '--u': ru } as CSSProperties}>
        <MgmtStrip ports={chassis?.mgmtPorts?.front} />
        <div className="slots" style={{ gridTemplate: `repeat(${ru}, 1fr) / repeat(${columns}, 1fr)` }}>
          {slots.map((slot, i) => {
            const state = device.slots[slot.id];
            if (!state && taken.has(slot.id)) return null; // under a wide card to its left
            const lc = byId(cat.linecards, state?.linecard);
            const fits = part?.kind === 'card' && !state && !linecardError(cat, device, slot.id, part.id);
            return (
              <div key={slot.id} data-slot={slot.id} className={`slot${state ? ' filled' : ''}${fits ? ' fits' : ''}`}
                style={{ gridColumn: `${(i % columns) + 1} / span ${lc?.width ?? 1}`, gridRow: Math.floor(i / columns) + 1 }}
                onClick={state ? () => setCardSlot(slot.id) : fits ? () => insertLinecard(device.id, slot.id, part.id) : undefined}
                onMouseEnter={state ? () => setFocus({ slot: slot.id }) : undefined} onMouseLeave={() => setFocus(null)}>
                <div className="cage-head">
                  <b>{state ? (lc?.name ?? `unknown ${state.linecard}`) : 'empty'}</b>
                  <small>slot {slotLabel(slot.id, lc?.width)}</small>
                  {alarmButton({ slot: slot.id })}
                  {state && <span className="remove" onClick={(e) => { e.stopPropagation(); removeAt(slot.id); }}>✕</span>}
                </div>
                {lc ? (
                  <div className="port-grid" style={portGrid(lc, '52px')}>
                    {lc.ports.map((p) => {
                      const end = { device: device.id, slot: slot.id, port: p.id };
                      const { pluggable } = resolve(t, cat, end);
                      const from = wire && sameEnd(wire.end, end);
                      const target = wire && !fiberError(t, cat, ...ends(wire, end));
                      return (
                        <div key={p.id} className={`mini ${toneOf(p)}${pluggable ? ' filled' : ''}${from ? ' wiring' : ''}${target ? ' fits' : ''}`}
                          data-pipe-box {...hoverable(pluggable)}
                          onClick={pluggable ? (e) => { e.stopPropagation(); show('plug', pluggable.id, { slot: slot.id, port: p.id }); } : undefined}>
                          {/* The cage, labelled with its port: a module in it, empty, or a fixed LC connector, as at the card. */}
                          <small className={`face${pluggable ? ' in' : p.allowedPluggables.length ? '' : ' lc'}`}>{p.id}</small>
                          <Strands t={t} end={end} onClick={(e, s) => onStrand(e, end, s)} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <small className="far">{fits ? (drag ? 'drop here' : 'click to insert') : 'drag a linecard here'}</small>
                )}
              </div>
            );
          })}
        </div>
        </div>
        {/* Fibers between two cards of this chassis, and loopbacks; the rest show their far end in the strand's tooltip. */}
        <PipeLayer view={`chassis:${device.id}`} spacing={{ margin: 2, lane: 7, hop: 3 }} width={5} light={lightOf}
          ends={t.links.filter((l) => l.a.device === device.id && l.b.device === device.id).map((link) => ({ link, a: pin(link.a, 'tx'), b: pin(link.b, 'rx') }))} />
      </div>
    );
  };

  const tipAt = (e: MouseEvent, p?: PluggableDef) => {
    const r = e.currentTarget.getBoundingClientRect();
    const up = r.bottom + 120 > window.innerHeight; // no room below: show it above
    setTip(p && !drag ? { p, x: r.left, y: up ? r.top - 6 : r.bottom + 6, up } : null);
  };
  /** `at` also points the CLI strip at that port while hovered. */
  const hoverable = (p?: PluggableDef, at?: At) => ({
    onMouseEnter: (e: MouseEvent) => { tipAt(e, p); if (at) setFocus(at); },
    onMouseLeave: () => { setTip(null); if (at) setFocus(null); },
  });

  /**
   * The linecard's slot enlarged to fill the stage: the same rows of ports as at the chassis, each cage big enough to
   * show what is plugged in, and no bigger than 280 × 200 px, so cages look alike from card to card.
   */
  const cardLevel = (slotId: string, lc: LinecardDef) => {
    // The card's fibers, in port order: out of a Tx or into an Rx, each piped to a terminal for its far end under
    // the card (its arrows then flow up into the Rx). A loopback runs from the port's Tx to its own Rx.
    const fibers = lc.ports.flatMap((p): (PipeEnds & { far?: End })[] => {
      const end = { device: device.id, slot: slotId, port: p.id };
      const { tx, rx } = fibersAt(t, end);
      if (tx && tx === rx) return [{ link: tx, a: pin(end, 'tx'), b: pin(end, 'rx') }];
      return [
        ...(tx ? [{ link: tx, a: pin(end, 'tx'), b: `far:${tx.id}`, far: tx.b }] : []),
        ...(rx ? [{ link: rx, a: pin(end, 'rx'), b: `far:${rx.id}`, far: rx.a, reverse: true }] : []),
      ];
    });
    return (
      <div className="faceplate card-plate" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="plate-label" title="Datasheet" onClick={() => show('card', lc.id, { slot: slotId })}>
          <b>{lc.name}</b>
          <small>slot {slotLabel(slotId, lc.width)} · {lc.ports.length} ports</small>
          {/* The other cards are not shown here, so the far end is picked from a list. Always there, so the plate never shifts. */}
          <label className="connect-to" onClick={(e) => e.stopPropagation()}>
            {wire && (
              <>
                {wire.strand === 'tx' ? `Fiber from ${farLabel(wire.end)} Tx to` : `Fiber into ${farLabel(wire.end)} Rx from`}
                <select autoFocus value="" onChange={(e) => { const [d, slot, port] = e.target.value.split('|'); connect(...ends(wire, { device: d, slot, port })); setWire(null); }}>
                  <option value="" disabled>pick a free {STRAND[OTHER[wire.strand]]}…</option>
                  {freePorts(wire).map((e) => (
                    <option key={path(t, e)} value={`${e.device}|${e.slot}|${e.port}`}>{path(t, e)} {STRAND[OTHER[wire.strand]]}</option>
                  ))}
                </select>
                <button onClick={() => setWire(null)}>Cancel</button>
              </>
            )}
          </label>
          {routesOf(lc).length > 0 && (
            <span className="seg" onClick={(e) => e.stopPropagation()}>
              <button className={inner ? '' : 'on'} onClick={() => setInner(false)}>Ports</button>
              <button className={inner ? 'on' : ''} onClick={() => setInner(true)}>Inside</button>
            </span>
          )}
          {alarmButton({ slot: slotId })}
          <span className="led" />
        </div>
        {inner ? (
          <Inside rows={insideOf(t, cat, boxState, device, slotId)} paths={pathsThrough(t, cat, boxState, device, slotId)} state={boxState}
            problems={boxState ? l0Problems(t, cat, boxState, device) : []} />
        ) : (
        <div className="cages port-grid" style={portGrid(lc, '280px', '200px')}>
          {lc.ports.map((p) => {
            const end = { device: device.id, slot: slotId, port: p.id };
            const { pluggable } = resolve(t, cat, end);
            const inserted = device.slots[slotId].ports[p.id];
            const fits = part?.kind === 'plug' && !inserted && !pluggableError(cat, lc.id, p.id, part.id);
            const fixed = !p.allowedPluggables.length;
            return (
              <div key={p.id} data-port={p.id} className={`cage ${toneOf(p)}${fits ? ' fits' : ''}${pluggable ? ' filled' : ''}${wire && sameEnd(wire.end, end) ? ' wiring' : ''}`}
                data-pipe-box {...hoverable(pluggable, { slot: slotId, port: p.id })}
                onClick={pluggable ? () => show('plug', pluggable.id, { slot: slotId, port: p.id }) : fits ? () => insertPluggable(device.id, slotId, p.id, part.id) : undefined}>
                <div className="cage-head">
                  <b>{p.id}</b><small>{roleOf(p)}</small>
                  {alarmButton({ slot: slotId, port: p.id })}
                  {inserted &&<span className="remove" onClick={(e) => { e.stopPropagation(); removeAt(slotId, p.id); }}>✕</span>}
                </div>
                {/*
                  * The cage's face, as at the chassis: the module in it with its part on the label (over its photo, if
                  * there is one), else the empty cage with what it takes, else the fixed LC connector.
                  */}
                <div className={`face${pluggable ? ' in' : fixed ? ' lc' : ''}`}>
                  {pluggable?.image && <img src={asset(pluggable.image)} alt="" draggable={false} onError={(e) => { e.currentTarget.hidden = true; }} />}
                  <b>{pluggable?.name ?? (fixed ? 'LC' : inserted ? `unknown ${inserted.pluggable}` : 'empty')}</b>
                  <small>{pluggable ? `${pluggable.formFactor} · ${pluggable.speed}` : fixed ? 'built-in' : takes(cat, p)}</small>
                </div>
                <Strands t={t} end={end} onClick={(e, s) => onStrand(e, end, s)} far={farLabel} />
              </div>
            );
          })}
        </div>
        )}
        {/* Always there, so the card does not grow when it is fibered. */}
        <div className="terminals">
          {!inner && fibers.map(({ link, far, reverse }) => far && (
            <div key={link.id} className="terminal" data-pipe-box data-pipe-end={`far:${link.id}`} data-pipe-top title={path(t, far)}>
              {reverse ? `← ${farLabel(far)} Tx` : `→ ${farLabel(far)} Rx`}
            </div>
          ))}
        </div>
        {!inner && <PipeLayer view={`card:${device.id}/${slotId}`} spacing={{ margin: 10, lane: 18, hop: 9 }} width={14} ends={fibers} light={lightOf} />}
      </div>
    );
  };

  /** One PSU or fan bay. ✕ pulls the unit out, which raises an alarm; Insert puts it back. */
  const bayBox = (bay: string) => {
    const fitted = !device.emptyBays?.includes(bay);
    const psu = psus.includes(bay);
    return (
      <div key={bay} className={`bay${fitted ? ' filled' : ''}`}>
        <div className="cage-head">
          <b>{bay}</b><small>{psu ? 'power supply' : 'fan tray'}</small>
          {alarmButton({ bay })}
          {fitted && <span className="remove" onClick={() => fitBay(bay, false)}>✕</span>}
        </div>
        {fitted ? (psu ? <PsuIcon /> : <FanIcon />) : <button onClick={() => fitBay(bay, true)}>Insert {psu ? 'PSU' : 'fan'}</button>}
      </div>
    );
  };

  /** The back of the chassis, left to right: the NMS ports, the PSUs one above the other, then the fans. */
  const backLevel = () => (
    <div className="faceplate rack-view">
      <div className="rack" style={{ '--u': ru } as CSSProperties}>
        <MgmtStrip ports={chassis?.mgmtPorts?.back} />
        {psus.length > 0 && <div className="psus">{psus.map(bayBox)}</div>}
        {fans.map(bayBox)}
      </div>
    </div>
  );

  /** The parts to drag in, in one strip under the faceplate: linecards for the chassis, pluggables (DCOs apart) for a card. */
  const tray = () => {
    const supportedByCard = card && new Set(
      cat.pluggables
        .filter((plug) => card.ports.some((port) => port.allowedPluggables.some((a) => a === plug.id || a === plug.formFactor)))
        .map((plug) => plug.id),
    );
    const pluggables = card ? cat.pluggables.filter((plug) => supportedByCard?.has(plug.id)) : [];
    const groups = card
      ? Object.entries(Object.groupBy(pluggables, (p) => (p.dco ? 'DCO · digital coherent optics' : 'Pluggable optics'))).map(([group, plugs]) => [group, plugs?.map((p) => (
        <div key={p.id} className={`tile${p.dco ? ' dco' : ''}${shown('plug', p.id) ? ' on' : ''}`} draggable {...hoverable(p)}
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setTip(null); setDrag({ kind: 'plug', id: p.id }); }}
          onDragEnd={() => setDrag(null)}
          onClick={() => pick('plug', p.id)}>
          <b>{p.name}</b>
          <small>{[p.formFactor, p.speed].filter(Boolean).join(' · ')}</small>
        </div>
      ))] as const)
      : [['Linecards', cat.linecards.filter((lc) => slots.some((s) => s.allowedLinecards.includes(lc.id))).map(cardTile)] as const];
    // Always there, so the faceplate keeps its size: a card with built-in ports and the back get a note instead.
    const note = back ? 'Nothing to drag in at the rear.'
      : builtIn ? `${card.name} has built-in ports: nothing to plug in.`
        : card && !pluggables.length ? `No pluggables are defined yet for ${card.name}.` : '';
    return (
      <div className="tray">
        {note ? <p className="muted">{note}</p> : groups.map(([group, tiles]) => (
          <section key={group}>
            <h4>{group}</h4>
            <div className="tiles">{tiles}</div>
          </section>
        ))}
      </div>
    );
  };

  /** The datasheet shown: the item, its tag, its key facts (before its specs) and the CLI command for where it sits. */
  const sheet = (() => {
    if (detail?.kind === 'plug') {
      const p = byId(cat.pluggables, detail.id);
      return p && { item: p, dco: p.dco, tag: p.dco ? 'DCO · digital coherent optics' : 'Pluggable optics',
        facts: { 'Form factor': p.formFactor, Speed: p.speed, Fiber: p.fiber }, command: detail.at && command('pluggable', detail.at) };
    }
    if (detail?.kind === 'card') {
      const lc = byId(cat.linecards, detail.id);
      const roleCounts = lc?.ports.reduce((m, p) => m.set(roleOf(p), (m.get(roleOf(p)) ?? 0) + 1), new Map<string, number>());
      const roles = roleCounts && [...roleCounts.entries()].map(([role, n]) => `${n} ${role}`).join(', ');
      return lc && { item: lc, tag: 'Linecard', facts: { Width: `${lc.width ?? 1} slot${(lc.width ?? 1) > 1 ? 's' : ''}`, Ports: `${lc.ports.length} (${roles})` },
        command: detail.at && command('card', detail.at) };
    }
  })();
  /** The command under the CLI terminal: for what is hovered, else what was clicked, else the level shown. */
  const suggested = (!focus && sheet?.command) || strip;
  /** The inspector lists the alarms of what a bell was clicked on, else of the level shown. */
  const scope = alarmsFor ?? (cardSlot ? { slot: cardSlot } : {});
  const hint = card
    ? `${builtIn ? 'Click the card name for its datasheet · click' : 'Drag a pluggable onto a port, or click it, then a green port · click the card name for its datasheet · click'} a Tx, then an Rx, to run a fiber · click a lit strand to remove it · click a fiber to move its runs · right-click for a terminal, telnet or engineering mode · Esc goes back`
    : back
      ? '✕ pulls a PSU or fan out, which raises an alarm · Insert puts it back · Esc closes'
      : wire
        ? `Running a fiber ${wire.strand === 'tx' ? 'from' : 'into'} ${farLabel(wire.end)} ${STRAND[wire.strand]}: click the ${STRAND[OTHER[wire.strand]]} at the other end (green = free; a loopback-capable port may loop back to itself, and 800MX LR4 ports may daisy-chain) · Esc cancels`
        : 'Drag a linecard onto a slot, or click it, then a green slot · click a card to open it, a tile or the name plate for a datasheet · click a Tx, then an Rx, to run a fiber · click a lit strand to remove it · click a fiber to move its runs · right-click a card for telnet or engineering mode · Esc closes';

  return (
    <div className="backdrop" onClick={() => setOpenDevice(null)}>
      <div className="dialog physical" onClick={(e) => e.stopPropagation()}>
        <header>
          {/* Focus moves here, so Escape closes the view without React Flow also deselecting the node. */}
          <button autoFocus onClick={() => (cardSlot ? side(false) : setOpenDevice(null))} title={cardSlot ? 'Back to the chassis' : 'Back to the canvas'}>← Back</button>
          {/* The box to run CLI commands on. The view leaves its session when it closes. A tester has none. */}
          {tester ? <small className="muted">{chassis?.name}: test equipment, no box to connect to and no CLI</small> : <>
          <form className="box" onSubmit={(e) => { e.preventDefault(); connectBox(); }}>
            <input value={device.host ?? ''} placeholder="Box IP" aria-label="Box IP" spellCheck={false} disabled={linked || locked}
              title={locked && !linked ? 'Locked: unlock the lab (🔒) to change the box IP' : undefined} onChange={(e) => updateDevice(device.id, { host: e.target.value })} />
            <button className={`run ${here.state}`} disabled={!device.host?.trim()}>
              <span className="dot" />{linked ? 'Disconnect' : 'Connect'}
            </button>
            <small className="muted" title={here.error || (others > 0 ? `Also open for ${others} more (views or Codex sessions): Disconnect leaves it open for them` : undefined)}>{here.state === 'down' ? here.error : here.state === 'connecting' ? 'connecting…' : 'connected'}</small>
          </form>
          <small className="muted light-state" title={boxState?.run ? `From run ${boxState.run}` : undefined}>{lightLabel(boxState)}</small>
          {boxState?.live && <small className="muted light-state" title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Waiting for first live sync'}>{lastSyncAt ? syncLabel(lastSyncAt) : 'Live sync · waiting…'}</small>}
          {inferredPower && <small className="wiring-state" title="Generated from power matching; review data/boxes/<box>/wiring.csv">wiring inferred (power fallback)</small>}
          {/* After pulling a fiber on the box, label it for scoring. There while disconnected too, so the header never shifts. */}
          <form className="pull" onSubmit={(e) => { e.preventDefault(); markPull(); }}
            title="After pulling a fiber on the box, pick its strand: the bridge records a snapshot with its answer.json">
            <select value={pulled} onChange={(e) => setPulled(e.target.value)} aria-label="Pulled strand" disabled={here.state !== 'connected' || !(strands ?? []).length}>
              <option value="">Pulled strand…</option>
              {(strands ?? []).map((s) => <option key={s.strand} value={s.strand}>{s.strand}: {s.from} → {s.to}{s.via ? ` via ${s.via}` : ''}</option>)}
            </select>
            <button disabled={here.state !== 'connected' || !pulled}>Mark pulled</button>
          </form>
          <ProceduresButton current={procsGot.list?.current} open={!!procs} onClick={() => setProcs(procs ? null : { pick: null, slot: cardSlot })} />
          </>}
          <span className="spacer" />
          {/* There at a card too, so the header never shifts: either one goes back to that side of the chassis. */}
          {psus.length + fans.length > 0 && (
            <span className="seg">
              <button className={back ? '' : 'on'} onClick={() => side(false)}>Front</button>
              <button className={back ? 'on' : ''} onClick={() => side(true)}>Rear</button>
            </span>
          )}
          <button onClick={() => setOpenDevice(null)} aria-label="Close">✕</button>
        </header>
        {/*
          * The same four fixed areas at every level: the parts to put in across the top as small icons, the faceplate
          * (scaled to fit) the full width under them, and the CLI terminal and the details side by side at the bottom.
          */}
        <div className="body">
          {tray()}
          {/* The chassis is scaled to fit; a card's plate fills the stage as laid out, its cages sized to it. */}
          <div ref={stage} className="stage" onContextMenu={stageMenu}>
            {card && cardSlot ? cardLevel(cardSlot, card) : <div className="fit" style={fit}>{back ? backLevel() : chassisLevel()}</div>}
            {fetching && <div className="fetching">Fetching data from box{here.snapshot ? ` · ${here.snapshot.done} of ${here.snapshot.of} commands` : ''}</div>}
            {procs && (
              <ProceduresPanel host={host} hostname={hostnameOf(boxState)} got={procsGot} refresh={refreshProcs} slot={procs.slot} chassis={device.chassisNo ?? 1}
                tester={tester} connected={here.state === 'connected'} pick={procs.pick} onClose={() => setProcs(null)} />
            )}
          </div>
          {/*
            * The box's CLI, typed into as over ssh (Tab, ↑, Ctrl-C and Escape go to the box while it has focus), and under
            * it the command for what is hovered, to Copy or Run.
            */}
          <section className="term">
            {tester ? <p className="no-cli">{chassis?.name} has no CLI here. Fiber its ports to client ports with the same optics.</p> : <>
              <BoxTerminal live={linked && here.state === 'connected'} src={`bridge/term?host=${encodeURIComponent(host)}`} ref={keys} />
              <Cli command={suggested} box={here} onRun={runOnBox} />
            </>}
          </section>
          <aside className="inspector">
            {(sheet || alarmsFor) && <button className="close" onClick={() => { setDetail(null); setAlarmsFor(null); }} aria-label="Close">✕</button>}
            {sheet ? (
              <>
                <div className="sheet-head">
                  <Pic p={sheet.item} big />
                  <div>
                    <h3>{sheet.item.name}</h3>
                    <span className={`kind${sheet.dco ? ' dco' : ''}`}>{sheet.tag}</span>
                    {sheet.item.part && <p className="muted">{sheet.item.vendor} {sheet.item.part}</p>}
                  </div>
                </div>
                {sheet.item.about && <p>{sheet.item.about}</p>}
                <table>
                  <tbody>
                    {Object.entries({ ...sheet.facts, ...sheet.item.specs }).map(([k, v]) => (
                      <tr key={k}><th>{k}</th><td>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
                {sheet.item.url && <a href={asset(sheet.item.url)} target="_blank" rel="noreferrer">Datasheet ↗</a>}
                {sheet.command && <Cli command={sheet.command} box={here} onRun={runOnBox} />}
              </>
            ) : (
              <>
                <h3>Alarms</h3>
                <p className="muted">{[device.name, scope.slot ?? scope.bay, scope.port].filter(Boolean).join('/')}</p>
                <table>
                  <tbody>
                    {alarmsAt(scope).map((a, i) => (
                      <tr key={i}><td><span className={`alarm ${a.severity}`}>{a.severity}</span></td><td>{place(a)}</td><td>{a.text}</td></tr>
                    ))}
                  </tbody>
                </table>
                {!alarmsAt(scope).length && <p className="muted">None: all clear.</p>}
              </>
            )}
          </aside>
        </div>
        {tip && (
          <div className={`plug-tip${tip.up ? ' up' : ''}`} style={{ left: tip.x, top: tip.y }}>
            <Pic p={tip.p} />
            <div>
              <b>{tip.p.name}</b>
              <small>{tip.p.part ? [tip.p.vendor, tip.p.part].filter(Boolean).join(' ') : 'no part number'}</small>
              <small>{tip.p.dco ? 'DCO' : 'Pluggable'} · {tip.p.speed} · {tip.p.fiber}{tip.p.specs?.Reach ? ` · ${tip.p.specs.Reach}` : ''}</small>
            </div>
          </div>
        )}
        <p className="hint" title={hint}>{hint}</p>
        {menu}
      </div>
    </div>
  );
}

/** Runs a command on the box once it is connected; without `onClick` it submits its form. */
function RunButton({ box, onClick }: { box: Box; onClick?: () => void }) {
  const up = box.state === 'connected';
  return (
    <button type={onClick ? 'button' : 'submit'} className={`run ${box.state}`} disabled={!up} onClick={onClick}
      title={up ? `Run on ${box.host}` : box.error || `Box ${box.state}`}>
      <span className="dot" />Run
    </button>
  );
}

/** A CLI command with Copy and Run. */
function Cli({ command, box, onRun }: { command: string; box: Box; onRun: (command: string) => void }) {
  return (
    <div className="cli">
      <code>{command}</code>
      <button onClick={() => navigator.clipboard.writeText(command)} title="Copy command">Copy</button>
      <RunButton box={box} onClick={() => onRun(command)} />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { byId, cli } from './catalog';
import { PipeLayer, type PipeEnds } from './Pipe';
import { roleOf, toneOf } from './ports';
import { alarms, bays, coverage, fiberable, fiberError, fibersAt, linecardError, path, pluggableError, resolve, sameEnd, span, touches } from './rules';
import { useCatalog, useStore } from './store';
import { BoxTerminal, type Keys } from './Terminal';
import type { Alarm, CliLevel, Datasheet, End, LinecardDef, PluggableDef, Strand, Topology } from './types';

type Drag = { kind: 'card' | 'plug'; id: string };
type At = { slot: string; port?: string };
/** The box as the CLI bridge sees it (bridge/server.mjs). */
type Box = { state: 'connected' | 'connecting' | 'down'; host?: string; error?: string };
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

/** The same port rows and columns at the chassis and at the card level. */
const portGrid = (lc: LinecardDef) => ({ gridTemplateColumns: `repeat(${lc.columns ?? 4 * (lc.width ?? 1)}, max-content)` });

/** A link as is, or a file under public/. */
const asset = (path: string) => (/^https?:/.test(path) ? path : import.meta.env.BASE_URL + path);

/** Product photo, else a pluggable's form factor drawn as a label, else nothing. */
const Pic = ({ p, big }: { p: Datasheet & { name: string; formFactor?: string }; big?: boolean }) =>
  p.image ? <img className={`pic${big ? ' big' : ''}`} src={asset(p.image)} alt={p.name} draggable={false} />
    : p.formFactor ? <div className={`pic none${big ? ' big' : ''}`}>{p.formFactor}</div> : null;

/** A strand's key for the pipes drawn over the faceplate. */
const pin = (e: End, s: Strand) => `${s}:${e.slot}/${e.port}`;

/**
 * Duplex LC: the Tx and Rx connectors, each lit while a fiber is on it; the tooltip says where it goes or comes from.
 * A fiber drawn as a pipe leaves a Tx and lands on an Rx.
 */
const Strands = ({ t, end, onClick }: { t: Topology; end: End; onClick: (e: MouseEvent, s: Strand) => void }) => {
  const at = fibersAt(t, end);
  return (
    <div className="lc">
      {(['tx', 'rx'] as const).map((s) => {
        const l = at[s];
        return (
          <span key={s} className={`strand wire${l ? ' lit' : ''}`} data-pipe-end={pin(end, s)} onClick={(e) => onClick(e, s)}
            title={l ? `${path(t, l.a)} Tx → ${path(t, l.b)} Rx` : `${STRAND[s]}: no fiber`}>
            {STRAND[s]}
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
const MgmtStrip = ({ ports }: { ports?: string[] }) => !ports?.length ? null : (
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
 * A request to the CLI bridge, which Vite proxies under /bridge. The header tells the bridge it comes from this app.
 * Disconnect is sent with keepalive, so it still goes out when the page closes.
 */
const bridge = (path: string, body?: string) => fetch(`${import.meta.env.BASE_URL}bridge/${path}`,
  { method: body === undefined ? 'GET' : 'POST', headers: { 'x-ols-tracer': '1' }, body, keepalive: path === 'disconnect' });

/** The box, checked every 5 s while the view is open (every second while it connects); closing the view or the page disconnects it. */
function useBox() {
  const [box, setBox] = useState<Box>(NO_BRIDGE);
  const check = useCallback(() => bridge('status').then((r) => r.json()).then(setBox, () => setBox(NO_BRIDGE)), []);
  useEffect(() => {
    check();
    const id = setInterval(check, box.state === 'connecting' ? 1000 : 5000);
    return () => clearInterval(id);
  }, [check, box.state]);
  useEffect(() => {
    const disconnect = () => void bridge('disconnect', '').catch(() => {});
    window.addEventListener('pagehide', disconnect);
    return () => { window.removeEventListener('pagehide', disconnect); disconnect(); };
  }, []);
  return [box, check] as const;
}

export function PhysicalView() {
  const t = useStore((s) => s.topology)!;
  const openId = useStore((s) => s.openDevice);
  const [stage, fit] = useFit();
  const cat = useCatalog();
  const [cardSlot, setCardSlot] = useState<string | null>(null); // slot of the linecard being shown
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tip, setTip] = useState<{ p: PluggableDef; x: number; y: number; up: boolean } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null); // datasheet in the side panel
  const [focus, setFocus] = useState<At | null>(null); // hovered slot or port, for the CLI strip
  const [wire, setWire] = useState<Wire | null>(null);
  const [back, setBack] = useState(false); // chassis seen from the back: PSUs and fans
  const [alarmsFor, setAlarmsFor] = useState<Where | null>(null); // level whose alarms the side panel lists
  const [box, checkBox] = useBox();
  const keys = useRef<Keys>(null); // types into the CLI terminal
  const { setOpenDevice, updateDevice, insertLinecard, insertPluggable, remove, notify, connect, deleteLink } = useStore.getState();

  // Escape goes up one level: fiber being run → picked part or side panel → linecard → chassis → canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (wire) setWire(null);
      else if (detail || alarmsFor) { setDetail(null); setAlarmsFor(null); }
      else if (cardSlot) setCardSlot(null);
      else setOpenDevice(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wire, detail, alarmsFor, cardSlot, setOpenDevice]);

  // The hovered element, and the level whose alarms were listed, are gone once the level or side changes.
  useEffect(() => { setFocus(null); setWire(null); setAlarmsFor(null); setTip(null); }, [cardSlot, back]);

  const device = byId(t.devices, openId ?? undefined);
  if (!device) return null;
  const chassis = byId(cat.chassis, device.chassis);
  const slots = chassis?.slots ?? [];
  const columns = chassis?.columns ?? slots.length;
  const ru = Math.ceil(slots.length / columns) || 1; // drawn one rack unit (1U) high per row of slots
  const card = cardSlot ? byId(cat.linecards, device.slots[cardSlot]?.linecard) : undefined;
  const builtIn = card && !card.ports.some((p) => p.allowedPluggables.length); // a card with fixed ports only
  const command = (level: CliLevel, at?: At) => cli(cat, level, { chassis: device.chassisNo ?? 1, ...at });
  const at = focus ?? (cardSlot ? { slot: cardSlot } : undefined);
  const strip = command(at?.port ? 'port' : at ? 'card' : 'chassis', at);

  /** The bridge's box as far as this device goes: down unless it is this device's box. */
  const here: Box = device.host && box.host === device.host ? box
    : { state: 'down', error: device.host ? `Not connected to ${device.host}: click Connect` : 'Enter the box IP, then Connect' };
  const linked = here.state !== 'down' || !!here.host; // connected to this box, or trying to
  const connectBox = () => {
    const host = device.host?.trim();
    if (host) bridge(linked ? 'disconnect' : 'connect', linked ? '' : host).then(checkBox, () => notify(NO_BRIDGE.error!));
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
  /** Two lines under a port: where its Tx goes and where its Rx comes from. Always both, so nothing moves. */
  const farLines = (end: End) => {
    const { tx, rx } = fibersAt(t, end);
    const lines = tx && tx === rx ? ['↺ loop', ''] : [tx ? `→ ${farLabel(tx.b)}` : '', rx ? `← ${farLabel(rx.a)}` : ''];
    return lines.map((s, i) => <small key={i} className="far">{s || '\u00a0'}</small>);
  };

  /** A linecard as a small icon: its faceplate with a dot per port. */
  const cardTile = (lc: LinecardDef) => (
    <div key={lc.id} className={`tile${shown('card', lc.id) ? ' on' : ''}`} draggable
      title={`${lc.name} · ${lc.width ?? 1} slot${(lc.width ?? 1) > 1 ? 's' : ''} · ${lc.ports.length} port${lc.ports.length > 1 ? 's' : ''}`}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lc.id); setDrag({ kind: 'card', id: lc.id }); }}
      onDragEnd={() => setDrag(null)}
      onClick={() => pick('card', lc.id)}>
      <b>{lc.name}</b>
      <small>{lc.width ?? 1} slot{(lc.width ?? 1) > 1 ? 's' : ''} · {lc.ports.length} port{lc.ports.length > 1 ? 's' : ''}</small>
      <div className="mini-ports">{lc.ports.map((p) => <span key={p.id} className={`mini-dot ${toneOf(p)}`} />)}</div>
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
                  <div className="port-grid" style={portGrid(lc)}>
                    {lc.ports.map((p) => {
                      const end = { device: device.id, slot: slot.id, port: p.id };
                      const { pluggable } = resolve(t, cat, end);
                      const from = wire && sameEnd(wire.end, end);
                      const target = wire && !fiberError(t, cat, ...ends(wire, end));
                      return (
                        <div key={p.id} className={`mini ${toneOf(p)}${pluggable ? ' filled' : ''}${from ? ' wiring' : ''}${target ? ' fits' : ''}`}
                          data-pipe-box {...hoverable(pluggable)}
                          onClick={pluggable ? (e) => { e.stopPropagation(); show('plug', pluggable.id, { slot: slot.id, port: p.id }); } : undefined}>
                          {pluggable ? <Pic p={pluggable} /> : <div className="pic empty">{p.allowedPluggables.length ? '' : 'LC'}</div>}
                          <small>{p.id}</small>
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
        <PipeLayer view={`chassis:${device.id}`} spacing={{ margin: 2, lane: 7, hop: 3 }} width={5}
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

  /** The whole linecard faceplate, one cage per port, big enough to show what is plugged in. */
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
      <div className="faceplate" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="plate-label" title="Datasheet" onClick={() => show('card', lc.id, { slot: slotId })}>
          <b>{lc.name}</b>
          <small>slot {slotLabel(slotId, lc.width)} · {lc.ports.length} ports</small>
          {alarmButton({ slot: slotId })}
          <span className="led" />
        </div>
        <div className="cages port-grid" style={portGrid(lc)}>
          {lc.ports.map((p) => {
            const end = { device: device.id, slot: slotId, port: p.id };
            const { pluggable } = resolve(t, cat, end);
            const inserted = device.slots[slotId].ports[p.id];
            const fits = part?.kind === 'plug' && !inserted && !pluggableError(cat, lc.id, p.id, part.id);
            return (
              <div key={p.id} data-port={p.id} className={`cage ${toneOf(p)}${fits ? ' fits' : ''}${pluggable ? ' filled' : ''}${wire && sameEnd(wire.end, end) ? ' wiring' : ''}`}
                data-pipe-box {...hoverable(pluggable, { slot: slotId, port: p.id })}
                onClick={pluggable ? () => show('plug', pluggable.id, { slot: slotId, port: p.id }) : fits ? () => insertPluggable(device.id, slotId, p.id, part.id) : undefined}>
                <div className="cage-head">
                  <b>{p.id}</b><small>{roleOf(p)}</small>
                  {alarmButton({ slot: slotId, port: p.id })}
                  {inserted &&<span className="remove" onClick={(e) => { e.stopPropagation(); removeAt(slotId, p.id); }}>✕</span>}
                </div>
                {pluggable ? <Pic p={pluggable} /> : <div className="pic empty">{p.allowedPluggables.join(' / ') || 'fixed LC'}</div>}
                <div className="cage-name">{pluggable?.name ?? (inserted ? `unknown ${inserted.pluggable}` : p.allowedPluggables.length ? 'empty' : 'built-in')}</div>
                {farLines(end)}
                <Strands t={t} end={end} onClick={(e, s) => onStrand(e, end, s)} />
              </div>
            );
          })}
        </div>
        {/* Always there, like the row below, so the card does not grow when it is fibered. */}
        <div className="terminals">
          {fibers.map(({ link, far, reverse }) => far && (
            <div key={link.id} className="terminal" data-pipe-box data-pipe-end={`far:${link.id}`} data-pipe-top title={path(t, far)}>
              {reverse ? `← ${farLabel(far)} Tx` : `→ ${farLabel(far)} Rx`}
            </div>
          ))}
        </div>
        <PipeLayer view={`card:${device.id}/${slotId}`} spacing={{ margin: 10, lane: 18, hop: 9 }} width={14} ends={fibers} />
        {/* The other cards are not shown here, so the far end is picked from a list. */}
        <label className="connect-to">
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
    const groups = card
      ? Object.entries(Object.groupBy(cat.pluggables, (p) => (p.dco ? 'DCO · digital coherent optics' : 'Pluggable optics'))).map(([group, plugs]) => [group, plugs?.map((p) => (
        <div key={p.id} className={`tile${p.dco ? ' dco' : ''}${shown('plug', p.id) ? ' on' : ''}`} draggable {...hoverable(p)}
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setTip(null); setDrag({ kind: 'plug', id: p.id }); }}
          onDragEnd={() => setDrag(null)}
          onClick={() => pick('plug', p.id)}>
          <Pic p={p} />
          <b>{p.name}</b>
        </div>
      ))] as const)
      : [['Linecards', cat.linecards.map(cardTile)] as const];
    // Always there, so the faceplate keeps its size: a card with built-in ports and the back get a note instead.
    const note = back ? 'Nothing to drag in at the rear.'
      : builtIn ? `${card.name} has built-in ports: nothing to plug in.` : '';
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
    ? `${builtIn ? 'Click the card name for its datasheet · click' : 'Drag a pluggable onto a port, or click it, then a green port · click the card name for its datasheet · click'} a Tx, then an Rx, to run a fiber · click a lit strand to remove it · click a fiber to move its runs · Esc goes back`
    : back
      ? '✕ pulls a PSU or fan out, which raises an alarm · Insert puts it back · Esc closes'
      : wire
        ? `Running a fiber ${wire.strand === 'tx' ? 'from' : 'into'} ${farLabel(wire.end)} ${STRAND[wire.strand]}: click the ${STRAND[OTHER[wire.strand]]} at the other end (green = free; a loopback-capable port may loop back to itself) · Esc cancels`
        : 'Drag a linecard onto a slot, or click it, then a green slot · click a card to open it, a tile or the name plate for a datasheet · click a Tx, then an Rx, to run a fiber · click a lit strand to remove it · click a fiber to move its runs · Esc closes';

  return (
    <div className="backdrop" onClick={() => setOpenDevice(null)}>
      <div className="dialog physical" onClick={(e) => e.stopPropagation()}>
        <header>
          {/* Focus moves here, so Escape closes the view without React Flow also deselecting the node. */}
          <button autoFocus onClick={() => (cardSlot ? side(false) : setOpenDevice(null))} title={cardSlot ? 'Back to the chassis' : 'Back to the canvas'}>← Back</button>
          {/* The box to run CLI commands on. Its session closes with the view. */}
          <form className="box" onSubmit={(e) => { e.preventDefault(); connectBox(); }}>
            <input value={device.host ?? ''} placeholder="Box IP" aria-label="Box IP" spellCheck={false} disabled={linked}
              onChange={(e) => updateDevice(device.id, { host: e.target.value })} />
            <button className={`run ${here.state}`} disabled={!device.host?.trim()}>
              <span className="dot" />{linked ? 'Disconnect' : 'Connect'}
            </button>
            <small className="muted" title={here.error}>{here.state === 'down' ? here.error : here.state === 'connecting' ? 'connecting…' : 'connected'}</small>
          </form>
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
          <div ref={stage} className={`stage${card ? ' card-view' : ''}`}>
            <div className="fit" style={fit}>
              {card && cardSlot ? cardLevel(cardSlot, card) : back ? backLevel() : chassisLevel()}
            </div>
          </div>
          {/*
            * The box's CLI, typed into as over ssh (Tab, ↑, Ctrl-C and Escape go to the box while it has focus), and under
            * it the command for what is hovered, to Copy or Run.
            */}
          <section className="term">
            <BoxTerminal live={here.state === 'connected'} ref={keys} />
            <Cli command={suggested} box={here} onRun={runOnBox} />
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
              <small>{tip.p.part ? `${tip.p.vendor} ${tip.p.part}` : 'no part number'}</small>
              <small>{tip.p.dco ? 'DCO' : 'Pluggable'} · {tip.p.speed} · {tip.p.fiber}{tip.p.specs?.Reach ? ` · ${tip.p.specs.Reach}` : ''}</small>
            </div>
          </div>
        )}
        <p className="hint" title={hint}>{hint}</p>
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

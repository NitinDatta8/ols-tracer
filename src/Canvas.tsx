import {
  Background, BaseEdge, ConnectionLineType, ConnectionMode, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, ReactFlow,
  getStraightPath, useReactFlow, useStore as useFlowStore, useUpdateNodeInternals,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { byId } from './catalog';
import { Art, around, at, CardFace, faced, inside, strandBoxes, type Faced } from './Face';
import { termLines, useMenu } from './Menu';
import { behaviorOf, onFront, roleOf, showsInView, toneOf } from './ports';
import { light, stateFor, type Light } from './live';
import { AlarmButton, MgmtStrip, portGrid } from './PhysicalView';
import { Pipe } from './Pipe';
import { indexAt, rackLayout, within, type Size } from './racks';
import { layout, moveRun, type Fiber, type Pt, type Rect, type Route } from './route';
import { alarms, coverage, fiberable, fibersAt, path, resolve, sameEnd, span } from './rules';
import { useCatalog, useLocked, useStore } from './store';
import { termMenu } from './terminals';
import type { Catalog, Device, End, Link, Topology, View } from './types';

export const CHASSIS_MIME = 'application/x-ols-chassis';
export const RACK_MIME = 'application/x-ols-rack';


type FiberData = {
  tip: string; label?: string; service?: boolean; lane?: number; light?: Light | null;
  route?: Route; onMove?: (pts: Pt[], run: number, dx: number, dy: number) => void; onReset?: () => void;
};

// A port has a Tx handle (source) and an Rx handle (target), both with the id "<slot>/<port>".
const handleOf = (e: End) => `${e.slot}/${e.port}`;
const endOf = (device: string, handle: string | null | undefined): End => {
  const h = handle ?? '';
  const i = h.indexOf('/');
  return { device, slot: h.slice(0, i), port: h.slice(i + 1) };
};

/** Bottom centre of each handle, by id: where its fiber leaves or lands. */
const bottoms = (hs?: { id?: string | null; x: number; y: number; width: number; height: number }[] | null) =>
  Object.fromEntries((hs ?? []).map((h) => [h.id, { x: h.x + h.width / 2, y: h.y + h.height }]));

/** The fibers the view shows: L0 all, L1 only ports flagged showsInL1, Data only ports flagged showsInData. */
const visibleLinks = (t: Topology, cat: Catalog, view: View) =>
  t.links.filter((l) => [l.a, l.b].every((e) => showsInView(view, resolve(t, cat, e).port)));

/**
 * Each card, in slot order, with its ports that can take a fiber: those on its front with a pluggable or a fixed
 * connector, and which of their strands are there (a monitor tap has only a Tx).
 */
function cardsOf(t: Topology, cat: Catalog, d: Device) {
  return Object.entries(d.slots).map(([slot, s]) => {
    const card = byId(cat.linecards, s.linecard);
    const ports = (card?.ports ?? []).flatMap((p) => {
      const end = { device: d.id, slot, port: p.id };
      const { pluggable } = resolve(t, cat, end);
      return fiberable(t, cat, end) ? [{ end, port: p, pluggable, tx: onFront(card, p.id, 'tx'), rx: onFront(card, p.id, 'rx') }] : [];
    });
    return { slot, name: card?.name ?? `unknown ${s.linecard}`, ports };
  });
}

/** A chassis, or test equipment: a box with a trace on its screen and two ports. */
export const ChassisIcon = ({ tester }: { tester?: boolean }) => (
  <svg className="icon" width="48" height="30" viewBox="0 0 48 30">
    <rect x="1" y="1" width="46" height="28" rx="3" />
    {tester
      ? <><polyline points="6,15 11,15 13,7 17,22 20,11 23,15 28,15" /><rect className="jack" x="33" y="8" width="8" height="5" /><rect className="jack" x="33" y="17" width="8" height="5" /></>
      : [8, 14, 20].map((y) => <line key={y} x1="6" x2="42" y1={y} y2={y} />)}
    <circle cx={tester ? 30 : 40} cy="25" r="2" />
  </svg>
);

/**
 * A racked device's front, drawn as the physical view draws its chassis (its picture from the deck with the cards the
 * deck draws on it, else the same 19-inch panel, slots and mini cages, see chassisLevel there), with each port that can
 * take a fiber giving its Tx and Rx as handles to run fibers from.
 */
function ChassisFront({ t, cat, device, view }: { t: Topology; cat: Catalog; device: Device; view: View }) {
  const chassis = byId(cat.chassis, device.chassis);
  const slots = chassis?.slots ?? [];
  const columns = chassis?.columns ?? slots.length;
  const ru = Math.ceil(slots.length / columns) || 1;
  const taken = coverage(cat, device);
  const list = alarms(t, cat, device);
  const photo = chassis?.faceplate?.slots ? chassis.faceplate : undefined;
  /** A card the deck draws: its faceplate, with each port's Tx and Rx handles over its connector. */
  const face = (lc: Faced, slot: string) => (
    <CardFace card={lc} port={(p, box, f) => {
      const end = { device: device.id, slot, port: p.id };
      const { pluggable, fixed } = resolve(t, cat, end);
      const [lit, strands] = [fibersAt(t, end), strandBoxes(f, !!pluggable)];
      return (
        <div className={`spot ${toneOf(p)}${pluggable ? ' in' : ''}${showsInView(view, p) ? '' : ' off'}`} style={at(lc.faceplate, box)}
          title={`${path(t, end)} · ${roleOf(p)} · ${pluggable?.name ?? (fixed ? 'fixed Tx/Rx' : 'no pluggable')}`}>
          {pluggable && <small>{pluggable.name}</small>}
          {(pluggable || fixed) && <>
            {strands.tx && <Handle id={handleOf(end)} type="source" position={Position.Bottom} className={`strand${lit.tx ? ' lit' : ''}`} style={inside(box, strands.tx)} />}
            {strands.rx && <Handle id={handleOf(end)} type="target" position={Position.Bottom} className={`strand${lit.rx ? ' lit' : ''}`} style={inside(box, strands.rx)} />}
          </>}
        </div>
      );
    }} />
  );
  const views = slots.map((slot, i) => {
    const state = device.slots[slot.id];
    if (!state && taken.has(slot.id)) return null; // under a wide card to its left
    const lc = byId(cat.linecards, state?.linecard);
    const ids = (chassis && span(chassis, slot.id, lc?.width)) ?? [slot.id];
    const boxes = photo ? ids.map((id) => photo.slots?.[id]).filter((b) => !!b) : [];
    if (photo && !boxes.length) return null;
    return (
      <div key={slot.id} data-slot={slot.id} className={`slot${state ? ' filled' : ''}${faced(lc) ? ' faced' : ''}`}
        style={photo ? at(photo, around(...boxes)) : { gridColumn: `${(i % columns) + 1} / span ${lc?.width ?? 1}`, gridRow: Math.floor(i / columns) + 1 }}>
        <div className="cage-head">
          <b>{state ? (lc?.name ?? `unknown ${state.linecard}`) : 'empty'}</b>
          <small>slot {ids.length > 1 ? `${ids[0]}–${ids.at(-1)}` : slot.id}</small>
          {!faced(lc) && <AlarmButton list={list.filter((a) => a.slot === slot.id)} />}
        </div>
        {faced(lc) && <span className="slot-alarm"><AlarmButton list={list.filter((a) => a.slot === slot.id)} /></span>}
        {faced(lc) ? face(lc, slot.id) : lc && (
          <div className="port-grid" style={portGrid(lc, '52px')}>
            {lc.ports.map((p) => {
              const end = { device: device.id, slot: slot.id, port: p.id };
              const { pluggable, fixed } = resolve(t, cat, end);
              const lit = fibersAt(t, end);
              return (
                <div key={p.id} className={`mini ${toneOf(p)}${pluggable ? ' filled' : ''}${showsInView(view, p) ? '' : ' off'}`}
                  title={`${path(t, end)} · ${roleOf(p)} · ${pluggable?.name ?? (fixed ? 'fixed Tx/Rx' : 'no pluggable')}`}>
                  <small className={`face${pluggable ? ' in' : fixed ? ' lc' : ''}`}>{p.id}</small>
                  <div className="lc">
                    {pluggable || fixed ? <>
                      <Handle id={handleOf(end)} type="source" position={Position.Bottom} className={`strand${lit.tx ? ' lit' : ''}`}>Tx</Handle>
                      <Handle id={handleOf(end)} type="target" position={Position.Bottom} className={`strand${lit.rx ? ' lit' : ''}`}>Rx</Handle>
                    </> : <><span className="strand">Tx</span><span className="strand">Rx</span></>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });
  return (
    <div className={`faceplate rack-view${photo ? ' photo' : ''}`} style={photo && { '--w': `${photo.size[0]}px`, '--h': `${photo.size[1]}px` } as CSSProperties}>
      {photo ? <Art face={photo} className="chassis-art">{views}</Art> : (
        <div className="rack" style={{ '--u': ru } as CSSProperties}>
          <MgmtStrip ports={chassis?.mgmtPorts?.front} />
          <div className="slots" style={{ gridTemplate: `repeat(${ru}, 1fr) / repeat(${columns}, 1fr)` }}>{views}</div>
        </div>
      )}
    </div>
  );
}

/** A rack: its frame and name, behind the devices in it (they are nodes of their own, placed by rackLayout). */
function RackNode({ data }: NodeProps) {
  const { name, w, h, count } = data as { name: string; w: number; h: number; count: number };
  return (
    <div className="cabinet" style={{ width: w, height: h }}>
      <div className="cabinet-head"><b>{name}</b><small>{count ? `${count} box${count > 1 ? 'es' : ''}` : ''}</small></div>
      {!count && <div className="cabinet-empty">Drag boxes in here, from the palette or the canvas</div>}
    </div>
  );
}

/** A rack in the palette: a frame with rails and three units in it. */
export const RackIcon = () => (
  <svg className="icon" width="48" height="30" viewBox="0 0 48 30">
    <rect x="9" y="1" width="30" height="28" rx="2" />
    {[5, 13, 21].map((y) => <rect key={y} className="unit" x="12" y={y} width="24" height="6" />)}
  </svg>
);

function DeviceNode({ id, data }: NodeProps) {
  const t = useStore((s) => s.topology)!;
  const view = useStore((s) => s.view);
  const cat = useCatalog();
  const racked = !!(data as { racked?: boolean }).racked;
  const device = byId(t.devices, id);
  const chassis = byId(cat.chassis, device?.chassis);
  const cards = device ? cardsOf(t, cat, device) : [];
  const ports = cards.flatMap((c) => c.ports);
  const [menuAt, menu] = useMenu();

  // React Flow measures handles on mount and on resize, but a new pluggable can add a handle without resizing
  // the node, so re-measure when the set changes. (Not on mount: that would fit the view before every node is
  // measured.) Views only dim ports, so they never change the handles.
  const updateNodeInternals = useUpdateNodeInternals();
  const handles = `${racked}|${ports.map((p) => handleOf(p.end)).join()}`; // racked, the same handles move
  const measuredHandles = useRef(handles);
  useEffect(() => {
    if (measuredHandles.current === handles) return;
    measuredHandles.current = handles;
    updateNodeInternals(id);
  }, [id, handles, updateNodeInternals]);

  if (!device) return null;
  /** Right-click: the card's terminals on a card, else the chassis's. */
  const onMenu = (e: ReactMouseEvent) => {
    const { title, items } = termMenu(cat, device, (e.target as Element).closest('[data-slot]')?.getAttribute('data-slot'));
    menuAt(e, { title, items: termLines(items) });
  };
  if (racked) {
    return (
      <div className="device racked" onContextMenu={onMenu}>
        <div className="racked-head">
          <b>{device.name}</b>
          <small>{chassis?.name ?? `unknown chassis ${device.chassis}`}{device.host ? ` · ${device.host}` : ''}</small>
          <AlarmButton list={alarms(t, cat, device)} />
        </div>
        <ChassisFront t={t} cat={cat} device={device} view={view} />
        {menu}
      </div>
    );
  }
  return (
    <div className="device" onContextMenu={onMenu}>
      {/* No handler: a click opens the device, where each level shows its own alarms. */}
      <AlarmButton list={alarms(t, cat, device)} />
      <ChassisIcon tester={chassis?.tester} />
      <div className="name">{device.name}</div>
      <div className="model">{chassis?.name ?? `unknown chassis ${device.chassis}`}</div>
      {/* A row per card: its slot and name, then its ports that can take a fiber, each with a Tx and an Rx handle. */}
      {cards.map(({ slot, name, ports }) => (
        <div key={slot} className="card-row" data-slot={slot}>
          {!chassis?.tester && <div className="card-name">{slot} · {name}</div>}
          <div className="ports">
            {ports.map(({ end, port, pluggable, tx, rx }) => {
              const lit = fibersAt(t, end);
              return (
                <div key={handleOf(end)} className={`port ${toneOf(port)}${showsInView(view, port) ? '' : ' off'}`} title={`${path(t, end)} · ${roleOf(port)} · ${pluggable?.name ?? 'fixed Tx/Rx'}`}>
                  {end.port}
                  <div className="lc">
                    {tx && <Handle id={handleOf(end)} type="source" position={Position.Bottom} className={`strand${lit.tx ? ' lit' : ''}`}>Tx</Handle>}
                    {rx && <Handle id={handleOf(end)} type="target" position={Position.Bottom} className={`strand${lit.rx ? ' lit' : ''}`}>Rx</Handle>}
                  </div>
                </div>
              );
            })}
            {!ports.length && <small className="muted">no optics in yet</small>}
          </div>
        </div>
      ))}
      {menu}
    </div>
  );
}

/**
 * Fibers are pipes routed in straight runs around devices (see Pipe); services are dashed straight lines.
 * React Flow's own edge path is kept, unpainted, for selecting the fiber.
 */
function FiberEdge({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps<Edge<FiberData>>) {
  const { getZoom } = useReactFlow();
  const route = data?.route;
  if (data?.service || !route) {
    // Services, and fibers until their devices are measured: straight, parallel ones 12px apart.
    const lane = data?.lane ?? 0;
    const len = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
    const [nx, ny] = [((sourceY - targetY) / len) * lane * 12, ((targetX - sourceX) / len) * lane * 12];
    const [line] = getStraightPath({ sourceX: sourceX + nx, sourceY: sourceY + ny, targetX: targetX + nx, targetY: targetY + ny });
    return <><title>{data?.tip}</title><BaseEdge id={id} path={line} className={data?.service ? 'service' : 'fiber'} /></>;
  }

  const { pts } = route;
  const m = Math.floor((pts.length - 1) / 2);
  return (
    <>
      <BaseEdge id={id} path={route.d} className="hit" interactionWidth={14} />
      <Pipe id={id} route={route} tip={data.tip} width={14} light={data.light} selected={selected} scale={getZoom} onMove={data.onMove} onReset={data.onReset} />
      {data.label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${(pts[m].x + pts[m + 1].x) / 2}px, ${(pts[m].y + pts[m + 1].y) / 2}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function edgesFor(t: Topology, cat: Catalog, view: View, selected: string | null, fiber: (l: Link) => Partial<FiberData>): Edge<FiberData>[] {
  const behavior = (e: End) => behaviorOf(resolve(t, cat, e).port);
  const lanes = new Map<string, number>(); // edges so far per device pair, so parallel ones get their own lane
  const edge = (id: string, a: End, b: End, data: FiberData): Edge<FiberData> => {
    const pair = [a.device, b.device].sort().join('~');
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 1);
    return {
      id, type: 'fiber', data: { ...data, lane }, selected: id === selected, selectable: !data.service, deletable: !data.service, zIndex: 1, // over racks, under devices
      source: a.device, sourceHandle: handleOf(a), target: b.device, targetHandle: handleOf(b),
    };
  };

  const fibers = visibleLinks(t, cat, view)
    .map((l) => edge(l.id, l.a, l.b, {
      tip: `${path(t, l.a)} Tx → ${path(t, l.b)} Rx`,
      label: view === 'L1' ? (sameEnd(l.a, l.b) ? `${path(t, l.a)} loopback` : `${path(t, l.a)} → ${path(t, l.b)}`) : undefined,
      ...fiber(l),
    }));
  if (view !== 'Data') return fibers;

  // Data view: a dashed service between the data ports (paired in order) of two cards joined by an L1-to-L1
  // fiber, in either direction; one service per pair, none for a loopback.
  const dataPorts = (e: End) =>
    (resolve(t, cat, e).card?.ports ?? []).filter((p) => behaviorOf(p).showsInData).map((p) => ({ ...e, port: p.id }));
  const services = t.links
    .filter((l) => behavior(l.a).showsInL1 && behavior(l.b).showsInL1 && !sameEnd(l.a, l.b))
    .flatMap((l) => dataPorts(l.a).map((a, i) => [a, dataPorts(l.b)[i]] as const))
    .filter(([a, b]) => b && fiberable(t, cat, a) && fiberable(t, cat, b))
    .map(([a, b]) => edge(`svc:${[`${a.device}/${handleOf(a)}`, `${b.device}/${handleOf(b)}`].sort().join('~')}`, a, b, {
      tip: `Service ${path(t, a)} ⇄ ${path(t, b)}`,
      service: true,
    }));
  return [...fibers, ...new Map(services.map((s) => [s.id, s])).values()];
}

const nodeTypes = { device: DeviceNode, rack: RackNode };
const fitOptions = { maxZoom: 1 };
const edgeTypes = { fiber: FiberEdge };

export function Canvas() {
  const t = useStore((s) => s.topology)!;
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selected);
  const modalOpen = useStore((s) => !!s.openDevice);
  const live = useStore((s) => s.live);
  const locked = useLocked(); // no chassis or rack dragged or deleted: fibers stay free
  const cat = useCatalog();
  const { addDevice, updateDevice, deleteDevice, select, connect, deleteLink, setOpenDevice, setRoute, addRack, moveRack, deleteRack, place } = useStore.getState();
  const { screenToFlowPosition } = useReactFlow();
  const [measured, setMeasured] = useState<Record<string, Size>>({});
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null); // a racked device, until dropped
  const lastConnect = useRef(0);
  // Fit opened/restored topologies once; an empty new project must not re-center on its first drop.
  const [fitOnOpen] = useState(t.devices.length > 0 || !!t.racks?.length);

  const racks = useMemo(() => rackLayout(t, measured), [t, measured]);

  // Nodes are derived from the store plus React Flow's measured sizes (it needs them back, e.g. for the minimap). Racks
  // sit behind everything, the fibers over them and the devices on top; a racked device is where its rack stacks it.
  const nodes = useMemo<Node[]>(() => [
    ...racks.frames.map(({ rack, list, rect }) => ({
      id: rack.id, type: 'rack', position: { x: rack.x, y: rack.y }, zIndex: 0, deletable: !locked,
      data: { name: rack.name, w: rect.w, h: rect.h, count: list.length }, selected: rack.id === selected, measured: measured[rack.id],
    })),
    ...t.devices.map((d) => ({
      id: d.id, type: 'device', zIndex: 2, data: { racked: racks.byDevice.has(d.id) }, deletable: !locked,
      position: dragging?.id === d.id ? dragging : racks.byDevice.get(d.id)?.at[d.id] ?? { x: d.x, y: d.y },
      selected: d.id === selected, measured: measured[d.id],
    })),
  ], [racks, t.devices, selected, measured, dragging, locked]);

  // Where each device and its Tx and Rx handles are, as React Flow measured them; a string, so routes recompute only when one moved.
  const geometry = useFlowStore((s) => JSON.stringify([...s.nodeLookup.values()].filter((n) => n.type === 'device').map((n) => [
    n.id, { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 0, h: n.measured.height ?? 0 },
    bottoms(n.internals.handleBounds?.source), bottoms(n.internals.handleBounds?.target),
  ])));
  const edges = useMemo(() => {
    const boxes = new Map<string, [Rect, Record<string, Pt>, Record<string, Pt>]>(
      (JSON.parse(geometry) as [string, Rect, Record<string, Pt>, Record<string, Pt>][]).map(([id, box, tx, rx]) => [id, [box, tx, rx]]));
    const rects = [...boxes.values()].map(([box]) => box);
    const fibers = new Map(visibleLinks(t, cat, view).flatMap((l): [string, Fiber][] => {
      const [[srcBox, tx] = [], [dstBox, , rx] = []] = [boxes.get(l.a.device), boxes.get(l.b.device)];
      const [pa, pb] = [tx?.[handleOf(l.a)], rx?.[handleOf(l.b)]];
      if (!srcBox || !dstBox || !pa || !pb) return [];
      const port = (box: Rect, p: Pt) => ({ x: box.x + p.x, y: box.y + p.y });
      return [[l.id, { id: l.id, src: port(srcBox, pa), dst: port(dstBox, pb), srcBox, dstBox, manual: l.routes?.canvas }]];
    }));
    const routes = layout([...fibers.values()], rects);
    // The box's light, on a fiber whose two ends are both on the box the state is from. Its ends sit under the device's
    // ports, so their dBm go in the fiber's label (outside L1, whose label is the path) instead of beside the ends.
    const boxOf = (l: Link) => { const s = stateFor(live, byId(t.devices, l.a.device)); return s && stateFor(s, byId(t.devices, l.b.device)); };
    const dBm = (v?: number) => v?.toFixed(2) ?? '?';
    return edgesFor(t, cat, view, selected, (l) => {
      const lit = light(boxOf(l), t, l, cat);
      return {
        ...(lit && view !== 'L1' && (lit.tx ?? lit.rx) !== undefined ? { label: `${dBm(lit.tx)} → ${dBm(lit.rx)} dBm` } : {}),
        light: lit && { ...lit, tx: undefined, rx: undefined },
        route: routes.get(l.id),
        onMove: (pts, run, dx, dy) => { const r = moveRun(fibers.get(l.id)!, pts, run, dx, dy, rects); if (r) setRoute(l.id, 'canvas', r); },
        onReset: () => setRoute(l.id, 'canvas'),
      };
    });
  }, [t, cat, view, selected, geometry, setRoute, live]);

  return (
    <div
      className="canvas"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const chassis = e.dataTransfer.getData(CHASSIS_MIME);
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const [x, y] = [Math.round(p.x), Math.round(p.y)];
        if (e.dataTransfer.types.includes(RACK_MIME)) return addRack(x, y);
        // Dropped on a rack, it goes into it, where it was dropped.
        const frame = racks.frames.find((f) => within(p, f.rect));
        if (chassis) addDevice(chassis, x, y, frame && { rack: frame.rack.id, index: indexAt(frame, '', p, measured) });
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Strict}
        nodesDraggable={!locked}
        connectionLineType={ConnectionLineType.Straight}
        onNodesChange={(changes) => changes.forEach((c) => {
          if (c.type === 'dimensions' && c.dimensions) { const size = c.dimensions; setMeasured((m) => ({ ...m, [c.id]: size })); }
          if (c.type === 'position' && c.position) {
            const [x, y] = [Math.round(c.position.x), Math.round(c.position.y)];
            if (racks.byRack.has(c.id)) moveRack(c.id, x, y); // its devices move with it
            else if (racks.byDevice.has(c.id)) setDragging({ id: c.id, x, y }); // placed once dropped
            else updateDevice(c.id, { x, y });
          }
          if (c.type === 'select') select(c.id, c.selected);
          // A rack goes, its devices stay on the canvas where they were.
          if (c.type === 'remove') racks.byRack.has(c.id) ? deleteRack(c.id, racks.byRack.get(c.id)!.at) : deleteDevice(c.id);
        })}
        // A device dropped on a rack goes into it, above the first device lower down; one dragged out of its rack stays
        // where it was dropped.
        onNodeDragStop={(e, node) => {
          setDragging(null);
          if (node.type !== 'device') return;
          const at = 'clientX' in e ? e : e.changedTouches[0];
          const p = screenToFlowPosition({ x: at.clientX, y: at.clientY });
          const frame = racks.frames.find((f) => within(p, f.rect));
          if (frame) place(node.id, { rack: frame.rack.id, index: indexAt(frame, node.id, p, measured) });
          else if (racks.byDevice.has(node.id)) place(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
        }}
        onEdgesChange={(changes) => changes.forEach((c) => {
          if (c.type === 'select') select(c.id, c.selected);
          if (c.type === 'remove') deleteLink(c.id);
        })}
        onConnect={(c) => connect(endOf(c.source, c.sourceHandle), endOf(c.target, c.targetHandle))}
        onConnectEnd={() => { lastConnect.current = Date.now(); }}
        onNodeClick={(e, node) => {
          // A click on a port, or the click that ends a fiber drag, does not open the device. A card in a rack opens at it.
          if (node.type !== 'device' || (e.target as Element).closest('.react-flow__handle') || Date.now() - lastConnect.current < 300) return;
          setOpenDevice(node.id, (e.target as Element).closest('.slot.filled')?.getAttribute('data-slot'));
        }}
        deleteKeyCode={modalOpen ? null : ['Backspace', 'Delete']}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        elevateNodesOnSelect={false} // a selected rack stays behind its devices
        fitView={fitOnOpen}
        fitViewOptions={fitOptions}
      >
        <Background />
        {!t.devices.length && !t.racks?.length && <div className="empty-hint">Drag hardware from the palette below onto the canvas</div>}
        <Controls fitViewOptions={fitOptions} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

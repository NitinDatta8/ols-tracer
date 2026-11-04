import {
  Background, BaseEdge, ConnectionLineType, ConnectionMode, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, ReactFlow,
  getStraightPath, useReactFlow, useStore as useFlowStore, useUpdateNodeInternals,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { byId } from './catalog';
import { behaviorOf, roleOf, showsInView, toneOf } from './ports';
import { light, stateFor, type Light } from './live';
import { AlarmButton } from './PhysicalView';
import { Pipe } from './Pipe';
import { layout, moveRun, type Fiber, type Pt, type Rect, type Route } from './route';
import { alarms, fiberable, fibersAt, path, resolve, sameEnd } from './rules';
import { useCatalog, useStore } from './store';
import type { Catalog, Device, End, Link, Topology, View } from './types';

export const CHASSIS_MIME = 'application/x-ols-chassis';

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

/** Ports that can take a fiber: those with a pluggable or a fixed connector. */
function portsOf(t: Topology, cat: Catalog, d: Device) {
  return Object.entries(d.slots).flatMap(([slot, s]) =>
    (byId(cat.linecards, s.linecard)?.ports ?? []).flatMap((p) => {
      const end = { device: d.id, slot, port: p.id };
      const { pluggable, fixed } = resolve(t, cat, end);
      return pluggable || fixed ? [{ end, port: p, pluggable }] : [];
    }),
  );
}

export const ChassisIcon = () => (
  <svg className="icon" width="48" height="30" viewBox="0 0 48 30">
    <rect x="1" y="1" width="46" height="28" rx="3" />
    {[8, 14, 20].map((y) => <line key={y} x1="6" x2="42" y1={y} y2={y} />)}
    <circle cx="40" cy="25" r="2" />
  </svg>
);

function DeviceNode({ id }: NodeProps) {
  const t = useStore((s) => s.topology)!;
  const view = useStore((s) => s.view);
  const cat = useCatalog();
  const device = byId(t.devices, id);
  const ports = device ? portsOf(t, cat, device) : [];

  // React Flow measures handles on mount and on resize, but a new pluggable can add a handle without resizing
  // the node, so re-measure when the set changes. (Not on mount: that would fit the view before every node is
  // measured.) Views only dim ports, so they never change the handles.
  const updateNodeInternals = useUpdateNodeInternals();
  const handles = ports.map((p) => handleOf(p.end)).join();
  const measuredHandles = useRef(handles);
  useEffect(() => {
    if (measuredHandles.current === handles) return;
    measuredHandles.current = handles;
    updateNodeInternals(id);
  }, [id, handles, updateNodeInternals]);

  if (!device) return null;
  return (
    <div className="device">
      {/* No handler: a click opens the device, where each level shows its own alarms. */}
      <AlarmButton list={alarms(t, cat, device)} />
      <ChassisIcon />
      <div className="name">{device.name}</div>
      <div className="model">{byId(cat.chassis, device.chassis)?.name ?? `unknown chassis ${device.chassis}`}</div>
      {ports.length > 0 && (
        <div className="ports">
          {ports.map(({ end, port, pluggable }) => {
            const lit = fibersAt(t, end);
            return (
              <div key={handleOf(end)} className={`port ${toneOf(port)}${showsInView(view, port) ? '' : ' off'}`} title={`${path(t, end)} · ${roleOf(port)} · ${pluggable?.name ?? 'fixed Tx/Rx'}`}>
                {handleOf(end)}
                <div className="lc">
                  <Handle id={handleOf(end)} type="source" position={Position.Bottom} className={`strand${lit.tx ? ' lit' : ''}`}>Tx</Handle>
                  <Handle id={handleOf(end)} type="target" position={Position.Bottom} className={`strand${lit.rx ? ' lit' : ''}`}>Rx</Handle>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
      id, type: 'fiber', data: { ...data, lane }, selected: id === selected, selectable: !data.service, deletable: !data.service,
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

const nodeTypes = { device: DeviceNode };
const fitOptions = { maxZoom: 1 };
const edgeTypes = { fiber: FiberEdge };

export function Canvas() {
  const t = useStore((s) => s.topology)!;
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selected);
  const modalOpen = useStore((s) => !!s.openDevice);
  const live = useStore((s) => s.live);
  const cat = useCatalog();
  const { addDevice, updateDevice, deleteDevice, select, connect, deleteLink, setOpenDevice, setRoute } = useStore.getState();
  const { screenToFlowPosition } = useReactFlow();
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const lastConnect = useRef(0);
  // Fit opened/restored topologies once; an empty new project must not re-center on its first drop.
  const [fitOnOpen] = useState(t.devices.length > 0);

  // Nodes are derived from the store plus React Flow's measured sizes (it needs them back, e.g. for the minimap).
  const nodes = useMemo<Node[]>(() => t.devices.map((d) => ({
    id: d.id, type: 'device', position: { x: d.x, y: d.y }, data: {},
    selected: d.id === selected, measured: measured[d.id],
  })), [t.devices, selected, measured]);

  // Where each device and its Tx and Rx handles are, as React Flow measured them; a string, so routes recompute only when one moved.
  const geometry = useFlowStore((s) => JSON.stringify([...s.nodeLookup.values()].map((n) => [
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
        const { x, y } = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (chassis) addDevice(chassis, Math.round(x), Math.round(y));
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Strict}
        connectionLineType={ConnectionLineType.Straight}
        onNodesChange={(changes) => changes.forEach((c) => {
          if (c.type === 'dimensions' && c.dimensions) { const size = c.dimensions; setMeasured((m) => ({ ...m, [c.id]: size })); }
          if (c.type === 'position' && c.position) updateDevice(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
          if (c.type === 'select') select(c.id, c.selected);
          if (c.type === 'remove') deleteDevice(c.id);
        })}
        onEdgesChange={(changes) => changes.forEach((c) => {
          if (c.type === 'select') select(c.id, c.selected);
          if (c.type === 'remove') deleteLink(c.id);
        })}
        onConnect={(c) => connect(endOf(c.source, c.sourceHandle), endOf(c.target, c.targetHandle))}
        onConnectEnd={() => { lastConnect.current = Date.now(); }}
        onNodeClick={(e, node) => {
          // A click on a port, or the click that ends a fiber drag, does not open the device.
          if ((e.target as Element).closest('.react-flow__handle') || Date.now() - lastConnect.current < 300) return;
          setOpenDevice(node.id);
        }}
        deleteKeyCode={modalOpen ? null : ['Backspace', 'Delete']}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        fitView={fitOnOpen}
        fitViewOptions={fitOptions}
      >
        <Background />
        <Controls fitViewOptions={fitOptions} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

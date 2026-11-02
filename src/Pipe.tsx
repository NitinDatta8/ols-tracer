import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { layout, moveRun, type Fiber, type Pt, type Rect, type Route, type Spacing } from './route';
import { path } from './rules';
import { useStore } from './store';
import type { Light } from './live';
import type { Link } from './types';

/** Arrow glyph plus spacing, repeated along the pipe; one step of the flow animation, in pipe widths. */
const ARROWS = '▶ ';
const STEP = 2;

export interface PipeProps {
  id: string;
  route: Route;
  tip: string;
  width: number;
  /** The arrows flow from the route's end back to its start. */
  reverse?: boolean;
  /** The light the box reports on it: dark stops the arrows and greys the pipe; its dBm show at the ends. */
  light?: Light | null;
  selected?: boolean;
  /** Screen pixels per route unit, read when a drag starts (the canvas zoom). */
  scale?: () => number;
  onMove?: (pts: Pt[], run: number, dx: number, dy: number) => void;
  onReset?: () => void;
  onSelect?: () => void;
}

/** A power at a pipe's end, left of its pin. Only on pipes wide enough to read it by (the card level); thinner ones have it in their tooltip. */
const End = ({ p, w, v }: { p: Pt; w: number; v?: number }) => v === undefined || w < 10 ? null : (
  <text className="dbm" x={p.x - w} y={p.y + w * 1.6} textAnchor="end" fontSize={Math.max(9, w * 0.9)}>{v.toFixed(2)} dBm</text>
);

/**
 * A fiber as a yellow pipe along its route. Big arrows inside it flow from Tx to Rx, filling the pipe.
 * A selected pipe shows a grip on each run it can move: drag it sideways,
 * double-click it to route the fiber automatically again. Used on the canvas and in the physical view.
 */
export function Pipe({ id: key, route, tip, width: w, reverse, light, selected, scale = () => 1, onMove, onReset, onSelect }: PipeProps) {
  const id = key.replace(/\W/g, '_'); // for the arrow paths' element ids
  const grab = (e: ReactPointerEvent, run: number) => {
    e.stopPropagation();
    const [base, x0, y0, zoom] = [route.pts, e.clientX, e.clientY, scale()];
    const snap = (v: number) => Math.round(v / zoom / 5) * 5;
    const move = (m: PointerEvent) => onMove?.(base, run, snap(m.clientX - x0), snap(m.clientY - y0));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const { pts } = route;
  const step = STEP * w;
  const n = Math.ceil(route.len / step) + 2;
  return (
    <g className={`pipe-g${selected ? ' selected' : ''}${light?.dark ? ' dark' : ''}`} onClick={onSelect}>
      <title>{[tip, ...(light?.notes ?? [])].join('\n')}</title>
      <path className="pipe" d={route.d} strokeWidth={w + 3} />
      <path className="pipe-fill" d={route.d} strokeWidth={w} />
      <defs><path id={`pipe-${id}`} d={reverse ? route.back : route.d} /></defs>
      {!light?.dark && <text className="flow" fontSize={w * 1.4}>
        {/* textLength pins each arrow to one step whatever the font, so the flow loops seamlessly. */}
        <textPath href={`#pipe-${id}`} textLength={n * step} lengthAdjust="spacing">
          {ARROWS.repeat(n)}
          <animate attributeName="startOffset" from={-step} to={0} dur="0.8s" repeatCount="indefinite" />
        </textPath>
      </text>}
      <End p={reverse ? pts.at(-1)! : pts[0]} w={w} v={light?.tx} />
      <End p={reverse ? pts[0] : pts.at(-1)!} w={w} v={light?.rx} />
      {selected && onMove && pts.slice(1, -2).map((a, k) => {
        const b = pts[k + 2];
        return (
          <g key={k} className={`grip nodrag nopan ${a.y === b.y ? 'ns' : 'ew'}`} onPointerDown={(e) => grab(e, k + 1)} onDoubleClick={onReset}>
            <path d={`M${a.x},${a.y}L${b.x},${b.y}`} strokeWidth={w + 4} />
            <rect x={(a.x + b.x) / 2 - 4} y={(a.y + b.y) / 2 - 4} width={8} height={8} />
          </g>
        );
      })}
    </g>
  );
}

/**
 * A fiber to draw over a faceplate, from the element marked data-pipe-end={a} to the one marked {b}.
 * `reverse` when a is its Rx end, so its arrows flow from b to a.
 */
export interface PipeEnds { link: Link; a: string; b: string; reverse?: boolean }

/**
 * Pipes over a faceplate (the parent element). An end is an element marked data-pipe-end: the pipe leaves from its
 * bottom (its top with data-pipe-top), clear of the nearest [data-pipe-box] around it. Pipes keep clear of every
 * [data-pipe-box]. Click a pipe to select it and move its runs; moved runs are saved per `view`.
 */
export function PipeLayer({ view, ends, spacing, width, light }: { view: string; ends: PipeEnds[]; spacing: Spacing; width: number; light?: (l: Link) => Light | null }) {
  const t = useStore((s) => s.topology)!;
  const ref = useRef<SVGSVGElement>(null);
  const [geometry, setGeometry] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Re-measure after every render; a string, so it only re-renders when something moved.
  useLayoutEffect(() => {
    const host = ref.current!.parentElement!;
    const o = host.getBoundingClientRect();
    const k = o.width / host.offsetWidth || 1; // screen pixels per CSS pixel: the physical view scales its faceplate to fit
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k };
    };
    const boxes = [...host.querySelectorAll('[data-pipe-box]')].map(rect);
    const pins = Object.fromEntries([...host.querySelectorAll('[data-pipe-end]')].map((el) => {
      const [r, top] = [rect(el), el.hasAttribute('data-pipe-top')];
      return [el.getAttribute('data-pipe-end'), { p: { x: r.x + r.w / 2, y: top ? r.y : r.y + r.h }, box: rect(el.closest('[data-pipe-box]') ?? el), top }];
    }));
    const next = JSON.stringify({ boxes, pins, w: host.scrollWidth, h: host.scrollHeight, k });
    if (next !== geometry) setGeometry(next);
  });

  // A click anywhere but on a pipe deselects it.
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest('.pipe-g')) setSelected(null); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, []);

  if (!geometry) return <svg ref={ref} className="pipes" />;
  const { boxes, pins, w, h, k } = JSON.parse(geometry) as { boxes: Rect[]; pins: Record<string, { p: Pt; box: Rect; top: boolean }>; w: number; h: number; k: number };
  const fibers = new Map(ends.flatMap(({ link, a, b }): [string, Fiber][] => {
    const [pa, pb] = [pins[a], pins[b]];
    return pa && pb ? [[link.id, { id: link.id, src: pa.p, dst: pb.p, srcBox: pa.box, dstBox: pb.box, dstTop: pb.top, manual: link.routes?.[view] }]] : [];
  }));
  const routes = layout([...fibers.values()], boxes, spacing);
  const { setRoute } = useStore.getState();
  return (
    <svg ref={ref} className="pipes" width={w} height={h}>
      {ends.map(({ link, a, b, reverse }) => {
        const route = routes.get(link.id);
        // A far end (a terminal under the card) is another card's port: its dBm stay in the tooltip.
        const lit = light?.(link);
        const far = b.startsWith('far:');
        const shown = lit && { ...lit, tx: far && reverse ? undefined : lit.tx, rx: far && !reverse ? undefined : lit.rx };
        return route && (
          <Pipe key={link.id} id={`${view}-${link.id}`} route={route} width={width} reverse={reverse} light={shown} selected={selected === link.id} scale={() => k}
            tip={`${path(t, link.a)} Tx → ${path(t, link.b)} Rx`}
            onSelect={() => setSelected(link.id)}
            onMove={(pts, run, dx, dy) => { const r = moveRun(fibers.get(link.id)!, pts, run, dx, dy, boxes, spacing); if (r) setRoute(link.id, view, r); }}
            onReset={() => setRoute(link.id, view)} />
        );
      })}
    </svg>
  );
}

// Fiber routing on the canvas: straight runs only, around devices, user-movable runs,
// shared runs spread apart and a hop where two fibers cross.

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** A fiber from port to port. Ports sit at the bottom of their box, so fibers leave downwards, unless `dstTop`. */
export interface Fiber { id: string; src: Pt; dst: Pt; srcBox: Rect; dstBox: Rect; dstTop?: boolean; manual?: Pt[] }

export interface Route { pts: Pt[]; d: string; back: string; len: number }

/** Clearance kept around boxes, gap between fibers sharing a run, and radius of the hop over a crossing fiber. */
export interface Spacing { margin: number; lane: number; hop: number }
export const CANVAS: Spacing = { margin: 20, lane: 18, hop: 9 };

const BEND = 40; // a bend costs as much as this much fiber

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

/** Does the straight run a-b pass through the inside of r? */
const blocks = (r: Rect, a: Pt, b: Pt) =>
  Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h;

/** True when no run of `pts` comes closer than the margin to a box. */
const clear = (pts: Pt[], rects: Rect[], m: number) =>
  pts.every((p, i) => !i || rects.every((r) => !blocks(grow(r, m - 1), pts[i - 1], p)));

/** Adds a corner (vertical first) between points that are not in line. */
const ortho = (pts: Pt[]) =>
  pts.flatMap((p, i) => (i && p.x !== pts[i - 1].x && p.y !== pts[i - 1].y ? [{ x: pts[i - 1].x, y: p.y }, p] : [p]));

/** Drops repeated points and points in the middle of a straight run. */
function simplify(pts: Pt[]) {
  const out: Pt[] = [];
  for (const p of pts) {
    const [a, b] = [out.at(-2), out.at(-1)];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    out.push({ ...p });
  }
  return out;
}

/** Just below the box, under the port (or above it). */
const stub = (p: Pt, box: Rect, m: number, top?: boolean) => ({ x: p.x, y: top ? box.y - m : box.y + box.h + m });
const stubs = (f: Fiber, m: number) => [stub(f.src, f.srcBox, m), stub(f.dst, f.dstBox, m, f.dstTop)] as const;

/** Fewest bends, then shortest, from a to b over the grid of lines just clear of each device. */
function autoRoute(a: Pt, b: Pt, rects: Rect[], m: number): Pt[] {
  const solid = rects.map((r) => grow(r, m - 1));
  const out = rects.map((r) => grow(r, m));
  const lines = (k: 'x' | 'y', size: 'w' | 'h') =>
    [...new Set([a[k], b[k], ...out.flatMap((r) => [r[k], r[k] + r[size]])])].sort((m, n) => m - n);
  const [xs, ys] = [lines('x', 'w'), lines('y', 'h')];
  const pt = (s: number) => ({ x: xs[(s >> 2) % xs.length], y: ys[Math.floor((s >> 2) / xs.length)] });
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // direction 0, 1 horizontal; 2, 3 vertical
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  const start = (ys.indexOf(a.y) * xs.length + xs.indexOf(a.x)) * 4 + 2; // leaves downwards
  const heap = new Heap();
  heap.push(0, start);
  cost.set(start, 0);
  while (heap.size) {
    const [c, s] = heap.pop();
    if (c > cost.get(s)!) continue;
    const here = pt(s);
    if (here.x === b.x && here.y === b.y) {
      const path = [here];
      for (let k = s; prev.has(k); k = prev.get(k)!) path.unshift(pt(prev.get(k)!));
      return path;
    }
    const [i, j] = [(s >> 2) % xs.length, Math.floor((s >> 2) / xs.length)];
    steps.forEach(([di, dj], dir) => {
      const [ni, nj] = [i + di, j + dj];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) return;
      const next = { x: xs[ni], y: ys[nj] };
      if (solid.some((r) => blocks(r, here, next))) return;
      const n = (nj * xs.length + ni) * 4 + dir;
      const nc = c + Math.abs(next.x - here.x) + Math.abs(next.y - here.y) + ((s & 3) >> 1 === dir >> 1 ? 0 : BEND);
      if (nc >= (cost.get(n) ?? Infinity)) return;
      cost.set(n, nc);
      prev.set(n, s);
      heap.push(nc, n);
    });
  }
  return ortho([a, b]); // walled in, e.g. by overlapping devices
}

class Heap {
  private h: [number, number][] = [];
  get size() { return this.h.length; }
  push(c: number, s: number) {
    const h = this.h;
    h.push([c, s]);
    for (let i = h.length - 1, p = (i - 1) >> 1; i && h[p][0] > h[i][0]; i = p, p = (i - 1) >> 1) [h[p], h[i]] = [h[i], h[p]];
  }
  pop() {
    const h = this.h;
    const top = h[0];
    const last = h.pop()!;
    if (!h.length) return top;
    h[0] = last;
    for (let i = 0; ;) {
      const [l, r] = [2 * i + 1, 2 * i + 2];
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) return top;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
}

/** The fiber's route moved by the user, or null if that would take it over a device. */
const manualRoute = (f: Fiber, manual: Pt[], rects: Rect[], m: number) => {
  const [a, b] = stubs(f, m);
  const mid = ortho([a, ...manual, b]);
  return clear(mid, rects, m) ? mid : null;
};

/** Corners from port to port: the user's route while it stays clear of every box, else an automatic one. */
const routeOf = (f: Fiber, rects: Rect[], m: number) =>
  simplify([f.src, ...((f.manual && manualRoute(f, f.manual, rects, m)) ?? autoRoute(...stubs(f, m), rects, m)), f.dst]);

/**
 * Fibers sharing a run are spread a lane apart so each stays visible: around the run, else to one side of it,
 * whichever keeps them clear of every box (a run just under a device must not be pushed up into it). Port ends stay put.
 */
function nudge(routes: Pt[][], lane: number, rects: Rect[]) {
  for (const [along, across] of [['x', 'y'], ['y', 'x']] as const) {
    const runs = routes.flatMap((r) => r.slice(1, -2).map((a, i) => ({ a, b: r[i + 2] })).filter(({ a, b }) => a[across] === b[across]));
    const lo = (s: (typeof runs)[number]) => Math.min(s.a[along], s.b[along]);
    const hi = (s: (typeof runs)[number]) => Math.max(s.a[along], s.b[along]);
    const groups = new Map<number, typeof runs>();
    for (const run of runs) {
      const key = run.a[across];
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    for (const group of groups.values()) {
      group.sort((s, t) => lo(s) - lo(t));
      let cluster: typeof runs = [];
      let end = -Infinity;
      for (const s of [...group, null]) {
        if (s && lo(s) < end) { cluster.push(s); end = Math.max(end, hi(s)); continue; }
        const n = cluster.length;
        const clearFrom = (k: number) => cluster.every((c, i) => rects.every((r) =>
          !blocks(grow(r, lane / 2), { ...c.a, [across]: c.a[across] + (k + i) * lane }, { ...c.b, [across]: c.b[across] + (k + i) * lane })));
        const first = [-(n - 1) / 2, 0, 1 - n].find(clearFrom) ?? -(n - 1) / 2;
        cluster.forEach((c, i) => { const d = (first + i) * lane; c.a[across] += d; c.b[across] += d; });
        cluster = s ? [s] : [];
        end = s ? hi(s) : end;
      }
    }
  }
}

/** SVG path through the corners; horizontal runs hop over the vertical runs of other fibers. */
function pathOf(r: Pt[], verticals: [Pt, Pt][], hop: number) {
  return r.map((p, i) => {
    if (!i) return `M${p.x},${p.y}`;
    const a = r[i - 1];
    if (a.y !== p.y) return `L${p.x},${p.y}`;
    const dir = Math.sign(p.x - a.x);
    const xs = verticals
      .filter(([u, v]) => (u.x - a.x) * dir > hop && (p.x - u.x) * dir > hop && Math.min(u.y, v.y) < p.y && Math.max(u.y, v.y) > p.y)
      .map(([u]) => u.x)
      .sort((m, n) => (m - n) * dir)
      .filter((x, k, all) => !k || (x - all[k - 1]) * dir > 2 * hop);
    return xs.map((x) => `L${x - hop * dir},${p.y}A${hop},${hop} 0 0 ${dir > 0 ? 1 : 0} ${x + hop * dir},${p.y}`).join('') + `L${p.x},${p.y}`;
  }).join('');
}

/** Routes every fiber, then spreads shared runs and adds the hops. */
export function layout(fibers: Fiber[], rects: Rect[], s = CANVAS): Map<string, Route> {
  const all = fibers.map((f) => routeOf(f, rects, s.margin));
  nudge(all, s.lane, rects);
  const verticals = all.map((r) => r.slice(1).map((p, i) => [r[i], p] as [Pt, Pt]).filter(([a, b]) => a.x === b.x));
  return new Map(fibers.map((f, k) => {
    const others = verticals.filter((_, j) => j !== k).flat();
    const pts = all[k];
    const len = pts.reduce((sum, p, i) => sum + (i && Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y)), 0);
    return [f.id, { pts, d: pathOf(pts, others, s.hop), back: pathOf([...pts].reverse(), others, s.hop), len }];
  }));
}

/**
 * Moves run i of a route (corners `pts`) sideways by dx or dy, whichever is across it.
 * Returns the corners to save as the fiber's route, or null if it would cross a device.
 */
export function moveRun(f: Fiber, pts: Pt[], i: number, dx: number, dy: number, rects: Rect[], s = CANVAS) {
  const moved = pts.map((p, k) => (k === i || k === i + 1 ? (pts[i].y === pts[i + 1].y ? { ...p, y: p.y + dy } : { ...p, x: p.x + dx }) : p));
  const manual = simplify(moved.slice(1, -1));
  return manualRoute(f, manual, rects, s.margin) ? manual : null;
}

// Fiber routing on the canvas, case by case: straight runs only, around the devices, a route moved by hand kept while it
// stays clear, shared runs spread apart, and a way out when a device is walled in.
import { describe, expect, it } from 'vitest';
import { CANVAS, layout, moveRun, type Fiber, type Pt, type Rect } from '../../src/route';

const box = (x: number, y = 0, w = 100, h = 60): Rect => ({ x, y, w, h });
const port = (r: Rect, dx: number): Pt => ({ x: r.x + dx, y: r.y + r.h - 5 });
const fiber = (id: string, from: Rect, to: Rect, dx = 30, extra: Partial<Fiber> = {}): Fiber => ({ id, src: port(from, dx), dst: port(to, dx), srcBox: from, dstBox: to, ...extra });
/** Every corner after the first is in line with the one before it. */
const straight = (pts: Pt[]) => pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
/** No run passes through the inside of a box. */
const clear = (pts: Pt[], rects: Rect[]) => pts.every((p, i) => !i || rects.every((r) => {
  const q = pts[i - 1];
  return !(Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h);
}));

describe('layout', () => {
  it('has nothing to route with no fibers', () => {
    expect(layout([], [box(0)]).size).toBe(0);
  });

  it('runs a fiber from port to port in straight runs clear of every box, its length the sum of its runs', () => {
    const [a, b, c] = [box(0), box(200, 0, 100, 200), box(400)];
    const r = layout([fiber('f1', a, c)], [a, b, c]).get('f1')!;
    expect(straight(r.pts)).toBe(true);
    expect([r.pts[0], r.pts.at(-1)]).toEqual([port(a, 30), port(c, 30)]);
    expect(clear(r.pts.slice(1, -1), [a, b, c])).toBe(true);
    expect(r.len).toBe(r.pts.reduce((n, p, i) => n + (i && Math.abs(p.x - r.pts[i - 1].x) + Math.abs(p.y - r.pts[i - 1].y)), 0));
    expect(r.d.startsWith(`M${r.pts[0].x},${r.pts[0].y}`)).toBe(true);
    expect(r.back.startsWith(`M${r.pts.at(-1)!.x},${r.pts.at(-1)!.y}`)).toBe(true);
  });

  it('comes in from above a port whose fiber lands on its top', () => {
    const [a, c] = [box(0), box(400, 300)];
    const r = layout([fiber('f1', a, c, 30, { dst: { x: 430, y: 305 }, dstTop: true })], [a, c]).get('f1')!;
    expect(r.pts.at(-2)).toEqual({ x: 430, y: 300 - CANVAS.margin });
  });

  it('spreads fibers sharing a run a lane apart, each still clear of the boxes', () => {
    const [a, c] = [box(0), box(400)];
    const routes = layout([fiber('f1', a, c, 20), fiber('f2', a, c, 50), fiber('f3', a, c, 80)], [a, c]);
    const lows = ['f1', 'f2', 'f3'].map((id) => Math.max(...routes.get(id)!.pts.map((p) => p.y))).sort((m, n) => m - n);
    expect([lows[1] - lows[0], lows[2] - lows[1]]).toEqual([CANVAS.lane, CANVAS.lane]);
    for (const r of routes.values()) expect(clear(r.pts.slice(1, -1), [a, c])).toBe(true);
  });

  it("keeps a route moved by hand while it stays clear, and routes it again once a device is in its way", () => {
    const [a, c] = [box(0), box(400)];
    const manual = [{ x: 30, y: 200 }, { x: 430, y: 200 }];
    const kept = layout([fiber('f1', a, c, 30, { manual })], [a, c]).get('f1')!;
    expect(kept.pts.some((p) => p.y === 200)).toBe(true);
    const blocker = box(150, 150, 100, 100);
    const rerouted = layout([fiber('f1', a, c, 30, { manual })], [a, c, blocker]).get('f1')!;
    expect(clear(rerouted.pts.slice(1, -1), [a, c, blocker])).toBe(true);
  });

  it('still draws a fiber out of a box walled in by others, straight from port to port', () => {
    const inner = box(100, 100, 50, 50);
    const walls = [box(0, 0, 250, 90), box(0, 160, 250, 90), box(0, 0, 90, 250), box(160, 0, 90, 250)];
    const out = box(500, 100);
    const r = layout([fiber('f1', inner, out)], [inner, out, ...walls]).get('f1')!;
    expect(straight(r.pts)).toBe(true);
    expect([r.pts[0], r.pts.at(-1)]).toEqual([port(inner, 30), port(out, 30)]);
  });
});

describe('moveRun', () => {
  it('moves a run sideways, across it, and refuses to put it over a device', () => {
    const [a, b, c] = [box(0), box(200, 0, 100, 60), box(400)];
    const f = fiber('f1', a, c);
    const pts = layout([f], [a, b, c]).get('f1')!.pts;
    const low = pts.findIndex((p, i) => i > 0 && i < pts.length - 2 && p.y === pts[i + 1].y);
    expect(low).toBeGreaterThan(0);
    const down = moveRun(f, pts, low, 0, 50, [a, b, c])!;
    expect(down.some((p) => p.y === pts[low].y + 50)).toBe(true);
    expect(moveRun(f, pts, low, 0, -(pts[low].y - 30), [a, b, c])).toBeNull(); // up into the boxes
    expect(moveRun(f, pts, low, 500, 0, [a, b, c])).toEqual(moveRun(f, pts, low, 0, 0, [a, b, c])); // along it is no move
  });
});

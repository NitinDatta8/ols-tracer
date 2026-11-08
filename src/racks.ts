// Racks on the canvas: where each one is drawn and where its devices sit in it, stacked from the top.
import type { Pt, Rect } from './route';
import type { Rack, Topology } from './types';

/**
 * A rack's frame: a rail either side, its name on top and a foot under its last device, and between two devices a gap
 * for their fibers to leave by. `width` is a chassis front's (482.6 mm at the physical view's 2.35 px/mm), `empty`
 * the height of a rack with nothing in it yet.
 */
export const RACK = { rail: 26, head: 30, gap: 48, foot: 26, width: 1136, empty: 150 };

export type Size = { width: number; height: number };
/** A rack as drawn: its frame, its devices top to bottom and where each one sits. */
export type Frame = { rack: Rack; list: string[]; at: Record<string, Pt>; rect: Rect };

/** Each rack's frame, its devices stacked from the top at their measured heights (a guess until they are measured). */
export function rackLayout(t: Topology, measured: Record<string, Size>) {
  const known = new Set(t.devices.map((d) => d.id));
  const frames = (t.racks ?? []).map((rack): Frame => {
    const list = rack.devices.filter((id) => known.has(id));
    const at: Record<string, Pt> = {};
    let y = rack.y + RACK.head;
    for (const id of list) {
      at[id] = { x: rack.x + RACK.rail, y };
      y += (measured[id]?.height ?? 240) + RACK.gap;
    }
    const w = Math.max(RACK.width, ...list.map((id) => measured[id]?.width ?? 0)) + 2 * RACK.rail;
    return { rack, list, at, rect: { x: rack.x, y: rack.y, w, h: list.length ? y - RACK.gap - rack.y + RACK.foot : RACK.empty } };
  });
  return { frames, byRack: new Map(frames.map((f) => [f.rack.id, f])), byDevice: new Map(frames.flatMap((f) => f.list.map((id) => [id, f] as const))) };
}

export const within = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
/** Where device `id` goes in a rack when dropped at `p`: under every other device whose middle is above p. */
export const indexAt = (f: Frame, id: string, p: Pt, measured: Record<string, Size>) =>
  f.list.filter((o) => o !== id && f.at[o].y + (measured[o]?.height ?? 0) / 2 < p.y).length;

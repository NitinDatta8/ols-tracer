# OLS Tracer: MVP Plan

Based on [the original idea](idea.md). A web app in the style of Cisco Packet Tracer for building OLS (optical line system) topologies. Users drag chassis onto a canvas, fill them with linecards and pluggables, and connect single-mode fiber. People in the industry already know Packet Tracer, so we copy its interaction model instead of inventing a new one.

**Verdict:** a barebones MVP takes about **5 days** for one developer. No backend, no physics, generic SVG graphics.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Platform | Web app: React + TypeScript (Vite) |
| Interaction | Packet Tracer style: drag and drop on a logical canvas; click a device to open its physical view |
| Streams | Each corp gets its own **stream** (catalog). The stream is picked **per project** when the topology is created, and the palette shows only that stream's hardware |
| Vendors | Not decided. The catalog is data-driven, so vendors are only JSON |
| Fiber | Single-mode only. **Duplex cable, auto-crossed:** one drag from port to port wires Tx→Rx and Rx→Tx, so Tx–Tx and Rx–Rx can't happen |
| Rules | **Allowed lists only:** which linecards fit which chassis slots, and which pluggables fit which ports |
| Graphics | Generic SVG boxes generated from the catalog. Real images come later without changing the logic |
| Views | L0, L1 and Data views in the MVP (barebones, see below) |
| Persistence | Save and open a local `.json` file (like a `.pkt`) plus browser autosave. No backend, no auth |

## The 4 levels

| Level | Thing | Where it's edited |
| --- | --- | --- |
| 1 | Chassis | Logical canvas (drag from palette) |
| 2 | Linecards | Physical view: drag into a chassis slot |
| 3 | Pluggables | Physical view: drag into a linecard port |
| 4 | Wiring (Tx/Rx) | Logical canvas: drag fiber port→port. Physical view shows Tx/Rx strands |

## Tech stack

- **React + TypeScript + Vite.**
- **React Flow (`@xyflow/react`)** for the logical canvas. It provides drag-drop nodes, port handles, edges, zoom/pan and minimap.
- **Zustand** for app state (one topology store).
- **Plain SVG** for the physical view modal (chassis → slots → ports).
- No backend.

## Catalog schema (per stream)

One folder per stream. The catalog is the only place vendor or corp data lives.

```
catalog/
  streams.json                 # list of streams
  corp-a/
    chassis.json
    linecards.json
    pluggables.json
  corp-b/
    ...
```

Some linecards exist only in certain streams. The loader merges an optional `catalog/common/` folder into each stream, so shared items are written once.

**`chassis.json`**
```json
[{
  "id": "ch-8slot",
  "name": "8-Slot Chassis",
  "slots": [
    { "id": "1", "allowedLinecards": ["lc-amp", "lc-mux"] },
    { "id": "2", "allowedLinecards": ["lc-amp", "lc-mux", "lc-transponder"] }
  ]
}]
```

**`linecards.json`**
```json
[{
  "id": "lc-transponder",
  "name": "400G Transponder",
  "ports": [
    { "id": "C1", "role": "client", "allowedPluggables": ["qsfp-dd-400g-fr4"] },
    { "id": "L1", "role": "line",   "allowedPluggables": ["qsfp-dd-zr"] }
  ]
}]
```

**`pluggables.json`**
```json
[{ "id": "qsfp-dd-zr", "name": "400G ZR", "formFactor": "QSFP-DD", "fiber": "SMF" }]
```

Allowed lists are checked both ways: a drop is **refused** at drag time, and a loaded file is **re-validated**, with errors listed.

## Topology file (`.olst.json`)

```json
{
  "version": 1,
  "stream": "corp-a",
  "devices": [
    { "id": "d1", "chassis": "ch-8slot", "name": "Site-A", "x": 100, "y": 200,
      "slots": { "2": { "linecard": "lc-transponder",
                        "ports": { "L1": { "pluggable": "qsfp-dd-zr" } } } } }
  ],
  "links": [
    { "id": "f1", "type": "smf",
      "a": { "device": "d1", "slot": "2", "port": "L1" },
      "b": { "device": "d2", "slot": "2", "port": "L1" } }
  ]
}
```

A link stores only endpoints. Tx/Rx strands are derived: `a.Tx→b.Rx`, `b.Tx→a.Rx`.

## Connection rules (MVP)

A fiber can connect two ports only if:
1. Both ports have a pluggable (in Packet Tracer, an empty port has no handle).
2. Both pluggables are SMF.
3. Neither port already has a fiber.
4. The two ports are on different devices or different cards (no loopback for now).

A bad drop is refused, and a tooltip says why. All links are green, because a link either exists and is valid or it can't be drawn.

## Views (barebones)

The same topology, with three canvas filters toggled from the top bar:

| View | Shows |
| --- | --- |
| **L0** (optical) | Every fiber and every port, labeled with the pluggable type. Tx/Rx arrows on hover |
| **L1** | **Line** port links only, labeled with the card-to-card path (e.g. `Site-A/2/L1 ⇄ Site-B/2/L1`) |
| **Data** (Ethernet) | **Client** ports only. Draws a dashed "service" line between client ports whose cards are connected via line ports |

This needs only the `role: client | line` field on ports. Real OTN mapping, wavelengths and services come after the MVP.

## Packet Tracer features: in and out

| In MVP | Out (later) |
| --- | --- |
| Device palette (bottom-left, by category) | Simulation mode (animated signal + event list) |
| Drag device onto canvas, rename, delete | Undo/redo |
| Fiber "connection tool" | Hover inspect tooltips beyond basics |
| Physical view: click device → modal with slots/ports, drag cards and pluggables in | Notes, shapes, clusters |
| Zoom/pan, minimap | Multi-user, accounts |
| Save/open file, autosave | Activity wizard / grading |
| L0 / L1 / Data view toggle | Real images |

## 5-day plan

**Day 1: skeleton + catalog**
- Vite + React + TS + React Flow + Zustand.
- Catalog loader for `streams.json` plus a per-stream folder, with `common/` merge.
- Write 2 dummy streams: 2 chassis, 4 linecards and 4 pluggables each, with some stream-only cards.
- New-project dialog: pick a stream.

**Day 2: logical canvas**
- Palette filtered by stream. Drag a chassis onto the canvas.
- Rename, delete, zoom/pan, minimap.

**Day 3: physical view**
- Click device → SVG modal with slots.
- Drag a linecard into a slot (allowed list enforced) and a pluggable into a port (allowed list enforced).
- Remove card or pluggable. Removing a card also deletes its links, after a confirm.

**Day 4: fiber + rules**
- Port handles appear on the canvas node for each populated port.
- Fiber tool: drag port→port, with the connection rules enforced and refusal reasons shown.
- Tx/Rx strand detail on the link (hover or side panel).

**Day 5: views + save**
- L0 / L1 / Data view toggle.
- Save/open `.olst.json`, re-validate on load, localStorage autosave.
- Smoke test with both dummy streams.

## Out of scope for MVP

- Physics: power budget, fiber loss, OSNR, wavelengths.
- Mutual exclusion, dependencies and chassis limits (rules beyond allowed lists).
- Simulation mode, undo/redo.
- Real equipment images and the image/port mapper tool.
- Backend, accounts, sharing.
- Multimode fiber, MPO/breakout, patch panels, amps as standalone line devices.

## After MVP

1. Real vendor catalogs per stream (you supply the list).
2. Swap SVG boxes for your images, with a small mapper tool to mark slots and ports on an image.
3. More rule types: mutual exclusion (shared lanes, double-width cards), dependencies, chassis limits.
4. Physics: link power budget and margin per fiber.
5. Simulation mode: an animated signal walking the path, like Packet Tracer's packet animation.
6. Real L1/OTN and service modeling.

## Risks

- **Catalog accuracy:** the rules are only as good as the JSON. Keep each stream's catalog under review by someone who knows that hardware.
- **Stream data leaking across corps:** if streams are confidential to each corp, a single build containing every catalog exposes all of them. You may need per-stream builds or a backend later.
- **Allowed lists won't cover everything:** real hardware has combination rules (shared lanes, double-width). These were left out of the MVP on purpose. Design the rule checker as a list of functions so new rule types plug in.
- **Views are cosmetic in the MVP:** L1 and Data are filters, not real layer models. Say so in the demo.
- **Packet Tracer look and feel:** copy the interaction patterns, not Cisco's icons, artwork or branding.

## Open questions

1. **Vendors and streams:** which corps and which hardware go first? Even rough lists help shape the dummy catalog.
2. **Confidentiality:** can every user see every stream, or must a user see only their own corp's stream?
3. **Linecard port roles:** is `client` vs `line` enough for the first cards, or do some ports need more roles (e.g. `osc`, `mon`, `express`)?
4. **Amps, mux/demux and ROADMs:** are these linecards in a chassis, standalone devices on the canvas, or both?
5. **Fiber properties now or later:** should a fiber carry a length (km) in the MVP, even before physics uses it?
6. **Users:** is this for internal engineers, customers or training? That decides polish and the hosting priority.

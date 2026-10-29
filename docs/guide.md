# OLS Tracer guide

How to use OLS Tracer, and how its catalog, rules and code are laid out. To install and run it, see the [README](../README.md). It implements the [MVP plan](mvp-plan.md) and step 2 of the [CLI plan](cli-run-plan.md).

React + TypeScript + Vite, React Flow for the canvas, Zustand (+ Immer) for state, plain SVG for the physical view. The web app has no backend. An optional CLI bridge (`bridge/server.mjs`) runs its commands on a lab box over SSH.

To see everything at once: **Open** → `examples/demo.olst.json`.

## Use

| Do | How |
| --- | --- |
| New project | **New**, pick a corporation. The palette shows only that corporation's hardware |
| Corporation | The dropdown at the top left switches between the five corporations, each with its own hardware. Switching starts a new topology, and asks first if the canvas has devices |
| Add a chassis | Drag it from the bottom palette onto the canvas |
| Physical view | Click a device: its chassis shows as a slot grid, drawn to scale as 19-inch rack gear (EIA-310: a 482.6 mm panel with rack ears, 1U = 44.45 mm high per row of slots, so the 2000 and 2026 are 4×2 and 2U, the 2026-4RU 4×4 and 4U). Each linecard shows a mini cage per port with the photo of what is plugged in and a green dot when a fiber is attached; hover or click those pluggables just like on the card level. Drag linecards into slots (a 2-slot card such as C also takes the slot to its right). Click a linecard to see its whole faceplate, one cage per port; **← Back** in the header goes up a level (card → chassis → canvas). Every level has the same fixed layout: the parts to put in as small icons, centred across the top (linecards at the chassis, drawn as a faceplate with a dot per port; at a card, pluggables in two groups: **pluggable optics** and **DCO**, digital coherent optics; hover one for its name and details), the faceplate under them (scaled up as far as its 19-inch proportions allow, then stretched to fill its whole area, never scrolled), and at the bottom the CLI terminal with the details (datasheet or alarms) beside it. Drag a part onto the faceplate, or click it to pick it: it stays highlighted, every slot or port it fits turns green, and clicking a green one puts it there (click the part again or press Esc to drop the pick). Drag a pluggable into a cage. Hover a pluggable (in the strip or a cage) for its part number and a small photo; click it for its photo, description and properties in the details. Click a linecard tile or the card's name plate for the card's datasheet. Green = fits, a refused drop says why, Esc goes back up. ✕ removes a card or pluggable, and asks first if that deletes fibers. Nothing in the view moves or resizes whatever you click |
| Rear view | **Front** / **Rear** at the top right turn it round (from a card too). The rear is a panel of the same height, with a bay per PSU and fan (2 PSUs and 3 fans on every chassis for now). ✕ pulls one out, **Insert** puts it back. A new chassis has all of them in |
| Alarms | A bell with a count shows wherever there are alarms, at every level: the device on the canvas, each linecard, each port and each PSU or fan. Each counts its own alarms and those below it; red if one is critical, orange if all are major. The inspector lists the alarms of the level shown; click a bell for just its own. Alarms follow the build: **LOS** (critical) on a pluggable or a C card port with no fiber into its Rx, and one (major) per empty PSU or fan bay. Fiber the port or insert the unit and it clears |
| CLI command | The command line at the bottom of the physical view shows, greyed out, the CLI command for what you hover, else what you last clicked, else the level shown: `show chassis 1`, or hover a linecard for `show card 1-3`; on a linecard, the card, or hover a port for `show port 1-3-C2`. A pluggable's datasheet in the inspector, opened from a port, shows its command, which is its port's (`show port 1-3-C2`). **Tab** fills the greyed-out command in (or completes it from what you have typed), and so does clicking into an empty line, selected so that typing replaces it; or type any other command. **Copy** copies it. **Run** (or Enter) runs it, or the greyed-out one on an empty line, on the box through the CLI bridge, and its output streams into the terminal above, which keeps the whole session |
| Box | Type the box's IP next to **← Back** and click **Connect**; the device keeps it. The dot is green while the bridge has the box connected, orange while it connects and grey when it is down (the text next to it says why). Closing the view, or the page, closes the session |
| CLI modes | The prompt left of the command is drawn oh-my-posh style: a segment for the mode the box is in, as wide as its name and warmer the deeper it is: **Normal** (`>`, where the session starts: show commands), `configure` → **Configure** (`#`), `^^^` (Shift+6 three times) → **Engineering**, `bash` → **Bash**, `kgdb` → **kgdb** (application level, to turn things on or off). `exit` goes back one. Each change of mode ends its output with a line describing the new mode; hover the prompt for the whole ladder. The mode is followed from the commands sent, and a new login starts in Normal |
| Wire fiber | A fiber is one strand and runs one way, from a port's **Tx** to a port's **Rx**; big arrows flowing inside the pipe show which way. Each port chip on the canvas has a Tx and an Rx handle (green once fibered): drag from a Tx to an Rx, or the other way round (or click one, then the other). The physical view does the same with each port's Tx/Rx: click one, then the other end's opposite strand, which lights green if it fits. A port's Tx and Rx are independent: 1/C1 Tx can go to 4/C1 Rx while 4/C1 Tx goes somewhere else. A line port can **loop back**, its Tx to its own Rx. A chip appears once its port has a pluggable (a C card's ports have one from the start); hover it to see which. Refused fibers say why |
| Fiber detail | Hover a fiber for where it runs, click it for the side panel (and delete). Under each port of a card's faceplate the physical view says where its Tx goes (→), where its Rx comes from (←) or ↺ for a loopback; at the chassis, hover a port's Tx or Rx for it |
| Delete | Select a fiber or a device on the canvas and press Delete/Backspace |
| Views | **L0** every port and fiber · **L1** line fibers, labelled card-to-card · **Data** client side, dashed services between cards joined by a line fiber. Ports outside the view are dimmed |
| Save / open | **Save** downloads `<stream>.olst.json`; **Open** loads one and re-validates it (problems are listed top right). The browser also autosaves |

## Catalog

```
catalog/
  streams.json              # the five corporations: [{ "id": "corp-a", "name": "Corp A" }, …]
  common/                   # merged into every corporation
  corp-a/ … corp-e/         # each corporation's own chassis.json, linecards.json, pluggables.json, cli.json (each optional)
```

- Stream items override `common/` items with the same id.
- For now there are three chassis in `common/`: **2000** and **2026** (8 slots, 2U) and **2026-4RU** (16 slots, 4U). Their slots, PSUs and fans are placeholders, the same pattern on all three, until the real layouts come; the 8-Slot Chassis in older files and autosaves opens as the 2000. A corporation's own chassis go in its folder. There are two linecard types in port-count variants, all in `common/`: **C** (2 slots wide) as C25, C925 or C1125, and **MX** (1 slot) as 400MX or 800MX. More cards come later. These were C-1, C-9, C-11, MX-4 and MX-8; files and autosaves with the old ids are upgraded when they load. C cards take no pluggables: every port has its own fixed Tx/Rx.
- `chassis.columns` lays the slots out row by row (4 columns → 4×2 for 8 slots). `chassis.category` groups the palette (optional).
- `chassis.psus` and `chassis.fans` are how many PSU and fan bays its back has, named PSU1…PSUn and FAN1…FANn (default none, and then no **Rear** button). A device saves the bays left empty as `emptyBays`, e.g. `["PSU2"]`.
- `chassis.mgmtPorts` lists the management ports drawn in a narrow strip at the left: `front` (USB-C, CON, MON) and `back` (NMS, NMS1, NMS2), where the back shows them left of the PSUs (stacked) and fans. Names starting with `USB` are drawn as USB-C, the rest as RJ-45. They are only drawn: no fibers, alarms or CLI.
- `linecard.width` is how many side-by-side slots a card takes (default 1). It sits in the leftmost one; the slot's allowed list decides where it may start (C: slots 1, 3, 5, 7).
- `linecard.columns` lays its ports out row by row, the same at the chassis and at the card level (default 4 per slot of width: 800MX is 4×2, C925 8 + 1).
- Pluggables come in three form-factor families, each with speed variants: **SFP** (SFP+ 10G, SFP28 25G, DSFP 100G), **QSFP** (QSFP28 100G, QSFP-DD 400G, QSFP-DD800 800G) and **OSFP** (400G, 800G, plus 1.6T in the Corp B stream only).
- A port's `allowedPluggables` lists pluggable ids or whole families: `"QSFP"` takes every QSFP speed, which is how one cage takes 100G, 400G or 800G. An empty list (`[]`) is a fixed port: built-in SMF Tx/Rx, fibered as is, no pluggable.
- `cli.json` (not a list) holds the CLI command templates per level, `chassis`, `card`, `port` and `pluggable`, with `{chassis}`, `{slot}` and `{port}` filled in, and the CLI `modes` in order from Normal: each has a `name`, its `prompt`, the command that `enter`s it from the mode above, and an `about` line shown when the box enters it. A wide card's `{slot}` is its leftmost slot. A pluggable's command is its port's, `show port …`. A stream's `cli.json` overrides `common/`'s level by level.
- Port `role` is `client` or `line`; it drives the L1 and Data views.

- Chassis, linecards and pluggables all carry the same datasheet info, all optional: `vendor`, `part`, `image` (path under `public/`), `url` (a link, or a file under `public/` such as `datasheets/c1125.pdf`), `about` and `specs` (any label → value, shown in the inspector). A pluggable without `image` shows its form factor instead; `dco` groups it under DCO.
- The internal documents the datasheets, port layouts and CLI commands come from go in `docs/internal/` (git-ignored).

Photos live in `public/pluggables/<pluggable id>.jpg`. They and the specs come from Coherent's product pages on coherent.com:

| Pluggable id | Coherent part |
| --- | --- |
| `sfp-10g-lr` | FTLX1475D3BCL, 10GBASE-LR SFP+, 10 km |
| `sfp28-25g-lr` | FTLF1436P4BCL, 25GE LR SFP28, 10 km (no photo found) |
| `qsfp28-100g-lr4` | FTLC1154RDPL, 100GBASE-LR4 QSFP28, 10 km |
| `qsfp28-100g-sr4` | FTLC9558REPM, 100GBASE-SR4 QSFP28, 100 m MMF |
| `qsfp-dd-400g-fr4` | FTCD4313E3PCL, 400G-FR4 QSFP-DD, 2 km |
| `qsfp-dd-zr` | FTCD3323E1PCL, 400ZR QSFP-DD DCO, 120 km |
| `qsfp-dd-800g-zr` | FTCE3326E1PCL, 800ZR QSFP-DD DCO, 120 km |
| `osfp-800g-zr` | FTCE3327E1PCL, 800ZR OSFP DCO, 120 km |
| `osfp-1600g-dr8` | FTCF2519E3PCA, 1.6T-DR8 OSFP, 500 m (Corp B) |
| `cfp2-dco-400g` | FTCD3312M1BCL, 400G CFP2-DCO, 500 km (photo only; CFP2 is not in the catalog) |

`dsfp-100g-lr` and `osfp-400g-zrp` have no Coherent match, so no part or photo.

## Rules

`src/rules.ts` holds them all:

- Allowed lists: `linecardError` (card in slot; a wide card also needs its neighbour slots free and in the same row) and `pluggableError` (pluggable in port).
- `fiberRules` for a fiber from `a`'s Tx to `b`'s Rx, checked in order: both ports have a pluggable (or are fixed), both are SMF, `a`'s Tx and `b`'s Rx are both free, and the ends are not on the same card, except a line port looping back to itself. To add a rule type, add a function to the list.
- `validate` re-checks a whole topology. It runs on every change, so an opened file's problems are listed.
- `alarms` raises a device's alarms from the topology: LOS on each pluggable with no fiber into its Rx and one per empty PSU or fan bay. They are never saved, so they always match the build.

## Code

| File | What |
| --- | --- |
| `src/types.ts` | Catalog and topology (`.olst.json`) types |
| `src/catalog.ts` | Loads `catalog/` at build time and merges `common/` per stream |
| `src/rules.ts` | Lookups, allowed lists, fiber rules, validation, alarms |
| `src/store.ts` | The one Zustand store: topology, actions, autosave |
| `src/Canvas.tsx` | Logical canvas: device nodes, port handles, fibers, views |
| `src/PhysicalView.tsx` | Physical view: chassis slot grid (SVG) and its back (PSU and fan bays), then one linecard's faceplate, pluggable tray, hover card, detail and alarm panels, alarm bells |
| `src/App.tsx` | Top bar, palette, new-project dialog, fiber panel, problems, toast |
| `bridge/server.mjs` | CLI bridge: one persistent SSH session to the box the physical view connects to, runs commands one at a time and streams their output (`/connect`, `/run`, `/disconnect`, `/status`; Vite proxies them under `/bridge`, and it answers only requests from the app) |

## Choices the plan left open

- **Which C and MX ports are client or line** is a guess, until the internal documents replace it: every variant has one line port, L1, and the rest are client ports C1…Cn (C25 is just L1). C clients take QSFP and C's L1 takes OSFP; MX clients take SFP and MX's L1 takes QSFP. Change them in `catalog/common/linecards.json`.
- **A link is one strand**, `a` Tx → `b` Rx; a duplex pair is two links. Files saved before this (when one link meant both strands) open as one strand each, `a` → `b`; add the return strand by hand.
- **Fibers between two cards of one device** are allowed (rule 4) and drawn as a loop under the device. Parallel fibers between two devices are drawn side by side, spread away from the devices. **Loopback** is allowed only on a line port, Tx to its own Rx (no client loopbacks, no port-to-port fibers on one card).
- **Data view** pairs client ports by position (C1↔C1, C2↔C2) on cards whose line ports share a fiber directly, in either direction; a loopback carries no service. No path tracing through amps or muxes; the views are cosmetic, as the plan says.
- **All catalogs ship in one bundle.** See the confidentiality risk in the plan.
- **Alarms are simulated from the build**, since there is no live device: LOS on pluggables with nothing into their Rx and missing PSUs or fans. There are no models of PSU or fan (one generic unit each), no way to fail a unit that is in, and no CLI command for alarms yet.

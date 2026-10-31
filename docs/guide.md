# OLS Tracer guide

How to use OLS Tracer, and how its catalog, rules and code are laid out. To install and run it, see the [README](../README.md). What comes next is in the [roadmap](roadmap.md), and why it is built this way in the [decision log](decisions.md).

React + TypeScript + Vite, React Flow for the canvas, Zustand (+ Immer) for state, plain SVG for the physical view. The web app has no backend. An optional CLI bridge (`bridge/server.mjs`) runs its commands on a lab box over SSH.

To see everything at once: **Open** → `examples/demo.olst.json`.

## Use

| Do | How |
| --- | --- |
| New project | **New**, pick a corporation. The palette shows only that corporation's hardware |
| Corporation | The dropdown at the top left switches between the five corporations, each with its own hardware. Switching starts a new topology, and asks first if the canvas has devices |
| Add a chassis | Drag it from the bottom palette onto the canvas |
| Physical view | Click a device: its chassis shows as a slot grid, drawn to scale as 19-inch rack gear (EIA-310: a 482.6 mm panel with rack ears, 1U = 44.45 mm high per row of slots, so the 2000 and 2026 are 4×2 and 2U, the 2026-4RU 4×4 and 4U). Each linecard shows a mini cage per port, labelled with the port: light when a module is in, a dark recess when empty, slate for a fixed LC port; its Tx and Rx turn green when a fiber is on them. Hover or click those pluggables just like on the card level. Drag linecards into slots (a 2-slot card such as C also takes the slot to its right). Click a linecard to see its slot enlarged to fill the view: the same rows of ports as in the chassis, each cage showing the module's part, form factor and speed (or, when empty, the form factors it takes), with each Tx and Rx saying where its fiber goes; **← Back** in the header goes up a level (card → chassis → canvas). Every level has the same fixed layout: the parts to put in as small text tiles across the top, scrolling sideways when they don't fit (linecards at the chassis, each with its slot width and port count; at a card, pluggables with their form factor and speed, in two groups: **pluggable optics** and **DCO**, digital coherent optics; hover one for its photo and details), the faceplate under them (scaled up as far as its 19-inch proportions allow, then stretched to fill its whole area, never scrolled), and at the bottom the CLI terminal with the details (datasheet or alarms) beside it. Drag a part onto the faceplate, or click it to pick it: it stays highlighted, every slot or port it fits turns green, and clicking a green one puts it there (click the part again or press Esc to drop the pick). Drag a pluggable into a cage. Hover a pluggable (in the strip or a cage) for its part number and a small photo; click it for its photo, description and properties in the details. Click a linecard tile or the card's name plate for the card's datasheet. Green = fits, a refused drop says why, Esc goes back up. ✕ removes a card or pluggable, and asks first if that deletes fibers. Nothing in the view moves or resizes whatever you click |
| Rear view | **Front** / **Rear** at the top right turn it round (from a card too). The rear is a panel of the same height, with a bay per PSU and fan (2 PSUs and 3 fans on every chassis for now). ✕ pulls one out, **Insert** puts it back. A new chassis has all of them in |
| Alarms | A bell with a count shows wherever there are alarms, at every level: the device on the canvas, each linecard, each port and each PSU or fan. Each counts its own alarms and those below it; red if one is critical, orange if all are major. The inspector lists the alarms of the level shown; click a bell for just its own. Alarms follow the build: **LOS** (critical) on a pluggable or a C card port with no fiber into its Rx, and one (major) per empty PSU or fan bay. Fiber the port or insert the unit and it clears |
| CLI command | Under the CLI terminal sits the CLI command for what you hover, else what you last clicked, else the level shown: `show chassis 1`, or hover a linecard for `show card 1-3`; on a linecard, the card, or hover a port for `show port 1-3-C2`. A pluggable's datasheet in the inspector, opened from a port, shows its command, which is its port's (`show port 1-3-C2`). **Copy** copies it. **Run** types it into the terminal and presses Enter |
| Box | Type the box's IP next to **← Back** and click **Connect**; the device keeps it. The dot is green while the bridge has the box connected, orange while it connects and grey when it is down (the text next to it says why). Closing the view, or the page, closes the session |
| CLI terminal | A real terminal (xterm.js) on the box's SSH session, through the CLI bridge: click into it and type as over ssh. Keystrokes go to the box as typed, so its own **Tab** completion, double Tab for the options, **↑**/**↓** history, Ctrl-C, `?` help, paging and modes all work: `configure` → Configure, `^^^` (Shift+6 three times) → Engineering, `bash`, `kgdb`, `exit` back. While it has focus, Esc goes to the box, not the view. It fits its area and the box wraps to its width; a dropped session reopens below what was there |
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
- `linecard.columns` lays its ports out row by row, the same at the chassis and at the card level. By default a card's ports sit as in its 1U slot: one row of up to five per slot of width, else two rows, the top one the longer (800MX 5 over 5, 400MX one row of 5, C1125 10 over 10, OCM 5 over 4).
- Pluggables come in three form-factor families, each with speed variants: **SFP** (SFP+ 10G, SFP28 25G, DSFP 100G), **QSFP** (QSFP28 100G, QSFP-DD 400G, QSFP-DD800 800G) and **OSFP** (400G, 800G, plus 1.6T in the Corp B stream only).
- A port's `allowedPluggables` lists pluggable ids or whole families: `"QSFP"` takes every QSFP speed, which is how one cage takes 100G, 400G or 800G. An empty list (`[]`) is a fixed port: built-in SMF Tx/Rx, fibered as is, no pluggable.
- `cli.json` (not a list) holds the CLI command templates per level, `chassis`, `card`, `port` and `pluggable`, with `{chassis}`, `{slot}` and `{port}` filled in. A wide card's `{slot}` is its leftmost slot. A pluggable's command is its port's, `show port …`. A stream's `cli.json` overrides `common/`'s level by level.
- Port `role` is `client` or `line`; it drives the L1 and Data views.

- Chassis, linecards and pluggables all carry the same datasheet info, all optional: `vendor`, `part`, `image` (path under `public/`), `url` (a link, or a file under `public/` such as `datasheets/c1125.pdf`), `about` and `specs` (any label → value, shown in the inspector). A pluggable without `image` shows its form factor instead; `dco` groups it under DCO.
- Internal capture and generated CLI data now goes in `data/` (for example `data/cli/csp/` and `data/boxes/<box-id>/`).

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

## Poller

The bridge polls the box for its live state, so the canvas can show it later, and records every session as runs under `data/boxes/<box-id>/runs/` (default box id `box3`, configurable with `BOX_DATA_BOX` or `BOX_DATA_ROOT`). Nobody has to capture anything by hand.

- `bridge/poll.json` lists what to run: `{ "prereqs": ["configure", "set cli length 0", …], "commands": [{ "cmd": "show och 1-7-5", "every": 10 }, …] }`. `prereqs` run once per session, first. Every snapshot runs all the `commands` once, and those with `every` > 0 are also polled that often, in seconds. With no commands the poller is off.
- While a box is connected, the poller runs one command at a time, on its own shell of the session, so it never types into the terminal. That shell is a dumb terminal 500 columns wide and 10000 rows tall, so nothing wraps or pages. A command is done when the last line of its output matches `BOX_PROMPT`. If that takes longer than `BOX_TIMEOUT`, the poller sends Ctrl-C and records that the prompt never came.
- `bridge/recorder.mjs` writes a new run folder, `<YYYYMMDD-HHMMSS>-connect`, when the session opens (and when it opens again after a drop), and `<YYYYMMDD-HHMMSS>-alarms` whenever a poll of `show alarm` sees the active alarms change. Each folder holds one snapshot: `raw/NNN_<slug>.txt` per command, `raw/index.jsonl`, `parsed/` and `meta.json` (host name, release, box clock and its offset, prerequisites). The polls until the next snapshot go into its `poll.jsonl`. If a prerequisite fails, nothing is polled, because paging could cut output short. The layout is in the [capture plan](cli-capture-plan.md#run-layout).
- `node bridge/recorder.mjs <run folder>` parses a run's raw output again into `parsed/`, e.g. after a template changed or for a hand capture.
- `bridge/parse.py` takes each output, without its echo and prompt, and turns it into JSON with the TTP template `data/boxes/<box-id>/ttp/templates/<id>.ttp`, where `<id>` is the command's id in `data/cli/csp/cli-index.source.json` (`show och 1-7-5` runs `cli_shortcut_cmds_l1__och__show__och`). `bridge/cli-index.mjs` finds the id, and a command with no template is recorded without a parse. Results keep the CLI's own sections and names:
  - A command for one entity (`show och 1-7-5`, `show transceiver 1-7-4`) gives `{ config: {…}, state: { …, stats: {…} } }`. Its `key value` lines are strings as printed (`"193500000 MHz"`), and its `instant | avg | min | max` lines are numbers (`stats["q-margin"]` is `{ instant: 3.4, avg: 3.4, min: 3.3, max: 3.4, unit: "dB" }`). Its address is in the command, not in the output. These templates are a single `<extend template="_detail.ttp"/>`.
  - A list is keyed by CLI address or name (`state.ports["1-7-5"]`, `config["cross-connections"].CC5_4`, `alarms[<id>]`), or is a list in order where rows have no key (`state.assignments`, `events`).
- `GET /bridge/state` returns the latest result per command: `{ at, raw, data }` (`data` null with no template), or `{ at, raw, error }`. Disconnecting clears it. The app doesn't read it yet.
- Set up once with `npm run bridge:setup`, which makes `bridge/.venv` with TTP in it.
- **To add a command:**
  1. Copy its output from a run (`data/boxes/<box-id>/runs/<run>/raw/NNN_<slug>.txt`) to `data/boxes/<box-id>/ttp/fixtures/<name>.txt`, where `<name>` is the command's id.
  2. Write `data/boxes/<box-id>/ttp/templates/<name>.ttp`. For a command that shows one entity, `<extend template="_detail.ttp"/>` is the whole template. For a table, copy one row and replace each value with `{{ column-name }}`, as in `cli_shortcut_cmds_l1__port__show__port.ttp`. Give a value a regex when spaces alone can't tell the columns apart.
  3. Put the JSON you expect in `data/boxes/<box-id>/ttp/fixtures/<name>.json`.
  4. Add the command to `poll.json`; its template is found by its id.

  `npm test` checks every template against its fixture.

## Code

| File | What |
| --- | --- |
| `src/types.ts` | Catalog and topology (`.olst.json`) types |
| `src/catalog.ts` | Loads `catalog/` at build time; stream hardware (`chassis`, `linecards`, `pluggables`) is source-of-truth, with `common/` as legacy fallback |
| `src/rules.ts` | Lookups, allowed lists, fiber rules, validation, alarms |
| `src/store.ts` | The one Zustand store: topology, actions, autosave |
| `src/Canvas.tsx` | Logical canvas: device nodes, port handles, fibers, views |
| `src/PhysicalView.tsx` | Physical view: chassis slot grid (SVG) and its back (PSU and fan bays), then one linecard's faceplate, pluggable tray, hover card, detail and alarm panels, alarm bells |
| `src/App.tsx` | Top bar, palette, new-project dialog, fiber panel, problems, toast |
| `bridge/server.mjs` | CLI bridge: one persistent SSH session to the box the physical view connects to, whose shell the view's terminal attaches to over a WebSocket (`/connect`, `/term`, `/disconnect`, `/status`; Vite proxies them under `/bridge`, and it answers only the app: a header on requests, the page's Origin on the WebSocket). Also the poller, on a second shell, and its `/state` |
| `bridge/recorder.mjs` | Writes the poller's snapshots and polls as run folders under `data/boxes/<box-id>/runs/`; run on its own, parses a run's raw output again |
| `bridge/cli-index.mjs` | Which command of the CLI index a command line runs, for its template (and for the sync's counts) |
| `bridge/parse.py`, `data/boxes/<box-id>/ttp/templates/` | Turns a command's output into JSON with its TTP template; `data/boxes/<box-id>/ttp/fixtures/` holds sample outputs for the tests |
| `src/Terminal.tsx` | The CLI terminal: xterm.js on the bridge's `/term` WebSocket |

## Choices the plan left open

- **Which C and MX ports are client or line** is a guess, until the internal documents replace it: every variant has one line port, L1, and the rest are client ports C1…Cn (C25 is just L1). C clients take QSFP and C's L1 takes OSFP; MX clients take SFP and MX's L1 takes QSFP. Change them in `catalog/common/linecards.json`.
- **A link is one strand**, `a` Tx → `b` Rx; a duplex pair is two links. Files saved before this (when one link meant both strands) open as one strand each, `a` → `b`; add the return strand by hand.
- **Fibers between two cards of one device** are allowed (rule 4) and drawn as a loop under the device. Parallel fibers between two devices are drawn side by side, spread away from the devices. **Loopback** is allowed only on a line port, Tx to its own Rx (no client loopbacks, no port-to-port fibers on one card).
- **Data view** pairs client ports by position (C1↔C1, C2↔C2) on cards whose line ports share a fiber directly, in either direction; a loopback carries no service. No path tracing through amps or muxes; the views are cosmetic, as the plan says.
- **All catalogs ship in one bundle.** See the confidentiality risk in the plan.
- **Alarms are simulated from the build**, since there is no live device: LOS on pluggables with nothing into their Rx and missing PSUs or fans. There are no models of PSU or fan (one generic unit each), no way to fail a unit that is in, and no CLI command for alarms yet.

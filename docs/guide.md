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
| Physical view | Click a device: its chassis shows as a slot grid, drawn to scale as 19-inch rack gear (EIA-310: a 482.6 mm panel with rack ears, 1U = 44.45 mm high per row of slots, so the 8-slot chassis is 4×2 and 2U). Each linecard shows a mini cage per port, labelled with the port: light when a module is in, a dark recess when empty, slate for a fixed LC port; its Tx and Rx turn green when a fiber is on them. Hover or click those pluggables just like on the card level. Drag linecards into slots (a 2-slot card such as C also takes the slot to its right). Click a linecard to see its slot enlarged to fill the view: the same rows of ports as in the chassis, each cage showing the module's part, form factor and speed (or, when empty, the form factors it takes), with each Tx and Rx saying where its fiber goes; **← Back** in the header goes up a level (card → chassis → canvas). Every level has the same fixed layout: the parts to put in as small text tiles across the top, scrolling sideways when they don't fit (linecards at the chassis, each with its slot width and port count; at a card, pluggables with their form factor and speed, in two groups: **pluggable optics** and **DCO**, digital coherent optics; hover one for its photo and details), the faceplate under them (scaled up as far as its 19-inch proportions allow, then stretched to fill its whole area, never scrolled), and at the bottom the CLI terminal with the details (datasheet or alarms) beside it. Drag a part onto the faceplate, or click it to pick it: it stays highlighted, every slot or port it fits turns green, and clicking a green one puts it there (click the part again or press Esc to drop the pick). Drag a pluggable into a cage. Hover a pluggable (in the strip or a cage) for its part number and a small photo; click it for its photo, description and properties in the details. Click a linecard tile or the card's name plate for the card's datasheet. Green = fits, a refused drop says why, Esc goes back up. ✕ removes a card or pluggable, and asks first if that deletes fibers. Nothing in the view moves or resizes whatever you click |
| Rear view | **Front** / **Rear** at the top right turn it round (from a card too). The rear is a panel of the same height, with a bay per PSU and fan (2 PSUs and 3 fans on every chassis for now). ✕ pulls one out, **Insert** puts it back. A new chassis has all of them in |
| Alarms | A bell with a count shows wherever there are alarms, at every level: the device on the canvas, each linecard, each port and each PSU or fan. Each counts its own alarms and those below it; red if one is critical, orange if all are major. The inspector lists the alarms of the level shown; click a bell for just its own. Alarms follow the build: **LOS** (critical) on a pluggable or a C card port with no fiber into its Rx, and one (major) per empty PSU or fan bay. Fiber the port or insert the unit and it clears |
| CLI command | Under the CLI terminal sits the CLI command for what you hover, else what you last clicked, else the level shown: `show chassis 1`, or hover a linecard for `show card 1-3`; on a linecard, the card, or hover a port for `show port 1-3-C2`. A pluggable's datasheet in the inspector, opened from a port, shows its command, which is its port's (`show port 1-3-C2`). **Copy** copies it. **Run** types it into the terminal and presses Enter |
| Box | Type the box's IP next to **← Back** and click **Connect**; the device keeps it. The dot is green while the bridge has the box connected, orange while it connects and grey when it is down (the text next to it says why). Closing the view, or the page, closes the session. **Connect on an empty device draws it from the box:** the chassis is greyed out with "Fetching data from box" and how far the snapshot is, then each present card from `show card` and each transceiver from `show inventory`, matched by module type and part number. What the catalog has no part for (box 3's FS QSFP-LR4-100G) is left out and named in a toast; a part it has but doesn't allow there is drawn anyway, and the problems list says so. The fibers come from the box's `wiring.csv`, named by strand: each strand whose two ends are box ports (F03, F04, F05); one that ends off the box (the BERT) is left out, and one the fiber rules refuse is named in the toast |
| CLI terminal | A real terminal (xterm.js) on the box's SSH session, through the CLI bridge: click into it and type as over ssh. Keystrokes go to the box as typed, so its own **Tab** completion, double Tab for the options, **↑**/**↓** history, Ctrl-C, `?` help, paging and modes all work: `configure` → Configure, `^^^` (Shift+6 three times) → Engineering, `bash`, `kgdb`, `exit` back. While it has focus, Esc goes to the box, not the view. It fits its area and the box wraps to its width; a dropped session reopens below what was there. A `show` command run at the operational prompt is also saved in the latest run (see [Poller](#poller)) |
| Mark pulled | After pulling a fiber on the box, pick its strand (from the box's `wiring.csv`) in the header and click **Mark pulled**. The bridge records a snapshot of the box with the strand's `answer.json`, for scoring. Only while connected |
| Wire fiber | A fiber is one strand and runs one way, from a port's **Tx** to a port's **Rx**; big arrows flowing inside the pipe show which way. Each port chip on the canvas has a Tx and an Rx handle (green once fibered): drag from a Tx to an Rx, or the other way round (or click one, then the other). The physical view does the same with each port's Tx/Rx: click one, then the other end's opposite strand, which lights green if it fits. A port's Tx and Rx are independent: 1/C1 Tx can go to 4/C1 Rx while 4/C1 Tx goes somewhere else. A line port can **loop back**, its Tx to its own Rx. A chip appears once its port has a pluggable (a C card's ports have one from the start); hover it to see which. Refused fibers say why |
| Fiber detail | Hover a fiber for where it runs, click it for the side panel (and delete). Under each port of a card's faceplate the physical view says where its Tx goes (→), where its Rx comes from (←) or ↺ for a loopback; at the chassis, hover a port's Tx or Rx for it |
| Delete | Select a fiber or a device on the canvas and press Delete/Backspace |
| Views | **L0** every port and fiber · **L1** line fibers, labelled card-to-card · **Data** client side, dashed services between cards joined by a line fiber. Ports outside the view are dimmed |
| Save / open | **Save** downloads `<stream>.olst.json`; **Open** loads one and re-validates it (problems are listed top right). The browser also autosaves |

## Catalog

```
catalog/
  streams.json              # the five corporations (streams): csp, ctc, polaris, tencent, ws
  common/cli.json           # CLI command templates and modes, merged into every stream
  <stream>/                 # chassis.json, linecards.json, pluggables.json, cli.json
```

The stream files are generated from the IIVI profiles in `../IIVI_Platform/profile/cu/`, so don't edit them by hand: the next sync overwrites them. `npm run dev`, `build` and `test` run `npm run sync:auto` first, which does nothing when that folder is missing, so the committed files are used as they are.

| File | Generated from | Script |
| --- | --- | --- |
| `streams.json`, `<stream>/chassis.json` | `platform/<stream>/CHASSIS.json`, plus each card's profile for its width | `npm run sync:platform` |
| `<stream>/linecards.json`, `<stream>/pluggables.json` | `CHASSIS.json` and `l1/<stream>/l1_profile.xml` (its `supported-part-no` lists) | `npm run sync:linecards` |
| `<stream>/cli.json` | `cli/<stream>/cli_shortcut_cmds_eqpt.xml` and `cli_shortcut_cmds_l1.xml` | `npm run sync:cli` |

- A stream is any profile folder that has all three: `platform/<stream>/CHASSIS.json`, `cli/<stream>` and `l1/<stream>`.
- A stream's hardware files are its whole catalog: `common/` has no hardware. Only `cli.json` merges, a stream's overriding `common/`'s level by level.
- Every stream has one chassis today, `ch-8slot`: 8 linecard slots as 4×2, 2 PSUs and 3 fans. `slotDomains` keeps the profile's slot ids by kind (linecard 1–8, psu 21–22, fan 31–33, fp, cu, mux).
- The linecards are the chassis's `supportedVendorTypes` (`TMUXC1125`, `800MX`, …). `vendorTypeMap` gives each its linecard id: known names get readable ids (`lc-c1125`, `lc-800mx`), the rest `lc-<vendor type>` (`lc-tmuxc935`). `linecardMappingComplete` means every vendor type got a mapping, `knownLinecardMappings` and `fallbackLinecardMappings` count each kind, and `knownMappingComplete` is true only when none fell back.
- When the catalog loads (`hydrate` in `src/catalog.ts`), each slot's allowed list also gets every supported card that fits there, a card the profiles name without describing it gets a placeholder (one client port P1, one line port L1), and a port's pluggable family that no pluggable has gets a `<family>-placeholder`.
- A port's `role` comes from its profile module or its name: `line` (`LINEPORT`, `L1`), `client` (`CLIENTPORT`, `C1`), `adddrop` (`AD11`), `com`, `osc`, `monitor`, else `port`. Its `behavior` (`showsInL1`, `showsInData`, `canLoopback`, `serviceGroup`) drives the views and rules; without one, line ports show in L1 and loop back, and client ports show in Data.
- The pluggables are the `supported-part-no` parts, with the lowercase part number as their id (`ftlc1154rdpl`), and their form factor (SFP, QSFP, QSFPDD, CFP2), speed and `dco`.
- Files and autosaves with the old demo ids (`corp-a`, `ch-2000`, `lc-c1`, …) are upgraded when they load (`RENAMED` in `src/store.ts`).
- `chassis.columns` lays the slots out row by row (4 columns → 4×2 for 8 slots). `chassis.category` groups the palette (optional).
- `chassis.psus` and `chassis.fans` are how many PSU and fan bays its back has, named PSU1…PSUn and FAN1…FANn (default none, and then no **Rear** button). A device saves the bays left empty as `emptyBays`, e.g. `["PSU2"]`.
- `chassis.mgmtPorts` lists the management ports drawn in a narrow strip at the left: `front` (USB-C, CON, MON) and `back` (NMS, NMS1, NMS2), where the back shows them left of the PSUs (stacked) and fans. Names starting with `USB` are drawn as USB-C, the rest as RJ-45. They are only drawn: no fibers, alarms or CLI.
- `linecard.width` is how many side-by-side slots a card takes (default 1). It sits in the leftmost one; the slot's allowed list decides where it may start, and it must fit in that row.
- `linecard.columns` lays its ports out row by row, the same at the chassis and at the card level. By default a card's ports sit as in its 1U slot: one row of up to five per slot of width, else two rows, the top one the longer (800MX 5 over 5, 400MX one row of 5, C1125 10 over 10, OCM 5 over 4).
- A port's `allowedPluggables` lists pluggable ids (the profiles list parts) or whole families (`"QSFP"` takes every QSFP). An empty list (`[]`) is a fixed port: built-in SMF Tx/Rx, fibered as is, no pluggable.
- `cli.json` (not a list) holds the CLI command templates per level, `chassis`, `card`, `port` and `pluggable`, with `{chassis}`, `{slot}` and `{port}` filled in. A wide card's `{slot}` is its leftmost slot. A pluggable's command is its port's, `show port …`. A stream's `cli.json` overrides `common/`'s level by level.

- Chassis, linecards and pluggables all carry the same datasheet info, all optional: `vendor`, `part`, `image` (path under `public/`), `url` (a link, or a file under `public/` such as `datasheets/c1125.pdf`), `about` and `specs` (any label → value, shown in the inspector). A pluggable without `image` shows its form factor instead; `dco` groups it under DCO.
- Internal capture and generated CLI data now goes in `data/` (for example `data/cli/csp/` and `data/boxes/<box-id>/`).

`public/pluggables/` has photos from Coherent's product pages on coherent.com, named after the demo pluggable ids used before the catalog came from the profiles. No stream pluggable has an `image` yet, so nothing shows them (see the [roadmap](roadmap.md#iter-3-run-the-light)):

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
| `osfp-1600g-dr8` | FTCF2519E3PCA, 1.6T-DR8 OSFP, 500 m |
| `cfp2-dco-400g` | FTCD3312M1BCL, 400G CFP2-DCO, 500 km |

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
- `bridge/recorder.mjs` writes a new run folder, `<YYYYMMDD-HHMMSS>-connect`, when the session opens (and when it opens again after a drop), `<YYYYMMDD-HHMMSS>-alarms` whenever a poll of `show alarm` sees the active alarms change, and `<YYYYMMDD-HHMMSS>-pull` when a pull is marked. Each folder holds one snapshot: `raw/NNN_<slug>.txt` per command, `raw/index.jsonl`, `parsed/` and `meta.json` (host name, release, box clock and its offset, prerequisites, and `snapshot: { done, of }`, how many commands the snapshot ran). The polls until the next snapshot go into its `poll.jsonl`. If a prerequisite fails, nothing is polled, because paging could cut output short. The layout is in the [capture plan](plans/box3-capture.md#run-layout).
- **Typed commands** (`bridge/typed.mjs`): the terminal's output also goes to a headless xterm of the same size, so the bridge sees each line as the box left it, after Tab completion, backspaces and history. When Enter is sent and the box echoes it, a `show` command on that line is run again on the poller's shell and recorded in the latest run as `source: "typed"`. Only at the operational prompt (`admin@…>`, not configure mode's `#`), and never with `?` or a `|` pipe; nothing but `show` is ever re-run.
- **A marked pull**: `POST /bridge/pull` with a strand's name from `data/boxes/<box-id>/wiring.csv` (`GET /bridge/wiring` lists them) takes a snapshot into `<YYYYMMDD-HHMMSS>-pull`, with `answer.json` (`{ fault: "pull", strand, from, to, via, markedAt, detectable }`) and `meta.json` `state: "fault"`. `detectable` is false when the strand's Rx end is not a box port (F02, into the BERT), where "insufficient evidence" is the right answer. The agent never reads `answer.json`.
- `node bridge/recorder.mjs <run folder>` parses a run's raw output again into `parsed/`, e.g. after a template changed or for a hand capture.
- `bridge/parse.py` takes each output, without its echo and prompt, and turns it into JSON with the TTP template `data/boxes/<box-id>/ttp/templates/<id>.ttp`, where `<id>` is the command's id in `data/cli/csp/cli-index.source.json` (`show och 1-7-5` runs `cli_shortcut_cmds_l1__och__show__och`). `bridge/cli-index.mjs` finds the id, and a command with no template is recorded without a parse. Results keep the CLI's own sections and names:
  - A command for one entity (`show och 1-7-5`, `show transceiver 1-7-4`) gives `{ config: {…}, state: { …, stats: {…} } }`. Its `key value` lines are strings as printed (`"193500000 MHz"`), and its `instant | avg | min | max` lines are numbers (`stats["q-margin"]` is `{ instant: 3.4, avg: 3.4, min: 3.3, max: 3.4, unit: "dB" }`). Its address is in the command, not in the output. These templates are a single `<extend template="_detail.ttp"/>`; `show card` and `show logical-channel` add it for their detail form (`show card 1-7`).
  - A list is keyed by CLI address or name (`state.ports["1-7-5"]`, `config["cross-connections"].CC5_4`, `alarms[<id>]`), or is a list in order where rows have no key (`state.assignments`, `events`). L0 tables are keyed the same way: `state.ports["port-1-1-ad1"].in["optical-power"]` (`show optical-port`), `state.amplifiers["1-1-ba"]` with its measured gain and powers under `stats` (`show amplifier`, with `_stats.ttp`), `thresholds["PORT-1-1-AD1"].IN_OPTICAL_HIGH_WARNING` (`show profile-threshold`).
- `GET /bridge/state` returns the latest result per command. While connected it is `{ live: true, host, commands }`, with what the poller read this session: `{ at, raw, data }` (`data` null with no template), or `{ at, raw, error }`. While not, it is `{ live: false, host, run, at, commands }`, the last state on disk: the latest run's snapshot (by `meta.json` `ended`, skipping a run whose snapshot was cut short), each command updated by its last line in `poll.jsonl`, as `{ at, data }`, `{ at, error }`, or `{ at, raw }` with no template. Times are in ms. With no box ever connected, that is run 1.
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
| `src/catalog.ts` | Loads `catalog/` at build time: a stream's own hardware files, `common/cli.json` under the stream's, and `hydrate`'s fill-ins |
| `src/rules.ts` | Lookups, allowed lists, fiber rules, validation, alarms |
| `src/store.ts` | The one Zustand store: topology, actions, autosave, upgrades of old ids |
| `src/ports.ts` | A port's behavior (its own or its role's defaults) and its tone per view |
| `src/route.ts`, `src/Pipe.tsx` | Fiber routing on the canvas (straight runs around devices, movable runs, spread-out shared runs, hops at crossings) and the pipe drawn along it, with its flowing arrows |
| `src/live.ts` | `discover`: a device's slots from the box's `show card` and `show inventory`, for Connect on an empty device. The box's light on each strand, from `/bridge/state`: the dBm where it leaves and lands (an L1 port's from its OCH or transceiver, an L0 port's from `show optical-port`, with the box's flag), Tx − Rx when both are known, OSNR, Q-margin and pre-FEC BER, and dark when the Tx laser is off or the Rx end has a LOS or LOF alarm. The physical view fetches it every 10 s into the store's `live` (never saved) and says where it came from: **Live**, or **Last state · time** from the latest run. Pipes show it at the card level (dBm beside this card's ends: a Tx's left of its pin, an Rx's right, or left a line lower at the card's edge; the rest in the tooltip); the canvas doesn't yet |
| `scripts/sync-*.mjs` | The catalog syncs from the IIVI profiles (`sync-all.mjs` runs them) and the CLI index for CSP (`sync-cli-index-csp.mjs`) |
| `scripts/split-session-log.mjs` | Splits a hand-made `session.log` into a run's files |
| `src/Canvas.tsx` | Logical canvas: device nodes, port handles, fibers, views; the box's light on each fiber, its Tx → Rx dBm in the fiber's label (outside L1) |
| `src/PhysicalView.tsx` | Physical view: chassis slot grid (SVG) and its back (PSU and fan bays), then one linecard's faceplate, pluggable tray, hover card, detail and alarm panels, alarm bells |
| `src/App.tsx` | Top bar, palette, new-project dialog, fiber panel, problems, toast |
| `bridge/server.mjs` | CLI bridge: one persistent SSH session to the box the physical view connects to, whose shell the view's terminal attaches to over a WebSocket (`/connect`, `/term`, `/disconnect`, `/status`, which also says how far a snapshot is; Vite proxies them under `/bridge`, and it answers only the app: a header on requests, the page's Origin on the WebSocket). Also the poller, on a second shell, and its `/state`, `/wiring` and `/pull` |
| `bridge/typed.mjs` | Reads typed `show` commands back from a headless copy of the terminal's screen, for the recorder |
| `bridge/recorder.mjs` | Writes the poller's snapshots and polls as run folders under `data/boxes/<box-id>/runs/`; run on its own, parses a run's raw output again |
| `bridge/cli-index.mjs` | Which command of the CLI index a command line runs, for its template (and for the sync's counts) |
| `bridge/parse.py`, `data/boxes/<box-id>/ttp/templates/` | Turns a command's output into JSON with its TTP template; `data/boxes/<box-id>/ttp/fixtures/` holds sample outputs for the tests |
| `src/Terminal.tsx` | The CLI terminal: xterm.js on the bridge's `/term` WebSocket |

## Choices the plan left open

- **Port roles are inferred** from each port's profile module or name (see [Catalog](#catalog)); a port the sync can't place is a plain `port`. Fix a wrong role in `scripts/sync-linecards-from-iivi.mjs`, not in the generated JSON.
- **A link is one strand**, `a` Tx → `b` Rx; a duplex pair is two links. Files saved before this (when one link meant both strands) open as one strand each, `a` → `b`; add the return strand by hand.
- **Fibers between two cards of one device** are allowed (rule 4) and drawn as a loop under the device. Parallel fibers between two devices are drawn side by side, spread away from the devices. **Loopback** is allowed only on a line port, Tx to its own Rx (no client loopbacks, no port-to-port fibers on one card).
- **Data view** pairs client ports by position (C1↔C1, C2↔C2) on cards whose line ports share a fiber directly, in either direction; a loopback carries no service. No path tracing through amps or muxes; the views are cosmetic, as the plan says.
- **All catalogs ship in one bundle.** See the confidentiality question in the [decision log](decisions.md#open).
- **Alarms are simulated from the build**, since there is no live device: LOS on pluggables with nothing into their Rx and missing PSUs or fans. There are no models of PSU or fan (one generic unit each), no way to fail a unit that is in, and no CLI command for alarms yet.

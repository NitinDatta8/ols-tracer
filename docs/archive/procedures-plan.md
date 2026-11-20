# Procedures and Iter 3 UI plan (2026-11-12)

> **Archived 2026-11-20:** built but for locate chassis (phase 9, which waits on box check 1), the inside view as planned (phase 13: the card's optical diagram was drawn instead, without the anatomy kit) and the miner (phase 14, now the [procedure miner plan](../procedure-miner-plan.md)). The read procedures have run on the lab (2026-11-16); no change has yet. What is left is in the [roadmap](../roadmap.md#left). Kept as it was for its history. Current state: [guide](../guide.md) · decisions: [decisions](../decisions.md).

The box workflows found in the boxes' logs become **procedures**: ops MOPs that the bridge runs, shown in the UI and in `ols-mcp`, and tiered by risk. Iter 3's UI comes with them: the fixed Horsham lab with a lock that follows the hardware, the BERT's SmartAccess AnyWhere, and a card's insides drawn with the anatomy kit. Built in the phases below, each one proving a piece before anything riskier uses it. Why it is built this way is in the [decisions](../decisions.md); what is built, in the [guide](../guide.md).

## Status

**Built** means its tests pass on the dev machine. **Proven** means a person ran it once on a lab box from the work machine. A phase behind a [box check](#box-checks) waits for that check's answer.

| # | Phase | Gate | Built | Proven |
| --- | --- | --- | --- | --- |
| 0 | [Docs](#0-docs) | | 2026-11-12 | |
| 1 | [Fixes found on the way](#1-fixes-found-on-the-way) | check 6, for the shell reopen only | 2026-11-12, but the shell reopen | |
| 2 | [Procedure runner](#2-procedure-runner) | | 2026-11-12 | |
| 3 | [Procedures panel](#3-procedures-panel) | | 2026-11-12; redone 2026-11-16 | |
| 4 | [MCP](#4-mcp) | | 2026-11-13 | |
| 5 | [Software audit and health check](#5-software-audit-and-health-check) (read) | | 2026-11-13 | |
| 6 | [Lab file and lock](#6-lab-file-and-lock) | | 2026-11-13 | |
| 7 | [BERT screen](#7-bert-screen) | check 7 | 2026-11-16, not yet on the lab's BERT | |
| 8 | Removed 2026-11-13: [LEDs and stats](#8-leds-and-stats-removed) | | | |
| 9 | [Locate chassis](#9-locate-chassis) (reversible) | check 1 | not yet: no box has been sent its line | |
| 10 | [Reboot card or NE](#10-reboot-card-or-ne) (change) | checks 2–4, made a runtime check | 2026-11-16 | |
| 11 | [Software upgrade, Commit and Rollback](#11-software-upgrade-commit-and-rollback) (change) | check 5; check 9 for the load list only | 2026-11-16, the load typed in | |
| 12 | [Service turn-up and teardown](#12-service-turn-up-and-teardown) (change) | | 2026-11-16 | |
| 13 | [Inside view](#13-inside-view) | | | |
| 14 | [Procedure miner](#14-procedure-miner) | | | |
| 15 | [Close-out](#15-close-out) | | | |

Later, in the [roadmap](../roadmap.md#later): factory reset and Day-0 (they need the console), the simulated pull with labelled runs, the add/drop and power sweeps, PRBS, loopback, OTDR and delay measurement, an upgrade campaign across boxes, and a nightly sanity run.

## What the runs show

The 8 boxes' `history.jsonl` hold 599 config lines (279 CLI or console, 320 NETCONF) and 2,252 alarm events, all as `admin` from 18 source IPs. Counted on 2026-11-12, partly by hand; the [miner](#14-procedure-miner) recounts them from the runs.

| Done by hand | Seen | Example |
| --- | --- | --- |
| Software upgrade or downgrade: download, wait, activate, `CU_SWITCH` and `NO_CMT_SW`, then commit or rollback | 7 downloads, 5 activates, 1 commit, 1 rollback, often in batches | test02, 2026-10-20 21:21, committed 10-21 03:26 |
| Day-0 commissioning over the console: ztp off, hostname, saving-mode manual, IP, OSPF, route, LLDP name, save, saving-mode auto, save, `reboot ne cold` | boxes 04–08 | 06, 2026-11-09 15:14–15:16 |
| Service turn-up: port-mode, in-service, OCH frequency and power, logical channel, client, cross-connection | 9 CLI, 3 NETCONF; 4–7 min by hand | 04, 2026-10-27 15:54–16:01 |
| Teardown and re-route: delete the cross-connection, ports out of service, laser off, a new client port and cross-connection | 4, all on 04 | 04, 2026-11-05 10:47–10:59 |
| Reboot and wait; a card reboot that ends in an NE reboot | 20 NE and 18 card reboots | 04, 2026-10-28 13:47 → 13:54 |
| Factory reset: ztp off, `clear database keep-networking`, hostname, LLDP, reboot | 4 | test02, 2026-10-19 11:50–12:01 |
| Add/drop sweep: a media channel made and deleted on ad2…ad11 | 13 made and deleted | 03, 2026-11-02 12:10–12:20 |
| Output-power trim (`target-output-power` -3, 0, -1, -2) | 22 changes | 04, 2026-11-05 11:01–11:05 |
| Port-mode against the transceiver: the NETCONF controller sets ZR800, gets `TRANSCEIVER_MISMATCH` and reverts | 20 mismatches on test01 and test02, in lockstep | |
| Card re-provision (module-type) | 7 | 03, 2026-10-28 |

**How long the box takes** (from its logs; the procedures' default timeouts):

| Action | Done when | Measured |
| --- | --- | --- |
| `reboot ne cold` or `warm` | `SYS_STARTUP`, then the alarms settle | median 157 s cold, 195 s warm, 296 s at most |
| `reboot card` | `COMMUNICATION_FAILURE` clears (no `CARD_PLUGIN` is logged) | 65–118 s |
| `clear database keep-networking` | `SYS_STARTUP` | 150–175 s |
| `download sw-image` | candidate-status `download-completed` | 2.5–110 min, median 11 |
| `activate` | `CU_SWITCH`, then `NO_CMT_SW` | 9.7–19.7 min, median 14.7 |
| `rollback` / `commit` | `CU_SWITCH` / `NO_CMT_SW` clears | 140 s / 1 s |

**On 2026-11-12:** boxes 03, 04, 05, test01 and test02 run images that are not committed (active-status `active`); 06–08 run 2.9.0.235, committed. The CLI also offers loopback, PRBS, clear statistics, backup and restore, AAA, SNMP, syslog, OTDR and delay measurement, never used in the lab so far.

**What every procedure has to handle:**
- **The CLI index lists most rpcs without their arguments** (`rpc reboot`, `rpc download`, `rpc activate`, `rpc locate-chassis`). `commandFor` matches an rpc typed without its `rpc`, but `reboot ne cold` has words past `rpc reboot`, so it matches nothing. The step lines in `procedures.json` are the source of truth for rpc lines, taken from the box logs.
- **set, delete and rpc need `configure`.** There is no config commit.
- **`config-saving-mode` can be manual:** without `save configuration`, a cold reboot loses the changes. A procedure that changes config ends with a save.
- **`cli confirmation-required` is on by default,** and applies to the CLI session it is set in.
- **The CLI has no LED state.**

## Box checks

By hand, on the work machine; the answer goes in the last column. Each gates the phase named; the phases without one are built meanwhile.

| # | Check | Gates | Answer |
| --- | --- | --- | --- |
| 1 | `locate-chassis ?`, then its start and stop lines, watching the box; the config log then holds the real lines | 9 | |
| 2 | Two CLI sessions in `configure` at once: is the second let in? | 10 | |
| 3 | In `configure`: `set cli confirmation-required no`, then `show cli confirmation-required` in that session and in a second one | 10 || Asked by every change since 2026-11-16: its shell's `show cli confirmation-required` has to print `no`, or it stops before its first line |
| 4 | At the next planned card reboot: what `reboot card <slot> cold` prints with confirmation on | 10 | |
| 5 | `download sw-image ?`: does it ask for an SFTP user or password? And `show software` while a download runs | 11 | |
| 6 | `show aaa user admin` (max-idle-time): is that why box 5 opened a new connect run every 10 min on 2026-11-11? | 1, the shell reopen only | |
| 7 | Does the BERT answer VNC on its IP without SmartAccess? `Test-NetConnection <BERT IP> -Port 5900` in PowerShell, SmartAccess closed | 7 | 2026-11-16, from a lab PC: ports 22 and 5900 open. So the BERT's screen goes in its physical view; the old questions (the exe's command line, a second SmartAccess) fell away with SmartAccess |
| 9 | `LOAD_*` filled in `bridge/.env`: can the bridge's own SFTP login list the load directory? | 11 | |

## Procedures

**A definition** lives in `catalog/common/procedures.json`, kept by hand; a stream's `catalog/<stream>/procedures.json` overrides entries by `id`. Each is `{ id, label, level, tier, params, pre, steps, verify, restore }`:
- `level` is chassis, card or port; `tier` is read, reversible or change.
- `params` are filled from the topology, a show or the load list. A param is one word: one of its enum's values, or an address that matches its pattern. Anything else is refused before a line is typed. Its `label` names it in the panel, and `example`, a value of it, is shown in its empty field.
- A step is `{ send, drops?, timeout? }` or `{ wait: <check>, args, every, timeout }`. The placeholders are `fillStep`'s, each a param. A read procedure sends only `show` lines, only a change may drop the session, and no line may change the shell's mode (`configure`, `exit`, `^^^`, `bash`): the runner does that itself.
- `pre`, `verify` and each `wait` name a check: a small JS function that lists the shows it reads and judges what they printed, not a mini-language, with the box's folder for one that compares with its runs. A wait's check marked `before` also gets what its shows printed before the first step, to tell the box back as it was (`cards-up`). One procedure per box at a time is checked for every procedure.
- A verify that judged the box may return findings, what it found wrong: the procedure still ends `done`, each finding a `finding` step in its log. `failed` is for one that couldn't run or judge.
- `restore` undoes a reversible procedure.
- Default timeouts come from the [table above](#what-the-runs-show).

**The runner** (`bridge/procedures.mjs`; only the bridge talks to boxes):
- Runs on a shell of its own on the box's session, so polls, typed shows and `/show` go on. That shell's prerequisites are `configure`, `set cli length 0`, `set cli width 1024`, `set cli confirmation-required no` (but in a read procedure) and `exit`; then, but in a read procedure, `show cli confirmation-required` has to print `no`, else it stops before its first line, as a line that asked to confirm would never get its prompt. That is box check 3, asked by every change.
- Enters `configure` only for set, delete and rpc steps, and always leaves it.
- Holds the session (`procedure:<id>`) until it ends, so it outlives the view that started it.
- Never sends a line twice.
- A `drops` step is followed by a `wait` for the box, which can't pass until the session has dropped: a box that has not gone down yet is not back. A drop is expected while that step's own line is typed, and in the waits and the verify after it, until the box is back: the runner then waits for the reconnect and that connect run's snapshot, whole, so its shell is never in `configure` while the poller sets up, opens its shell again and goes on, a wait or the verify running again. A drop anywhere else, a line being typed among them, stops it, saying to check the box.
- Cancel stops at the next step boundary, or at once in a `wait`. The reversible tier restores; the change tier says what is left on the box.
- A pending change expires after 15 min. A bridge restart abandons a procedure: its `procedure.json` says how far it got, and nothing resumes on its own.

**Recording:**
- A fast snapshot into `<stamp>-procedure` before it starts; another after it ends, for the reversible and change tiers.
- Its steps go into the session's current run, as typed and MCP shows do, as `source: "procedure"` with `by`. A run read without its polls (`latest()` with `polls: false`) leaves them out. After a reconnect the current run is the new connect run, so the old run's `ended` never moves past it.
- `procedure.json` in the procedure run: the definition, the params, who asked and who approved, each step with its times, the outcome, and the runs it touched.
- `history.mjs` labels the box's config events that match a procedure's steps `by: procedure:<id>`, so its episodes tell our own actions apart: labelled data for the eval.

**Approve** (the change tier):
- Only from the app page: the request's Origin must be the bridge's Host, as for `/term`. A browser always sends it and a page can't fake it, so the MCP server can't approve its own request. A local process that forges headers can, so this is a guard, not security.
- The panel shows the exact lines and who asked, and the person types the box's hostname.
- Commit and Rollback are each their own Approve, offered only after a soak.

**The MCP:**
- `list_procedures` and `procedure_status`, read-only (`readOnlyHint`).
- `run_procedure`: a read procedure runs and answers. A change answers with its exact lines and "waiting for Approve in the tracer UI". A reversible one is refused on `/mcp`, and runs only on a second endpoint, `/mcp/lab`, registered in Codex as its own server with `default_tools_approval_mode = "writes"`, so every call asks Allow or Cancel. On `/mcp`, "Allow for this session" would cover every later call on any box.
- `check()` takes an rpc line only when it matches a step line in `procedures.json`, a placeholder as one word and an enum param as one of its values. Taking any words after a known rpc would let made-up commands through.

## Phases

Each phase: build, tests, `npm run build`, for a UI phase a headless browser check, a commit, and its row in [Status](#status). The browser checks run the bridge with the tests' fake ssh2 (`test/fakes/ssh2.mjs`), on made-up `*.test` hosts: no socket is opened, so nothing reaches a box.

### 0. Docs

This plan, the [BERT plan](bert-smartaccess-plan.md) brought in line, the [decisions](../decisions.md) of 2026-11-12 and the [roadmap](../roadmap.md#left) entries.

### 1. Fixes found on the way

- `bridge/history.mjs`: a reboot is matched in any case (box 07 typed `Reboot ne cold`). `activate`, `rollback` and `clear database` are a `restart`: an outage up to 1800 s after one is put down to it (an activate's switch comes 581–1182 s after it), where a reboot keeps 600 s. A restart, like a reboot, raises a missing card's alarm again, which is not a card taken out.
- The 2026-11-10 runs that were never parsed (four of box 3's, two of box 5's, two of test01's: the box folders had just been renamed, so the recorder found no templates) parsed again, and box 3's and test01's `history.jsonl` rebuilt from them. Box 3's and test01's last state was those runs' raw output, and test01's history lacked a NETCONF transaction on 2026-11-10 13:19.
- The bridge won't start without the templates in its data root, as it won't without its Python, so no run is recorded unparsed again.
- The guide: the physical view fetches the box's state every 2 s while connected, else every 10 s. The README's typo.
- Only if check 6 finds an idle timeout: when the terminal's shell closes, open that shell again instead of the whole SSH session.

### 2. Procedure runner

- `catalog/common/procedures.json`, with its stream overrides. Real definitions come with their phases; the tests use fixtures.
- `bridge/fill.mjs`: `fillStep` moves here from `src/terminals.ts`, and both import it, as `src/l0.ts` imports `bridge/tables.mjs`.
- `bridge/procedures.mjs`: load and merge, the params check, the named checks and the runner, as in [Procedures](#procedures).
- `bridge/server.mjs`: the session's procedure state; the poll loop takes procedure snapshots (trigger `procedure`) and keeps its current run on the session; `GET /procedure?host=` (the box's stream's definitions and the current state), `POST /procedure?host=&id=&by=` (JSON params), `POST /procedure/approve?host=&ref=&by=` (the typed hostname; `ref` names the request shown, so nothing else is approved) and `POST /procedure/cancel?host=&ref=&by=`, all per host. A box whose prerequisite failed is not polled, so a show, a baseline or a procedure asked of it is refused, never left waiting.
- `bridge/recorder.mjs`: `latest()` with `polls: false` leaves out `source: "procedure"` lines.
- `vite.config.ts`: the new endpoints proxied. The proxy's `\b` also sends a file named like an endpoint (`/bridge/state.mjs`) to the bridge, so it becomes `(?=[/?]|$)`. Its target comes from `BRIDGE_URL`, so a check can run against a bridge on a spare port.
- `src/catalog-vite.ts`: the glob leaves out `procedures.json` and `lab.olst.json`, so a save never reloads the page.
- `bridge/shells.mjs`: a line's own timeout, and no Ctrl-C into a shell that closed.
- Tests, on `test/fakes/lab.mjs` (`sessions-procedures`, `-changes`, `-drops`, and since 2026-11-16 `-restarts`, with the tests' procedures in `test/fakes/procedures.mjs`; units in `procedures.test.mjs`): a read procedure end to end (the run, `procedure.json`, the index lines, the `latest()` skip); one procedure per box; a rejected step fails and leaves `configure`; cancel; pending → Approve (the Origin rule) → runs, and a pending one expires; a view leaving mid-run doesn't close the session; a drop on a `drops` step goes on after the reconnect's snapshot, and on any other step stops.

### 3. Procedures panel

- `src/procedures.ts`: `procedureItems()`, as `termItems` is for terminals, greyed out with why: not connected, one already running or pending, test equipment, another level. A param named `card` starts as the card it is at. Whether a param's value is taken is `fits` in `bridge/fill.mjs`, the bridge's own rule.
- `src/Menu.tsx`: an item carries its action, a terminal or a procedure, so a right-click on a card offers that card's procedures.
- `src/ProcedurePanel.tsx`: a **Procedures** button in the physical view's header, with a dot while one runs, opens a fixed-size panel over the stage in three regions: the list; the params, the exact lines and Run, Request, Approve (type the hostname) and Cancel; the step log, with a progress line for long waits. It asks `GET /procedure` every second while open or while one waits or runs, else every 5 s while connected, so a change asked for from Codex shows within 5 s. The buttons sit in one row that never moves, each enabled only when it applies; the list says only why one is not for here, and why none can run now is said once.
- Redone 2026-11-16, after a run on the lab found it hard to read (Run, the hostname, Approve and Cancel all in one row, mostly greyed; the lines and the log in two columns): the list by tier, one line each; the one picked or asked for in one column, its params (the ones it ran with, read-only, once asked), its steps marked from its log as it goes (`timeline` in `src/procedures.ts`: a drop as a line is typed passes that line, a drop in a wait is noted on it) with a wait's tries and time left, what it found listed apart, and a pill (Waiting for Approve, Running with its time, Done with its findings, Failed). The row under it says what applies and holds only the buttons that do: Run or Request approval; the hostname, Approve and Cancel request; Cancel; Run again…. Browser check passed against a fake box that acts out the catalog's procedures: a health check with findings, a commit its pre refuses, an upgrade, a rollback, an NE reboot, a request cancelled and a card reboot from the card's menu; the panel's parts keep their boxes in all 13 states.
- Browser check (passed 2026-11-12, against the fake bridge): the panel's parts and the header keep their boxes in nine states; a read procedure runs; a change waits, a wrong hostname is refused, the right one in any case approves it; Cancel stops a wait and the reversible one restores; a right-click on a card offers its procedure and opens the panel at it, `card` filled in; Esc closes it.

### 4. MCP

- On `/mcp`: `list_procedures`, `procedure_status`, and `run_procedure` by tier, as in [Procedures](#procedures); a read procedure is waited for up to about 2 min (`PROCEDURE_WAIT_SEC`, 120 s), then answered with its status. Codex gives a tool call 60 s unless the server's `tool_timeout_sec` says more, so the README's Codex block sets it to 150.
- `check()` takes rpc lines from `procedures.json` only: `rpcOf` (`bridge/cli-index.mjs`) finds the index rpc a line starts with, and `fillsStep` (`bridge/fill.mjs`) whether a step's line is that line, each placeholder one word its param takes.
- An OLS Tracer test (`test/bridge/procedure-lines.test.mjs`) checks every procedure line, its checks' shows too: a show line is a show of the CLI index, a set or delete line one with no word left out (a set of several settings, as the box logs type a cross-connection, each setting one), an rpc line's head is an index rpc, and each rpc line's shape, each value of an enum param in it too, was sent to some box (`history.jsonl`). It is shown to catch made-up lines on procedures of its own before it runs on the catalog's.
- Updated: the server's instructions (their first 247 characters stay), the README's tools and its "never the box", the [MCP decision](../decisions.md#mcp), the pinned tool names in its tests, the fake bridge, and the pin.

### 5. Software audit and health check

- `software-audit`: its check, `software`, reads `show software` and `show card`. It flags an active-status other than `committed`, a candidate left behind, and a card running other than the active release: one whose `software-version` in `show card` names a release of the box's stream (`800mx_CSP-2.10.100.10_20261013`) other than the active one. A TMUX card's own OS (`TWSOA25_OS_GE_2.6.1…`) names no release, so it isn't judged. `show software upgradeable-device` would say what each card should run, but no run has ever had it (it isn't in `bridge/poll.json`), so its form is unknown: the audit types it first and records it in its procedure run, and judges it only once a run on a box has shown its form and it has a template.
- `health-check`: its check, `health`, reads `show card`, `show alarm` and `show system`: each card provisioned is in and active; no alarm that the latest healthy baseline (the box's latest run with `state: healthy`) didn't have, threshold flaps left out (`FLAPS`, now in `bridge/history.mjs`); no `NO_CMT_SW` or `DATETIME_UNCHANGED`, baseline or not; `config-saving-mode manual` as a warning. A box with no healthy baseline says so. The MCP's `procedure_status` and `run_procedure` add its first losses, traced on its procedure run's snapshot.
- What either finds is the procedure's result, not a failure: it ends `done` with its findings (see [Procedures](#procedures)).
- Test: fed each box's latest recorded outputs, parsed again with their templates, the audit flags exactly 03, 04, 05, test01 and test02, and passes 06–08; a card on another release is flagged and a TMUX card's OS is not; the health check names box 3's problems since its baseline of 2026-11-08, and says box 6 has none. It is skipped without the bridge's Python, as the template tests are. A tests' procedure with findings ends `done`.
- Proven: one run on box 3, from the work machine, once this is pushed and pulled there:
  1. `npm run bridge` and `npm run dev`; open box 3's physical view and **Connect**; wait for the dot to go green and the connect snapshot to finish.
  2. **Procedures** → **Software audit** → **Run**. It ends `done` within a minute, its log `send show software upgradeable-device`, `verify software`, and while box 3 is as on 2026-11-10, two findings in red: `active-status active: CSP-2.10.100.10_20261013 is not committed` and `candidate Release_CSP-2.9.0.235_20260209.tar left behind (candidate-status inactive)`.
  3. **Health check** → **Run**. It ends `done`, its findings the cards not in or not active (on 2026-11-10: 1-4 and 1-8 absent, 1-21 inactive), `NO_CMT_SW`, `DATETIME_UNCHANGED`, and each alarm not in baseline `20261108-151528-baseline`.
  4. `data/boxes/paho-gs2000-03/runs/` has a `<YYYYMMDD-HHMMSS>-procedure` run for each, with `procedure.json` (`state: done`, the findings in its log) and the audit's `show software upgradeable-device` output in `raw/`: the first capture of it. Commit them.
  5. From Codex, after `npm run setup` in ols-mcp and with `tool_timeout_sec = 150` in its block: `run_procedure` paho-gs2000-03 `health-check` answers `done`, with the findings in its log and `firstLosses`; `procedure_status` paho-gs2000-03 answers the same.

### 6. Lab file and lock

- `examples/csp.olst.json` moves to `catalog/csp/lab.olst.json` (`git mv`) and gets `lock: { sha256 }`. The plain password has left `notes.md`: item 6 is in [notes done](notes-done.md) without it.
- Bridge (`bridge/lab.mjs`): `GET /lab` answers `{ topology, mtime }`; `PUT /lab?mtime=` answers 409 when the file changed since (after a pull), else writes it in one step, a whole file renamed over it.
- App (`src/lab.ts`): loads the lab on start and saves it with `PUT` half a second after a change, one request at a time. A 409 says to reload and leaves the page read-only. The browser keeps only the view and a copy of the lab, shown read-only while the bridge is down, and asks the bridge again every 5 s. New, Open, Save, the new-project dialog and the corporation dropdown go (switching would overwrite the lab); the stream shows as a label.
- Lock: a 🔒 button in the top bar; unlocking asks for the password, checked by SHA-256 in the browser, and a reload locks again. While locked: no adding, deleting or moving devices or racks (palette, drag, Delete key, rack moves), and no host edits (names have no edit). Cards, pluggables, fibers and bays stay free. The store refuses the rest with a toast that says why, so no control can get round it. The lock is a client-side check, not security. The browser's SHA-256 (`crypto.subtle`) needs localhost or HTTPS: hosting will need HTTPS anyway.
- **It follows the hardware:** a card or pluggable the box reports in or out changes the lab file, locked or not, since the lock leaves cards and pluggables free. Connect already syncs a box's cards, pluggables and strands into the topology (`discover` in `src/live.ts`). The view sends `POST /lab/sync?host=` the device's slots and every fiber on it, as its own sync leaves them, and the bridge gives that device in the lab file as it is those slots and fibers, in one write, so two views syncing one box, or someone editing, never overwrite each other. It writes only when something changed, and answers what did (`bridge/changes.mjs`, which the view uses too, sending nothing when the lab has it already); the toast says it. A box the bridge can't name yet (a new host before its `show system`) has no strands, `null`, never the default box's, so its first sync can't drop the fibers the lab has. It runs while someone has that box's physical view connected; a box nobody has open is brought up to date the next time someone does. Doing it with nobody watching needs `discover` and the catalog in the bridge, which are TypeScript in `src/` today: later, if it is wanted.
- Docs: the [product decision](../decisions.md#product), the README's Run steps, the guide.
- Browser check (passed 2026-11-13, against the fake bridge, the lab copied with made-up hosts): locked, nothing can be dragged, deleted or added, nor a box IP changed, and a card still goes in; unlocked, everything can, and each change is saved; no save reloads the page; a file changed on disk gets a 409, a toast to reload and **Read-only**; a reload locks again; a card the fake box reports in lands in the lab file while it is locked, with one toast; with the bridge down the page shows its last copy read-only, and loads the lab again once the bridge is back; the top bar keeps its boxes in every state.

### 7. BERT screen

As in the [BERT plan](bert-smartaccess-plan.md), rewritten 2026-11-16 once check 7 found the BERT answers VNC on its IP:
- The BERT's physical view opens at its **Screen**: its VNC server, the one SmartAccess's Remote Screen shows, in noVNC (`src/Screen.tsx`), shared, with a VNC password asked for over it and **Reconnect**. **Ports** has its two ports, and its stage takes the terminal's room.
- The bridge relays the page's WebSocket (`/vnc?host=`) to port 5900 on the BERT (`BERT_VNC_PORT`), only for a tester's IP in the lab file. It runs on the Linux host, so nothing runs on anyone's PC.
- The BERT's one fixed IP is its device's `host` in the lab file, next to **← Back**, editable only while the lab is unlocked.
- Testers stop polling `/status` and `/state`.
- Tests: the relay in `test/bridge/screens.test.mjs`; a browser check (passed 2026-11-16) against a fake VNC server. Left: proven on the lab's BERT.

### 8. LEDs and stats (removed)

Removed 2026-11-13: an LED's behaviour is the product's own, in its profile in the codebase, to be captured from there, never defined here. Card stats go with it. Both are in the [roadmap](../roadmap.md#later). The numbers of the phases after it stay as they were.

### 9. Locate chassis

- Not built: the CLI index has `rpc locate-chassis` ("start or stop system locate-chassis") without its words, and no box log has it, so its lines would be made up. Box check 1 gives them.
- Start, hold for `duration` (60 s by default) or until Stop, then stop: on the end, on cancel and on a failure.
- The MCP's `/mcp/lab` with only `run_reversible`, and a README block for its Codex server.
- Proven: the box blinks, once from the UI and once from Codex.

### 10. Reboot card or NE

Built 2026-11-16 (`catalog/common/procedures.json`), with the lines from the box logs:
- `reboot-card` (at a card): `reboot card {card} {mode}`, cold or warm; waits `card-down`, every 2 s for up to 60 s (it raised `COMMUNICATION_FAILURE`, or it is no longer in and active), then `card-up`, every 10 s for up to 5 min (in, active, the alarm cleared). By the logs an 800MX raises `COMMUNICATION_FAILURE` about 12 s in and clears it at 90–100 s; box 3's TMUX card 1-1 logged none on 2026-11-02, so a card that shows neither fails `card-down`, saying so: its first run on a TMUX card tells how it shows a reboot.
- `reboot-ne` (at the chassis): `reboot ne {mode}`, which drops the session, up to 10 min to come back; reads `cards-up` before it, then waits for every card in and active before it to be so again, every 15 s for up to 10 min; then the health check, as its verify. By the logs the box clears its alarms 24–30 s in and raises `NO_CMT_SW` again about 145 s in.
- Checks 2–4 by the runner: a second CLI session refused `configure` fails it before any line; `show cli confirmation-required` has to print `no` in its shell (see [Procedures](#procedures)), so a reboot never waits on a prompt.
- Tests: the checks on the boxes' recorded `show card` and `show alarm`, changed as a reboot changes them (`procedure-checks.test.mjs`); the runner, a step that drops the session but the box never does, a wait that reads before it begins, and the confirmation prompts left on (`sessions-restarts`, `sessions-changes`); every line against the CLI index and the box logs (`procedure-lines.test.mjs`).
- Proven: one approved from the UI, one queued from Codex and approved. Box check 3's answer is then in the procedure run's `show cli confirmation-required`.

### 11. Software upgrade, Commit and Rollback

Built 2026-11-16, the load typed in:
- `software-upgrade`: the SFTP folder and the load's file name typed in (`sftp://…`, `Release_CSP-….tar`), as the box logs give them; its pre, `upgradable`: the release running committed (box 04 rolled back before its download on 2026-10-29) and not the load already. `download sw-image path {path} file-name {file}`; waits `downloaded` (that file the candidate, `download-completed`) every 30 s for up to 2 h; `activate candidate-sw-image`, which drops the session (the box restarts: `DATETIME_UNCHANGED` and `NO_CMT_SW` raised again 10–20 min in), up to 30 min; waits `activated` (that release active, not committed) every 30 s for up to 30 min. Should the download ask for an SFTP password (check 5), its line gets no prompt within 2 min and it fails with nothing left on the box.
- `software-commit`: pre `uncommitted`; `commit active-sw-image`; waits `committed` every 5 s for up to 2 min. `software-rollback`: pre `uncommitted`; `rollback`, which drops the session (a CU switch: not seen in the logs, as nobody was connected then; a rollback that doesn't drop fails after 15 min saying so); waits `committed`. Each its own Approve. The soak before them is the person's call: no `SETTLE_SEC` yet.
- Not built: `GET /loads` (the bridge listing the loads over SFTP, check 9), marking the baseline stale and offering **Capture baseline**.
- Tests: the checks on each box's recorded `show software`; the browser check's fake box downloads, activates (dropping the session), commits and rolls back.
- Proven: one upgrade on test01 or test02.

### 12. Service turn-up and teardown

Built 2026-11-16, at a card, the params typed in:
- `service-turn-up`: the lines and their order from box 04's turn-up on 2026-10-27, one setting a line where the box logs typed them apart, and `laser enabled` on both ports, as 2026-11-05 typed it after a teardown: the line port's port-mode (ZR800 or ZR400), in-service, laser; its OCH frequency and target power; its logical channel `eth-100g`; the client port `PROT_100GE`, in-service, laser; the cross-connection from the line's 100GE lane to the client, as one line as the box logs type it; `save configuration`.
- `service-teardown`: the client port out of service, its laser off, the cross-connection deleted, `save configuration`. It leaves the line port alone: other services may ride it (box 04 did take its line port down by hand on 2026-11-05).
- Not built: params from the topology, and the pre that the port-mode fits the transceiver (it needs the transceiver's modes from the catalog); a turn-up on a line port already carrying services sets its port-mode again, so Approve shows the lines.
- Proven on box 04.

### 13. Inside view

- The anatomy kit ([github.com/wheresryan22/anatomy](https://github.com/wheresryan22/anatomy), MIT, no npm package): its `iso-kit.mjs`, `react/draw.tsx` and `react/live.tsx` (about 46 KB) and its LICENSE, copied into `src/iso/`, as its README says to for React.
- `src/Inside.tsx` draws each `inside()` stage as a small solid on a tube lit by its dBm and heat: port, amplifier, VOA, WSS, OCM tap. Generic, not drawn per card.
- Check: screenshots on box 3's recorded state, and nothing shifts.

### 14. Procedure miner

- `bridge/mine.mjs` and `scripts/mine-procedures.mjs`: the config lines grouped by session and time gap, ids replaced by placeholders, and the repeated sequences ranked.
- The MCP's `suggest_procedures`, read-only, over `/history`. A suggestion goes into `procedures.json` only after it has run once with a person watching.
- Test: today's data gives the [table above](#what-the-runs-show).

### 15. Close-out

The guide, README, roadmap and decisions brought up to date; this plan and the BERT plan to [archive](./); notes items 6 and 8 to [notes done](notes-done.md).

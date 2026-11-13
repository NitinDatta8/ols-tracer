# Procedures and Iter 3 UI plan (2026-11-12)

The box workflows found in the boxes' logs become **procedures**: ops MOPs that the bridge runs, shown in the UI and in `ols-mcp`, and tiered by risk. Iter 3's UI comes with them: the fixed Horsham lab with a lock that follows the hardware, the BERT's SmartAccess AnyWhere, and a card's insides drawn with the anatomy kit. Built in the phases below, each one proving a piece before anything riskier uses it. Why it is built this way is in the [decisions](decisions.md); what is built, in the [guide](guide.md).

## Status

**Built** means its tests pass on the dev machine. **Proven** means a person ran it once on a lab box from the work machine. A phase behind a [box check](#box-checks) waits for that check's answer.

| # | Phase | Gate | Built | Proven |
| --- | --- | --- | --- | --- |
| 0 | [Docs](#0-docs) | | 2026-11-12 | |
| 1 | [Fixes found on the way](#1-fixes-found-on-the-way) | check 6, for the shell reopen only | 2026-11-12, but the shell reopen | |
| 2 | [Procedure runner](#2-procedure-runner) | | 2026-11-12 | |
| 3 | [Procedures panel](#3-procedures-panel) | | 2026-11-12 | |
| 4 | [MCP](#4-mcp) | | 2026-11-13 | |
| 5 | [Software audit and health check](#5-software-audit-and-health-check) (read) | | 2026-11-13 | |
| 6 | [Lab file and lock](#6-lab-file-and-lock) | | 2026-11-13 | |
| 7 | [BERT SmartAccess](#7-bert-smartaccess) | check 7 | | |
| 8 | Removed 2026-11-13: [LEDs and stats](#8-leds-and-stats-removed) | | | |
| 9 | [Locate chassis](#9-locate-chassis) (reversible) | check 1 | | |
| 10 | [Reboot card or NE](#10-reboot-card-or-ne) (change) | checks 2–4 | | |
| 11 | [Software upgrade, Commit and Rollback](#11-software-upgrade-commit-and-rollback) (change) | checks 5, 9 | | |
| 12 | [Service turn-up and teardown](#12-service-turn-up-and-teardown) (change) | | | |
| 13 | [Inside view](#13-inside-view) | | | |
| 14 | [Procedure miner](#14-procedure-miner) | | | |
| 15 | [Close-out](#15-close-out) | | | |

Later, in the [roadmap](roadmap.md#later): factory reset and Day-0 (they need the console), the simulated pull with labelled runs, the add/drop and power sweeps, PRBS, loopback, OTDR and delay measurement, an upgrade campaign across boxes, and a nightly sanity run.

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
| 3 | In `configure`: `set cli confirmation-required no`, then `show cli confirmation-required` in that session and in a second one | 10 | |
| 4 | At the next planned card reboot: what `reboot card <slot> cold` prints with confirmation on | 10 | |
| 5 | `download sw-image ?`: does it ask for an SFTP user or password? And `show software` while a download runs | 11 | |
| 6 | `show aaa user admin` (max-idle-time): is that why box 5 opened a new connect run every 10 min on 2026-11-11? | 1, the shell reopen only | |
| 7 | On a Windows PC with SmartAccess AnyWhere: does `SmartAccessAnyWhere.exe` take the BERT's IP on its command line (`--help`, then the IP as its one argument)? And does the BERT take a second SmartAccess connection while one is open: refused, the first dropped, or both? | 7; without answers, Copy only and no claim | |
| 9 | `LOAD_*` filled in `bridge/.env`: can the bridge's own SFTP login list the load directory? | 11 | |

## Procedures

**A definition** lives in `catalog/common/procedures.json`, kept by hand; a stream's `catalog/<stream>/procedures.json` overrides entries by `id`. Each is `{ id, label, level, tier, params, pre, steps, verify, restore }`:
- `level` is chassis, card or port; `tier` is read, reversible or change.
- `params` are filled from the topology, a show or the load list. A param is one word: one of its enum's values, or an address that matches its pattern. Anything else is refused before a line is typed.
- A step is `{ send, drops?, timeout? }` or `{ wait: <check>, args, every, timeout }`. The placeholders are `fillStep`'s, each a param. A read procedure sends only `show` lines, only a change may drop the session, and no line may change the shell's mode (`configure`, `exit`, `^^^`, `bash`): the runner does that itself.
- `pre`, `verify` and each `wait` name a check: a small JS function that lists the shows it reads and judges what they printed, not a mini-language, with the box's folder for one that compares with its runs. One procedure per box at a time is checked for every procedure.
- A verify that judged the box may return findings, what it found wrong: the procedure still ends `done`, each finding a `finding` step in its log. `failed` is for one that couldn't run or judge.
- `restore` undoes a reversible procedure.
- Default timeouts come from the [table above](#what-the-runs-show).

**The runner** (`bridge/procedures.mjs`; only the bridge talks to boxes):
- Runs on a shell of its own on the box's session, so polls, typed shows and `/show` go on. That shell's prerequisites are `configure`, `set cli length 0`, `set cli width 1024`, `set cli confirmation-required no` (but in a read procedure) and `exit`.
- Enters `configure` only for set, delete and rpc steps, and always leaves it.
- Holds the session (`procedure:<id>`) until it ends, so it outlives the view that started it.
- Never sends a line twice.
- A `drops` step is followed by a `wait` for the box. A drop is expected while that step's own line is typed, and in the waits and the verify after it, until the box is back: the runner then waits for the reconnect and that connect run's snapshot, whole, so its shell is never in `configure` while the poller sets up, opens its shell again and goes on, a wait or the verify running again. A drop anywhere else, a line being typed among them, stops it, saying to check the box.
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

This plan, the [BERT plan](bert-smartaccess-plan.md) brought in line, the [decisions](decisions.md) of 2026-11-12 and the [roadmap](roadmap.md#left) entries.

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
- Tests, on `test/fakes/lab.mjs` (`sessions-procedures`, `-changes`, `-drops`, with the tests' procedures in `test/fakes/procedures.mjs`; units in `procedures.test.mjs`): a read procedure end to end (the run, `procedure.json`, the index lines, the `latest()` skip); one procedure per box; a rejected step fails and leaves `configure`; cancel; pending → Approve (the Origin rule) → runs, and a pending one expires; a view leaving mid-run doesn't close the session; a drop on a `drops` step goes on after the reconnect's snapshot, and on any other step stops.

### 3. Procedures panel

- `src/procedures.ts`: `procedureItems()`, as `termItems` is for terminals, greyed out with why: not connected, one already running or pending, test equipment, another level. A param named `card` starts as the card it is at. Whether a param's value is taken is `fits` in `bridge/fill.mjs`, the bridge's own rule.
- `src/Menu.tsx`: an item carries its action, a terminal or a procedure, so a right-click on a card offers that card's procedures.
- `src/ProcedurePanel.tsx`: a **Procedures** button in the physical view's header, with a dot while one runs, opens a fixed-size panel over the stage in three regions: the list; the params, the exact lines and Run, Request, Approve (type the hostname) and Cancel; the step log, with a progress line for long waits. It asks `GET /procedure` every second while open or while one waits or runs, else every 5 s while connected, so a change asked for from Codex shows within 5 s. The buttons sit in one row that never moves, each enabled only when it applies; the list says only why one is not for here, and why none can run now is said once.
- Browser check (passed 2026-11-12, against the fake bridge): the panel's parts and the header keep their boxes in nine states; a read procedure runs; a change waits, a wrong hostname is refused, the right one in any case approves it; Cancel stops a wait and the reversible one restores; a right-click on a card offers its procedure and opens the panel at it, `card` filled in; Esc closes it.

### 4. MCP

- On `/mcp`: `list_procedures`, `procedure_status`, and `run_procedure` by tier, as in [Procedures](#procedures); a read procedure is waited for up to about 2 min (`PROCEDURE_WAIT_SEC`, 120 s), then answered with its status. Codex gives a tool call 60 s unless the server's `tool_timeout_sec` says more, so the README's Codex block sets it to 150.
- `check()` takes rpc lines from `procedures.json` only: `rpcOf` (`bridge/cli-index.mjs`) finds the index rpc a line starts with, and `fillsStep` (`bridge/fill.mjs`) whether a step's line is that line, each placeholder one word its param takes.
- An OLS Tracer test (`test/bridge/procedure-lines.test.mjs`) checks every procedure line, its checks' shows too: a show line is a show of the CLI index, a set or delete line one with no word left out, an rpc line's head is an index rpc, and each rpc line's shape, each value of an enum param in it too, was sent to some box (`history.jsonl`). It is shown to catch made-up lines on procedures of its own before it runs on the catalog's.
- Updated: the server's instructions (their first 247 characters stay), the README's tools and its "never the box", the [MCP decision](decisions.md#mcp), the pinned tool names in its tests, the fake bridge, and the pin.

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

- `examples/csp.olst.json` moves to `catalog/csp/lab.olst.json` (`git mv`) and gets `lock: { sha256 }`. The plain password has left `notes.md`: item 6 is in [notes done](archive/notes-done.md) without it.
- Bridge (`bridge/lab.mjs`): `GET /lab` answers `{ topology, mtime }`; `PUT /lab?mtime=` answers 409 when the file changed since (after a pull), else writes it in one step, a whole file renamed over it.
- App (`src/lab.ts`): loads the lab on start and saves it with `PUT` half a second after a change, one request at a time. A 409 says to reload and leaves the page read-only. The browser keeps only the view and a copy of the lab, shown read-only while the bridge is down, and asks the bridge again every 5 s. New, Open, Save, the new-project dialog and the corporation dropdown go (switching would overwrite the lab); the stream shows as a label.
- Lock: a 🔒 button in the top bar; unlocking asks for the password, checked by SHA-256 in the browser, and a reload locks again. While locked: no adding, deleting or moving devices or racks (palette, drag, Delete key, rack moves), and no host edits (names have no edit). Cards, pluggables, fibers and bays stay free. The store refuses the rest with a toast that says why, so no control can get round it. The lock is a client-side check, not security. The browser's SHA-256 (`crypto.subtle`) needs localhost or HTTPS: hosting will need HTTPS anyway.
- **It follows the hardware:** a card or pluggable the box reports in or out changes the lab file, locked or not, since the lock leaves cards and pluggables free. Connect already syncs a box's cards, pluggables and strands into the topology (`discover` in `src/live.ts`). The view sends `POST /lab/sync?host=` the device's slots and every fiber on it, as its own sync leaves them, and the bridge gives that device in the lab file as it is those slots and fibers, in one write, so two views syncing one box, or someone editing, never overwrite each other. It writes only when something changed, and answers what did (`bridge/changes.mjs`, which the view uses too, sending nothing when the lab has it already); the toast says it. A box the bridge can't name yet (a new host before its `show system`) has no strands, `null`, never the default box's, so its first sync can't drop the fibers the lab has. It runs while someone has that box's physical view connected; a box nobody has open is brought up to date the next time someone does. Doing it with nobody watching needs `discover` and the catalog in the bridge, which are TypeScript in `src/` today: later, if it is wanted.
- Docs: the [product decision](decisions.md#product), the README's Run steps, the guide.
- Browser check (passed 2026-11-13, against the fake bridge, the lab copied with made-up hosts): locked, nothing can be dragged, deleted or added, nor a box IP changed, and a card still goes in; unlocked, everything can, and each change is saved; no save reloads the page; a file changed on disk gets a 409, a toast to reload and **Read-only**; a reload locks again; a card the fake box reports in lands in the lab file while it is locked, with one toast; with the bridge down the page shows its last copy read-only, and loads the lab again once the bridge is back; the top bar keeps its boxes in every state.

### 7. BERT SmartAccess

As in the [BERT plan](bert-smartaccess-plan.md), rewritten 2026-11-13 for a tracer hosted on a Linux machine:
- SmartAccess AnyWhere is a Windows app on each person's PC, so it opens there, never on the server: no launcher in the bridge.
- The BERT's one fixed IP is its device's `host` in the lab file, the same for everyone, editable only while the lab is unlocked.
- The tester's header: the IP, **Copy**, and **Open SmartAccess**, which copies the IP and, if check 7 finds the exe takes it, opens an `ols-bert:` link that a one-time registration on the PC hands to the exe.
- One at a time, if check 7 finds the BERT takes one connection: the bridge keeps one claim on it, which everyone sees (who, since when), let go by **Done** or 30 min after the page holding it last said so. Advisory: SmartAccess opened outside the tracer isn't stopped.
- Testers stop polling `/status` and `/state`.

### 8. LEDs and stats (removed)

Removed 2026-11-13: an LED's behaviour is the product's own, in its profile in the codebase, to be captured from there, never defined here. Card stats go with it. Both are in the [roadmap](roadmap.md#later). The numbers of the phases after it stay as they were.

### 9. Locate chassis

- Start, hold for `duration` (60 s by default) or until Stop, then stop: on the end, on cancel and on a failure.
- The MCP's `/mcp/lab` with only `run_reversible`, and a README block for its Codex server.
- Proven: the box blinks, once from the UI and once from Codex.

### 10. Reboot card or NE

- `reboot-card`: card, and cold or warm. Waits for `COMMUNICATION_FAILURE` raised and cleared (3 min), then oper-status active. A failed card reboot offers Reboot NE.
- `reboot-ne`: drops SSH; waits for the reconnect, `SYS_STARTUP` and the alarms to settle (6 min).
- The runner shell's `set cli confirmation-required no`, or the prompt answered, as check 3 finds.
- Tests: the fake box replays box 3's 2026-10-28 card reboot alarms in order, and an NE reboot (the drop, refused logins, `SYS_STARTUP`).
- Proven: one approved from the UI, one queued from Codex and approved.

### 11. Software upgrade, Commit and Rollback

- `GET /loads?stream=`: the bridge lists `Release_<STREAM>-*.tar` on `LOAD_SERVER` under `LOAD_DIR` over SFTP, two levels down, with its login only in `bridge/.env`; cached for a minute.
- `software-upgrade`: download, waiting for candidate-status `download-completed`, checked every 30 s for up to 2 h; activate, which drops SSH, waiting for `CU_SWITCH` and `NO_CMT_SW` for up to 30 min; verify that the active release is the load picked. It marks the baseline stale and offers **Capture baseline**.
- `software-commit` and `software-rollback`, each its own Approve, offered only while active-status is `active` and after the soak: by default `SETTLE_SEC` (480 s) with a clean health check.
- Tests: a fake SFTP listing, and a fake box's download and activate.
- Proven: one upgrade on test01 or test02.

### 12. Service turn-up and teardown

- The lines and their order from box 04's turn-up on 2026-10-27 and its teardown on 2026-11-05; the params from the topology.
- `pre`: the port-mode fits the transceiver. Both end with `save configuration`.
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

The guide, README, roadmap and decisions brought up to date; this plan and the BERT plan to [archive](archive/); notes items 6 and 8 to [notes done](archive/notes-done.md).

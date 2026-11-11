# MCP initial

An MCP server on top of OLS Tracer, so an agent can diagnose one box: explore it, find what is wrong past the false alarms, and end with the fix as steps.

**Status (2026-11-08): done.** Phases 0, 1, 1.5 ([Codex](#codex)), 2 (live) and 3 (diagnose) are built, in the repo `code/ols-mcp`, which pins OLS Tracer at `7a75edd`. Phase 2 passed the MCP README's work-machine checklist on box 3, run from Codex: `bridge_connect` recorded `20261108-151248-connect` (57 of 57 commands), `run_show` answered `show och 1-7-5` with `ok: true`, and `capture_baseline` recorded `20261108-151528-baseline` (`state: healthy`, 19 of 19). Against that baseline, all 10 of the connect run's alarms are `baseline` noise, and `diff_vs_baseline` finds no change. Before that, a full run against a fake box (box 3's recorded output replayed on 127.0.0.1) passed. Phase 3's `diagnose` prompt meets its bar from Codex on box 3's ten recorded cases: 26 of 30 tries exact, against 2 of 10 for the rule baseline, with 1 wrong against its 5, and every CLI fix line passes `check_commands` (the [score table](#score-table)). The plan was refined from `nitin/mcps.md` (iteration 1), the ROADM diagnostic plan and the CLI agent spec.

## Decided (2026-11-07)

1. **Its own repo, on top of OLS Tracer.** The MCP reaches boxes and runs only through the bridge's HTTP API, bridge control included (`connect`, `disconnect`, mark a pull, capture a baseline). It imports OLS Tracer's domain code from a pinned git dependency and never copies it. Commands it sends to a box are still `show` only, and fix commands are written out for a person, never run.
2. **Local first, built as a remote MCP.** A remote server needs IT approval, which can take a while. The server is written so that moving it to a shared host changes only its config (see [Remote-shaped](#remote-shaped-local-first)).
3. **The agent reasons over tool outputs.** Tools return facts with tags, such as an alarm marked as noise and why. They never name the fault.
4. **One box at a time.** Every tool takes a `box`, because `data/boxes/` already holds four.
5. **Short answers, checked fixes.** A software fix is CLI commands, each one found in the CLI catalog. A hardware or fiber fix names the slot and port and whether it is Tx or Rx, plus the alarm when it helps. See [Answer](#answer).
6. **Any MCP client.** The same server, tools and token serve Codex and any other client, so nothing in a tool may assume one client. See [Codex](#codex).

Audience: developers and white-box testers, in Codex or another MCP client with the repo open. Black-box testers come later, through the tracer UI.

## Remote-shaped, local first

| Concern | Now (local) | Later (remote, after IT approval) |
| --- | --- | --- |
| Transport | Streamable HTTP at `http://127.0.0.1:<port>/mcp`, never stdio | The same, on a lab host behind TLS |
| Auth | A bearer token from the server's env, checked on every request | Org SSO through MCP's OAuth flow |
| Where it runs | The work machine, next to the bridge | A lab host that reaches the boxes. The bridge stays localhost-only there, so the MCP is the only piece on the network |
| Box credentials | In the bridge's env only, never in a tool's input or output | The same |
| Client setup | `codex mcp add ols-tracer --url <url> --bearer-token-env-var OLS_MCP_TOKEN`, once | The same command with the new URL, once |
| Updates | Restart the server | Deploy the server: tools, prompts and noise rules reach everyone with nothing to do on their machine |
| Workflow | `diagnose` is an MCP prompt served by the server, and Codex gets the workflow from the server's instructions. Never a skill file on each machine | The same |
| Inputs | Box ids, run ids and strand names. Never a client file path or topology JSON: the server builds the topology from the catalog, `wiring.csv` and the box state | The same |
| Audit | One JSONL line per call (who, tool, arguments, time) | The same. IT will ask for it |
| Sessions | One user, and the bridge holds one box session | A box session gets an owner and a lock |

The rule: nothing assumes stdio or the client's filesystem. If it works over `http://127.0.0.1` with a token, the move is config.

For the IT request: the host, its network path to the boxes, the auth method, the audit log, and the fact that **tool outputs are sent to the model provider**. Raw captures hold hostnames, serials and IPs, so responses may need an option that redacts them.

## Codex

Phase 1.5 makes the server work from OpenAI's Codex CLI. It is the same server, with the same tools and token.

- **Setup:** `codex mcp add ols-tracer --url http://127.0.0.1:8023/mcp --bearer-token-env-var OLS_MCP_TOKEN`. It writes `[mcp_servers.ols-tracer]` with `url` and `bearer_token_env_var` into `~/.codex/config.toml`. The token stays in the environment, never in the file, and Codex doesn't connect while the variable is unset. That block also takes `default_tools_approval_mode = "writes"` (phase 2): Codex runs the tools marked `readOnlyHint` (the diagnosis tools and `bridge_status`) without asking and asks before `run_show` and the control tools, and `codex exec`, which can't ask, refuses those. Until phase 2 it was `"approve"`, which runs everything without asking.
- **Workflow:** Codex's MCP docs cover tools and server instructions, not prompts. So the server gets `instructions`: what the tools are for, that a recorded run is `live: false`, never to make up a reading, and to pass every fix line through `check_commands`. Codex's docs say it reads the first 512 characters as a summary, but Codex 0.167 lists the server by its first 247, so the rules come first and fit in those. A client with prompts reads the same instructions and gets the `diagnose` prompt too. Since phase 3, the instructions end in the same diagnose workflow.
- **Schemas and answers:** each tool's input schema loads in Codex, and the largest answers (`get_alarms_pm` with `include_noise`) aren't cut short. `tools.<tool>.output_token_limit` in Codex's config raises a tool's budget if one is.
- **Audit:** `who` tells clients apart by their user agent.
- **Scoring:** the phase 3 runner runs the cases through `codex exec`, scored on [one table](#score-table).

## Tools (v1)

### Diagnosis

| Tool | Input | Returns | Built from |
| --- | --- | --- | --- |
| `explore_box` | `box` | What the connect snapshot gathers: system, software, cards, transceivers, strands, and the light paths traced through them. Live, or the last run with `live: false` | `discover`, `wired`, `heads`/`trace`, `wiring.csv` |
| `get_alarms_pm` | `box`, `run?`, `include_noise?` | Alarms, each tagged with [noise](#false-alarms), and power and PM per port | `allAlarms`, `portPower`, `verdictAt` |
| `trace_path` | `box`, `strand` or `port` | Ordered hops, each with its alarms, power and verdict, and the first loss on the path | `trace`, `alarmsOn`, `firstLoss`, `l0Problems` |
| `run_show` | `box`, `command` | One `show` command's parsed and raw output, live only | A new bridge `/show` endpoint on a `shells.mjs` worker |
| `diff_vs_baseline` | `box`, `run`, `baseline?` | Config differences field by field, new and cleared alarms, and power changes against the box's healthy run, plus the box's config log since then (what was set, deleted or rebooted, and when) | The ROADM plan's two workers, `history.jsonl` |
| `check_commands` | `box`, `commands[]` | For each line, the catalog command it runs (id, op, syntax, and the help text that lists the allowed values), or `unknown`. A combined `set` line is split into its settings, and each setting is checked | `commandFor` in `bridge/cli-index.mjs`, over `data/cli/<stream>/cli-index.source.json` (985 commands: 584 `show`, 330 `set`, 38 `delete` and 33 `rpc`) |

`run_show` runs a line only if `check_commands` finds it as a `show` command. It also refuses pipes, `?`, and `set`, `delete`, `commit`, `rpc`, `clear` and `reboot`.

### Bridge control

`bridge_status`, `bridge_connect`, `bridge_disconnect` and `mark_pull` use the bridge's existing endpoints, and `capture_baseline` uses a new one. Each one changes the session or the recorded runs, never the box.

A box's host is the one its latest run records (`meta.json`'s `host`), since `/connect` takes a host and `/status` names one. `bridge_connect` posts it, and the connected box is the one whose host `/status` names, so `run_show`, `mark_pull` and `capture_baseline` refuse any other. A box with no runs yet is connected once from the physical view.

### Baseline

The `baseline` noise rule and `diff_vs_baseline` both need a healthy run of the box as it is set up now.

- **Detecting a change:** `explore_box` and `diff_vs_baseline` report `setupChanged` when the provisioned cards and transceivers, the software release or the `wiring.csv` strands differ from the baseline's. Alarms, power, config changes and a provisioned card that is absent don't count, because those are what a fault changes.
- **While the baseline is stale:** the `baseline` rule is off and the other noise rules still apply. The answer adds one line: `Baseline is stale: <what changed>. Record a new one?`
- **`capture_baseline(box)`:** the bridge takes a snapshot and records it as a run with `trigger: baseline` and `state: healthy`. It needs a connected box.
- **Never automatic.** A baseline taken during a fault turns that fault's alarms into noise for every later diagnosis. So the agent asks the person first. The tool also refuses when a traced path shows a loss, and it names the place.

### Prompt: `diagnose`

The workflow, in order:

1. `explore_box`
2. `get_alarms_pm`, with noise hidden
3. `diff_vs_baseline`
4. `trace_path` from the most upstream new alarm
5. `run_show` to confirm
6. `check_commands` on every fix command

It ends in the [answer](#answer). The agent must not make up readings.

The prompt takes `box`, `run` and `baseline`, and names them for every tool that takes them. On a recorded run (`live: false`: any run it is given by name, or while the bridge has no session with the box), step 5 says to skip `run_show`. The server's instructions end in the same steps and answer, for Codex.

### Answer

The answer is short, at most three parts:

- **Fault:** the location.
  - A card: its slot (`card 1-6`).
  - A transceiver: its slot and port (`1-8-1`).
  - A fiber: its strand from `wiring.csv`, written from the Tx end to the Rx end.
  - A fiber with no known strand: the port, and Tx or Rx from the alarm (`IN_` or `rx` means Rx, `OUT_` or `tx` means Tx).
  - A setting: what is set where, and what it should match (the ad2 cases).
  - A restart or a change the alarms have not settled from: what was done, and when (the cold restarts).
- **Alarm:** included only when it is the evidence. It is one line for the root alarm, never its consequent alarms.
- **Fix:**
  - A software fix is CLI lines, written the way people type them, and each line must pass `check_commands`. Box 3's config log shows combined lines such as `set media-channel 2 line-port … add-drop-port … admin-state … center-frequency …`. The matcher alone returns `unknown` for that line, but each of its four settings matches once it is split. A step with no catalog command is said in words and marked "(not in catalog)".
  - A hardware or fiber fix is numbered hand steps at the named ends (check that it is seated, clean it, replace it). The end that alarmed goes first.

When two places fit equally, the answer names both, the most likely first. When nothing is found, it says so in one line, along with what it checked. The hypotheses, readings and missing data are given only when someone asks.

Illustrative fiber fault (the strand and the alarm are box 3's):

```
Fault: fiber F03, 1-7-5 Tx → 1-1-ad11 Rx
Alarm: IN_OPTICAL_LOW_FAILURE on port 1-1-ad11 (CRITICAL)
Fix:
1. At 1-1-ad11 Rx: check F03 is seated, clean the connector.
2. Still low: do the same at the 1-7-5 Tx end, then replace F03.
```

Software fault (box 3's ad2 case):

```
Fault: media channel 2 (1-1-ad2) is at 193.6 THz, but OCH 1-7-5 is at 193.5 THz
Alarm: IN_LOS on port 1-1-ad2 (CRITICAL)
Fix (CLI):
  set media-channel 2 center-frequency 193500000
```

### Folded in from the 2026-11-05 draft

`list_wiring_strands` goes into `explore_box`, `first_loss_on_path` and `l0_problems` into `trace_path`, and `bridge_state` into the tools that read state. `validate_topology` is dropped, because the server builds the topology itself. Resources wait until a client needs them, since the tools carry the data.

## False alarms

Box 3 shows the problem. Nine alarms are in all 22 of its alarm captures, healthy run included:

| Alarm | Resource | Severity |
| --- | --- | --- |
| `TRANSCEIVER_MISSING` | transceiver 1-8-1, 1-8-4 | CRITICAL |
| `EQPT_ABSENCE` | card 1-4 | CRITICAL |
| `EQPT_MISMATCH` | card 1-21 | CRITICAL |
| `PWR_NO_INPUT` | card 1-22 (the second PSU isn't in use) | MINOR |
| `LINK_DOWN` | port 1-43-nm, 1-43-nm1 (management) | MINOR |
| `NO_CMT_SW`, `DATETIME_UNCHANGED` | software, system | WARNING |

**Tag, never delete.** Each alarm gets `noise: <reason> | null`. By default `get_alarms_pm` hides noise and returns a count for each reason, and `include_noise: true` returns everything. The reasons, checked in this order:

1. **`baseline`:** the same alarm on the same resource is in the box's latest healthy run. This covers most standing alarms without hand-written rules.
2. **`unused`:** `EQPT_ABSENCE` or `TRANSCEIVER_MISSING` on a slot or port that no strand in `wiring.csv` uses. A missing transceiver on a wired port is not noise, because it can be the fault.
3. **`off-path`:** the resource is on no traced light path, for example management ports.
4. **`housekeeping`:** system alarms that never affect light (`NO_CMT_SW`, `DATETIME_UNCHANGED`), from a list.

These are not noise but are tagged too. **`consequent: <alarm>`** marks an alarm that lies downstream of the first loss on the same path, such as `OUT_LOS` on 1-1-ba after `IN_LOS` at 1-1-ad1. The agent reads it as an effect, not a cause.

**`unsettled: <change>`** marks an alarm read within the settle time after a config change or a restart in the config log. The box is slow to update its alarms: box 3's ad3 and ad4 were working, but their snapshots still showed the earlier LOS. The answer then adds the line `Changed at <time>: alarms may lag, check again in <n> s.` The settle time is a config value until the runs measure it.

The rules live in a data file (`mcp/noise.json`), so a new rule is a data change, and it reaches everyone on the next deploy.

**Guard:** a test over every box 3 run that has an `answer.json`. No alarm at the pulled strand may be tagged as noise. The test also reports how many alarms each rule hides.

## Architecture

- **The MCP repo:** Node and TypeScript, the official `@modelcontextprotocol/sdk` with its Streamable HTTP transport, and `zod` for input schemas. Its port, token and bridge URL are in its own config.
- **Code from OLS Tracer:** a git dependency pinned to a commit (`github:NitinDatta8/ols-tracer#<sha>`). It provides `src/l0.ts`, `live.ts`, `rules.ts` and `catalog.ts`, the catalog, and `bridge/cli-index.mjs`, none of it copied. The MCP runs under `tsx`, because the imports in `src/` have no extensions (`moduleResolution: bundler`). Moving to a newer OLS Tracer means bumping the pin.
- **Data from the bridge:** everything comes over HTTP on 127.0.0.1, with the `x-ols-tracer: 1` header the bridge requires. The MCP never reads OLS Tracer's `data/`, so the two can later run on different hosts.
- The bridge holds one connection today. A `box` that isn't the connected one is answered from its last run, with `live: false`.

### Changes in OLS Tracer

| Endpoint | What it does |
| --- | --- |
| `GET /runs?box=` | Lists a box's runs, with their meta |
| `GET /run?box=&run=` | Returns one run's parsed commands, meta and wiring, never its `answer.json` |
| `GET /history?box=&since=` | Returns the box's config log since a time |
| `POST /show` | Runs one allowlisted `show` command on a `shells.mjs` worker |
| `POST /baseline` | Takes a snapshot and records it as a healthy baseline run |

`src/catalog.ts` loads the catalog with Vite's `import.meta.glob`, which Node can't run, and `l0.ts`, `live.ts` and `rules.ts` all import from it. Phase 0 moves that loading out, so that the helpers and `catalogFor` also run in Node, from the same `catalog/` files.

Two changes in the recorder:

- **It saves `wiring.csv` into each run** (done 2026-11-08, `7a75edd`), and `/run` serves a run's own. Before, there was one file per box, so an old run was read with today's strands. The 11-02 cases moved the fiber from ad1 to ad2, then to ad11, so the three runs the ad2 cases read got theirs by hand.
- **`detectable` stops being false for every strand into the BERT** (not done: the eval takes F02's answer from its strand). It is false today, because the Rx end isn't a box port. But F02's snapshot shows `LINK_RF` on 100ge 1-7-4 and nothing else: the BERT's remote fault comes back to the box.

Phase 3 also fixed `discover()` in `src/live.ts` (`cd507a0`). It waited for a transceiver table that box 3 doesn't print while it has no transceivers (card 1-7 out, a cold restart's first minutes), so the read tools failed on four of the cases, and the physical view kept fetching.

## Phases

| Phase | Work | Exit criteria |
| --- | --- | --- |
| 0. Scaffold (done 2026-11-07) | In OLS Tracer, `catalog.ts`'s Vite-only loading moves out. In the new repo: HTTP at 127.0.0.1, the token check, the audit log, the pinned OLS Tracer dependency, `bridge_status` | An MCP client lists the tools, a call without the token gets a 401, and `l0.ts` imports from the pin |
| 1. Recorded data (done 2026-11-07) | `GET /runs`, `GET /run` and `GET /history` in the bridge. `explore_box`, `get_alarms_pm` with noise tags, `trace_path`, `diff_vs_baseline` and `check_commands` over box 3's runs | The noise guard passes on every box 3 run that has an `answer.json`, and `check_commands` accepts box 3's logged config lines, setting by setting, but rejects made-up ones |
| 1.5. Codex (done 2026-11-07) | The server's `instructions`, the Codex setup in the README, and each tool's schema and largest answer checked in Codex (see [Codex](#codex)) | On a machine with Codex CLI, `codex mcp list` shows `ols-tracer`, a `codex exec` run calls `explore_box` and `get_alarms_pm` on box 3's F03 pull, and the audit log names Codex as `who` |
| 2. Live (done 2026-11-08) | The bridge control tools, `POST /show`, `run_show`, `POST /baseline` and `capture_baseline` | On the work machine, box 3 is connected, a `show` runs through the MCP, and a baseline is captured |
| 3. Diagnose (done 2026-11-08) | The `diagnose` prompt and the [scoring](#scoring) runner | It beats the rule-based baseline (the most upstream LOS on the known path), and every fix command passes `check_commands`. The score table is in this plan |

## Safety

- Commands to a box come only from `run_show`, which is `show` only and limited to the catalog.
- Fix steps are text. No tool changes a box's config.
- Every response carries `live`, `at` and the `runId`, so a recorded run isn't mistaken for live state.
- The box credentials stay in the bridge's env.
- No tool returns `answer.json`. Only the scorer reads it.

## Scoring

- **Cases:** listed [below](#cases-box-3) and kept in `eval/cases.json` in the MCP repo, with run ids as the bridge's `/runs` lists them. Each one has a fault snapshot, its baseline and the expected answer. For the recorder's pulls, the expected answer is their `answer.json`'s strand. Cases run on recorded data, so `run_show` isn't available to them.
- **Runner:** `npm run eval` in the MCP repo. It starts the server on a free port with a token of its own, gets each case's `diagnose` text with `prompts/get`, and gives that same text to `codex exec`, three times, because answers vary. The agent gets only the 6 read tools: no shell, no file reads, no other MCP server and no hooks. It starts only while the bridge has no session, and checks after that it still has none and that nothing called a live tool.
- **No judge model:** the answer's fixed shape makes its `Fault:` part parseable: its line, and any lines under it up to `Alarm:` or `Fix:`. The first thing it names decides: a strand of the run's `wiring.csv`, a media channel, a port (with Tx or Rx when one follows it; `in` counts as Rx and `out` as Tx), a card, or for a restart case the restart.
- **Score per try:**
  - `exact`: the strand, card or port matches. A fiber also matches by one of its ends, with the right Tx or Rx.
  - `near`: the right port at the wrong end (or the other strand on the same ports, as F04 for F03), or the right card at the wrong port. For a card fault, a strand is `wrong`: it sends someone to the fiber.
  - `none`: the `Fault:` part names no place, as when nothing was found, or there is no `Fault:` line.
  - `wrong`: the answer names another place.
  - A setting (the ad2 cases): `exact` when the first place is its media channel or that channel's port (1-1-ad2), `near` when it is a strand into that port or another place on its card, and `wrong` otherwise.
  - A restart: `exact` when the `Fault:` part names the restart (`restart` or `reboot`) before any place, `wrong` when it names a place first, and `none` when it names neither.
- **Cost:** a `wrong` costs more than a `none`, because a wrong place sends someone to pull the wrong fiber.
- **Fix check:** every line of the `Fix:` part that starts with a catalog word (`show`, `set`, `delete`, `rpc`, or an rpc typed bare, such as `reboot`) is a CLI line, and goes through `check_commands`. The fix is CLI when one of those lines isn't a `show`, else hand steps. The table's notes give any fix of the wrong kind.
- **Bar:** the rule baseline is scored on the same cases. It is the most upstream loss on the known paths: in `wiring.csv`'s order, the first traced path with a loss alarm (LOS, LOF or an `OPTICAL_LOW_FAILURE`) that `get_alarms_pm` shows with noise hidden, at the first hop that has one, named as the answer would name it (the strand into that end, else the port). It is code over the read tools, in the runner. Each agent must match or beat it on `exact` over its three tries (three times the baseline's count), with no more `wrong`, and every CLI fix line must pass `check_commands`.
- **Table:** a case, its answer, the rule baseline's result, each agent's three tries, and notes. It is [below](#score-table), and every answer is in the MCP repo's `eval/results.json`.

### Cases (box 3)

Runs are under `data/boxes/box3/runs/`. "Standing alarms" means the nine [false alarms](#false-alarms) plus the channel's `REACH_MAX_ATT_SRC_TO_DEST`. Times come from the config log, and they assume its clock lines up with the run names.

| Case | Fault snapshot | Baseline | Expected answer | Notes |
| --- | --- | --- | --- | --- |
| F01 pull | `20261105-163752-pull` | `20261105-162614-connect` | Fiber F01, BERT:P1 Tx → 1-7-4 Rx. `RX_LOS` on transceiver 1-7-4 | |
| F02 pull | `20261105-164053-pull` | the same | Fiber F02, 1-7-4 Tx → BERT:P1 Rx. `LINK_RF` on 100ge 1-7-4 | The BERT's remote fault. Its `answer.json` says `detectable: false`, which is wrong |
| F03 pull | `20261105-164615-pull` | the same | Fiber F03, 1-7-5 Tx → 1-1-ad11 Rx. `IN_OPTICAL_LOW_FAILURE` on port 1-1-ad11 | The line, amplifier and `och 1-7-5` alarms are consequent |
| C1125 out and back | `plugout-1125/20261102-124335-alarms` | `plugout-1125/20261102-124208-connect` | Card 1-1 (TMUXC1125) out of its slot: reseat it | There is no alarm on 1-1 itself, but `show card` says absent. Only `RX_LOS` on och 1-7-5 and `LINK_RF` appear |
| 800MX out and back, run 1 | `plugout-800MX-run1/20261102-124748-alarms` | `plugout-800MX-run1/20261102-124631-connect` | Card 1-7 (800MX) out of its slot. `COMMUNICATION_FAILURE` on card 1-7 | The rule baseline names 1-1-ad11 (the most upstream LOS), which is wrong |
| 800MX out and back, run 2 | `plugout-800MX-run2/20261102-125452-alarms` | `plugout-800MX-run2/20261102-125345-connect` | The same as run 1 | |
| ad2, no media channel | `20261102-115853-connect-ad2-nonworking` | `20261102-115731-healthy-run1` | No media channel on 1-1-ad2, and channel 1 still drops to 1-1-ad1. Fix: `set media-channel 2 line-port port-1-1-line add-drop-port port-1-1-ad2 admin-state in-service center-frequency 193500000` | `IN_LOS` is on 1-1-ad1, where the fiber no longer is. The strand moved, so the baseline is stale |
| ad2, wrong frequency | `20261102-120137-alarms-ad2-nonworking` | the same | Media channel 2 at 193.6 THz, while OCH 1-7-5 is at 193.5 THz. Fix: `set media-channel 2 center-frequency 193500000` | Set at 12:01:29 with `193600000`, and fixed at 12:11:20 |
| Cold restart, run 1 | `reboot-ne-cold-run1/20261102-122915-connect` | `plugout-1125/20261102-124208-connect` | The NE restarted cold at 12:26:57, and the alarms are its recovery. Check again once it settles | The agent must not name a fiber. The baseline is the nearest healthy snapshot with the same setup |
| Cold restart, run 2 | `reboot-ne-cold-run2/20261102-123719-connect` | the same | The same, with the restart at 12:35:00 | |

The ad2 runs and their baseline are read with the strands they were taken with: F03 and F04 on 1-1-ad1 in `20261102-115731-healthy-run1`, and on 1-1-ad2 in the two ad2 runs. Their `wiring.csv` was written by hand on 2026-11-08, from the run names and the config log. Those runs have no `show media-channel` (it came later), so the missing channel shows only through the strand move and the alarms.

Two runs are dropped:

- **The warm restart:** none of its three snapshots caught an alarm.
- **ad3 and ad4:** both were working, but their snapshots still carried the earlier LOS, because the box was slow to update its alarms (see `unsettled` under [false alarms](#false-alarms)).

### Score table

Run 3 of 2026-11-08, `npm run eval` in the MCP repo: 60 tries, every one answered, the bridge with no session before and after, and no live tool called. Its answers are the MCP repo's `eval/results.json`.

| Case | Expected answer | Rule baseline | Codex (3 tries) | Notes |
| --- | --- | --- | --- | --- |
| F01 pull | Fiber F01, BERT:P1 Tx → 1-7-4 Rx | exact | exact, exact, exact | |
| F02 pull | Fiber F02, 1-7-4 Tx → BERT:P1 Rx | none | exact, exact, exact | The baseline sees no loss: `LINK_RF` is the BERT's remote fault |
| F03 pull | Fiber F03, 1-7-5 Tx → 1-1-ad11 Rx | exact | exact, exact, exact | |
| C1125 out and back | Card 1-1 | wrong | wrong, exact, exact | The baseline and Codex's first try name F04, the strand into the och that alarmed |
| 800MX out and back, run 1 | Card 1-7 | wrong | exact, exact, exact | The baseline names F03, into 1-1-ad11 |
| 800MX out and back, run 2 | Card 1-7 | wrong | exact, exact, exact | The same |
| ad2, no media channel | No media channel on 1-1-ad2 | near | near, near, near | Every try names fiber F03 into 1-1-ad2, with hand steps; the baseline names 1-1-ba. See [left open](#left-open) 6 |
| ad2, wrong frequency | Media channel 2 at 193.6 THz, not 193.5 | near | exact, exact, exact | Every try names media channel 2, as a change still settling, not as the wrong frequency, and none gives the CLI fix; the baseline names F03 into 1-1-ad2 |
| Cold restart, run 1 | The NE restarted cold at 12:26:57 | wrong | exact, exact, exact | Each names `reboot ne cold` at 12:26:57, from the `unsettled` tags; the baseline names F03 |
| Cold restart, run 2 | The NE restarted cold at 12:35:00 | wrong | exact, exact, exact | The same, at 12:35:00 |
| **exact / near / none / wrong** | | 2 / 2 / 1 / 5 | 26 / 3 / 0 / 1 | |

Codex wrote no CLI fix line in this run, and no try gives a config fix, so the two ad2 cases' expected CLI fixes are missed. Run 1, scored the same way, has the same totals. Run 2 is dropped: nine of its tries hit the account's usage limit, so a run with a try that got no answer now gets no verdict.

The scorer changed after looking at answers, each time scored again on the same saved answers (`npm run eval -- --rescore <results.json>`), with no agent asked again. It reads the whole `Fault:` part, because two answers listed their places under it. It scores a restart by what the `Fault:` part names first, because four answers that named the restart also named F03 or F05 as clean. And it takes a command quoted inside a sentence as prose, not as a CLI line, because of one answer. Run 1 with the first scorer was Codex 25 / 3 / 0 / 2, which met the bar too.

## Left open

1. **The settle time** (answered 2026-11-08): box 3's alarms were still settling 4 min 12 s after a cold NE restart, and clear by 7 min 53 s (its 11-02 runs), so `SETTLE_SEC` defaults to 480. One number serves config changes too, which likely settle faster.
2. **`detectable`** is still false for a strand into the BERT (see [Changes in OLS Tracer](#changes-in-ols-tracer)).
3. **`check_commands` and rpc lines:** it answers `unknown` for an rpc typed as people type it (`reboot ne cold`), so a fix step like that is said in words.
4. **A cold restart's first minutes:** `show card` lists only the cards that are up, so `setupChanged` lists the rest as gone (and `card 1-6: NONE → none`), and the baseline reads as stale.
5. **Old runs' strands:** the runs from before 2026-11-08 other than the three ad2 ones are still read with today's `wiring.csv`: the 11-01 runs, and the 11-02 runs on ad3 to ad10.
6. **Frequencies:** no tool shows an OCH's frequency, and the 11-02 runs have no `show media-channel`, so the ad2 wrong-frequency case shows only the config log's `193600000`. The agents name media channel 2, but as a change the alarms haven't settled from, not as 193.6 THz against the OCH's 193.5, and no try gives the CLI fix. The missing channel in the other ad2 case is not seen either: every try names fiber F03 into 1-1-ad2.
7. **`check_commands` and placeholders:** it passes a line with the syntax's own placeholder (`show media-channel <index>`).
8. **Run ids say what was done** (`-pull`, `plugout-800MX-run1/`, `reboot-ne-cold-run1/`, `ad2-nonworking`), and an agent cites them ("the run is named pull") as support. The place still comes from the tools, but a blind eval would need ids that don't.

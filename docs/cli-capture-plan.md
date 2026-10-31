# OLS Tracer: capturing the CLI of box 3

Round 1 of Goal 2.5: learn the CLI and what its output looks like on box 3, and store it so it can be reused, before choosing how to pull the link design. This page says exactly what to collect and in what format. Everything collected goes in `docs/internal/box3/`, which is git-ignored and never pushed.

## What to hand over

| # | What | Format | Why |
| --- | --- | --- | --- |
| 1 | The CLI reference | The PDF as is, plus its title, version and the software release it covers | The full list of commands, syntax and sample outputs |
| 2 | Box 3 facts | `setup.md`, filled in from the template below | What the CLI can't tell: the BERT, passives, the service under test |
| 3 | The fiber map | `wiring.csv`, one row per strand (below) | The box knows its ports, not where the glass goes |
| 4 | Real outputs | Three runs captured on box 3 (below) | Docs lag the build. Templates are written against real output, never against PDF samples |
| 5 | Photos (optional) | `photos/*.jpg` of the rack's front and back | To check the fiber map and the labels |

```
docs/internal/box3/
  cli-reference.pdf
  setup.md
  wiring.csv
  photos/
  runs/
    run-01-healthy/
      meta.json
      raw/session.log            # option A: one session log per run
      raw/001_show-version.txt   # option B: one file per command
    run-02-pull-F03/
    run-03-restored/
```

The run layout matches the [ROADM diagnostic plan](../../../nitin/roadm-diagnostic-agent-plan.md) (`runs/run-XX/raw/`), so its collectors later write `observations.jsonl` into the same folders.

## 1. The CLI reference

- **The PDF unchanged.** Check its text can be selected in Preview. If it is a scan with no text layer, say so, because it then needs OCR first.
- **Its version** in `setup.md`: document title, version or date, and the release it covers. Box 3's own release comes from `show version` in run 1. If the two differ, the PDF is suspect wherever the box disagrees.
- **Better sources, if any exist:** HTML help, a man-page tree, or the table in the C++ source where commands are registered. Any of these beats the PDF. If the source is reachable, the same `cli-index.json` (below) can be generated from it.

## 2. `setup.md`

```markdown
# Box 3

## Nodes
| Hostname | Chassis model | Release | Chassis numbers (CLI) |
| --- | --- | --- | --- |
| box3-a | 2026-4RU | 5.2.1 | 1 |

## Service under test
- In words: BERT P1 → 1-3-C1 (client) → 1-3-L1 (line) → … → far client → BERT P2
- Client type: 100GE / OTU4 / …
- Line frequency or wavelength: 193.1 THz / channel 34 / …

## BERT
- Vendor and model:
- Test interface and ports used:
- Pattern, duration and pass criterion (e.g. PRBS31, 15 min, 0 errors):
- Remote control: none / SCPI / REST / other

## Passives (anything without its own CLI)
| Id | What | Value |
| --- | --- | --- |
| PP1 | patch panel | 24 ports |
| ATT1 | attenuator | 10 dB |
| SPOOL1 | fiber spool | 25 km |

## Behaviour
- ALS/APR (laser shutdown on loss): on / off, per line
- Protection: none / OPS / Y-cable
- Command that turns paging off:
- Prompt per mode (normal, configure, engineering):
- Box clock timezone:

## Not found in the CLI
Categories from the capture list with no command at all. A missing command is an answer too.
```

## 3. `wiring.csv`

One row per **strand**, from its Tx end to its Rx end, which is how the tracer models a fiber. A duplex cable is two rows.

```csv
strand,from,to,via,length_km,loss_db,notes
F01,BERT:P1,1-3-C1,,,,BERT Tx into client Rx
F02,1-3-C1,BERT:P1,,,,
F03,1-3-L1,1-5-L1,PP1:4;ATT1,,10.5,line out through the panel and a 10 dB pad
F04,1-5-L1,1-3-L1,PP1:5,,,
```

- **`strand`:** `F01`, `F02` and so on. Label the real fibers with the same ids if you can, because the experiments refer to them.
- **`from` / `to`:** a box port as its CLI address (`1-3-C1`). When box 3 has more than one node with its own CLI, prefix the hostname (`box3-a/1-3-C1`). Anything else is `NAME:port` (`BERT:P1`, `PP1:4`).
- **`via`:** the passives the strand runs through, in order, separated by `;`. Leave it empty for a direct patch.
- Write `?` for anything unknown. That is better than a guess.

## 4. Real outputs: three runs

| Run | Box state | Why |
| --- | --- | --- |
| `run-01-healthy` | BERT running, error-free | The baseline: every command in the capture list below |
| `run-02-pull-F03` | One strand pulled (pick one whose Rx end is a box port) | A healthy box has no alarms, so its alarm commands print nothing and can't be templated. This run shows what alarms, LOS and alarm history look like |
| `run-03-restored` | Fiber back in and alarms cleared | Shows how clear events look in the alarm history |

For run 2, pull the fiber, wait 60 s, then capture the alarm, alarm-history, port-state, power and client groups for the ports it touches. Put it back, wait for the alarms to clear and for BERT to be error-free again, then do run 3 with the same groups.

> **Laser safety:** never look into a pulled connector or a port, and cap the open ends. For this first pull, avoid an amplifier's output, whose power can be high. Don't rely on ALS to shut the laser off.

### Capture list

The command names are the usual ones on other vendors' boxes. Use the real names from the PDF. **P1** is needed for round 1, **P2** if time allows.

| P | Group | Look for | Scope |
| --- | --- | --- | --- |
| P1 | Identity | `show version`, hostname, uptime, **box clock** (`show clock`/`date`) | box |
| P1 | Help tree | `?` at the top level, `show ?`, and `?` after each P1 command (`show port ?`) | — |
| P1 | Inventory | chassis, every card, every pluggable with **part number** and serial, PSUs, fans | box |
| P1 | Port state | admin and operational state of every port | box, then one card, then one port |
| P1 | Optical power | Rx/Tx power per port, plus thresholds (LOS, low/high warning) | box, then one port, plain and `detail` |
| P1 | Amplifiers | input/output power, gain, tilt, mode, ALS/APR state | each amp |
| P1 | Channels | per-channel power (OCM) on a mux, ROADM or line port | each line port |
| P1 | Alarms | active alarms, with timestamps and severity | box |
| P1 | Alarm history | the event or alarm log: raise and clear, with timestamps | box |
| P1 | Neighbors | OSC, LLDP, trail trace (TTI, SAPI/DAPI), anything named neighbor or topology | box, each line port |
| P1 | Path config | cross-connects, services, frequency per line port, add/drop mapping | box |
| P1 | Client | Ethernet/OTN status, counters, FEC, pre-FEC BER, remote fault (RF), BDI | each client port in the service |
| P1 | Config dump | the whole running config, once | box |
| P2 | PM bins | current and past 15-min and 24-h bins | one line port, one client port |
| P2 | Protection | protection group state and switch events | each group |
| P2 | Environment | temperatures, PSU and fan state | box |

- **Scopes:** run each P1 command once for the whole box. The poller wants one command that covers every port. Then run it again on one card and one port on the service path, to see the address syntax and the `detail` fields.
- **Errors and empty output still count.** An `% Invalid input` shows the right syntax, and empty output is data.
- If a group has no command, write it under *Not found* in `setup.md`.

### How to capture

Use either option. Both have the same rules.

**Option A, one session log per run (less work, preferred):**
```sh
cd docs/internal/box3/runs/run-01-healthy/raw
script -q session.log ssh <user>@<box3-ip>
# turn paging off, run the commands, exit
```
I split the log into commands by its prompt lines.

**Option B, one file per command:** `NNN_<slug>.txt`, where NNN is the order they were run and the slug is the command with spaces turned into `-`. The address keeps its case, and `?` becomes `help`. For example `007_show-port-1-3-C2.txt` or `002_show-help.txt`.

**Rules for the raw output:**
1. **Paging off.** A `--More--` breaks the output. Use the CLI's own no-paging command and write it in `setup.md`.
2. **No wrapped lines.** Make the terminal at least 250 columns wide; a wrapped line breaks parsing. Use a plain macOS Terminal window, not the tracer's terminal, which wraps to the width of its panel.
3. **No edits.** Keep spaces, tabs, blank lines and column alignment exactly as they are. TTP matches on whitespace. Don't tidy anything up.
4. **Keep the prompt** before and after each command, so I can tell that nothing was cut off.
5. **No Tab completion, ↑ history or line editing in option A.** They leave control characters in the log. Paste the commands from a list.
6. **Redact only if policy needs it**, and then the same value always gets the same placeholder. Keep part numbers and CLI addresses, because inventory matching runs on them.

### `meta.json` per run

```json
{
  "run": "run-02-pull-F03",
  "box": "box3",
  "release": "5.2.1",
  "started": "2026-10-31T10:50:00-07:00",
  "ended": "2026-10-31T10:58:00-07:00",
  "boxClockOffsetSec": 0,
  "state": "fault",
  "bert": { "running": true, "result": "LOS on P2", "errors": null },
  "fault": { "strand": "F03", "action": "pulled", "at": "10:52:10", "restored": "10:55:00" },
  "notes": ""
}
```

- `boxClockOffsetSec` is the box clock minus the Mac clock, from `show clock`. It lines up alarm timestamps with the pull times.
- In round 1 the fault sits in `meta.json`. From the experiments on, it moves to `answer.json`, which the agent never sees.

## What I build from it

| Output | Where | What |
| --- | --- | --- |
| `cli-index.json` | `docs/internal/box3/` | Every command from the PDF, checked against the help tree and the captures |
| Capability map | `docs/internal/box3/capability-map.md` | Which link-design questions the CLI can answer, which it can't, and the commands for each |
| Fixtures and TTP templates | `bridge/fixtures/`, `bridge/templates/` | One per P1 command, from run 1 (and run 2 for alarms), tested by `npm test` |
| `poll.json` | `bridge/` | The commands the poller runs, and how often |
| How to pull the link design | a section in the capability map | OSC/TTI, power matching, or a hand-drawn map checked by pull tests |

### `cli-index.json`

```json
{
  "source": { "doc": "cli-reference.pdf", "docVersion": "…", "docRelease": "5.2", "boxRelease": "5.2.1" },
  "addressing": { "chassis": "{chassis}", "card": "{chassis}-{slot}", "port": "{chassis}-{slot}-{port}" },
  "modes": [
    { "id": "normal", "prompt": ">", "enter": null },
    { "id": "configure", "prompt": "#", "enter": "configure" }
  ],
  "commands": [
    {
      "id": "show-port",
      "syntax": "show port <port-address> [detail]",
      "template": "show port {chassis}-{slot}-{port}",
      "mode": "normal",
      "kind": "show",
      "safe": true,
      "scope": ["box", "card", "port"],
      "tags": ["port-state", "power"],
      "fields": [{ "name": "rx", "label": "Rx Power", "unit": "dBm" }],
      "page": 143,
      "onBox": true,
      "capture": "runs/run-01-healthy/raw/007_show-port-1-3-C2.txt",
      "notes": ""
    }
  ]
}
```

- **`kind`:** `show`, `config`, `action` (clear, reset, laser off) or `debug`.
- **`safe`:** true only when the command changes nothing. The MCP agent (idea 2) runs only safe commands without asking. `clear pm` is not safe, even though it looks harmless.
- **`tags`:** taken from the groups above: `identity`, `inventory`, `port-state`, `power`, `amp`, `channel`, `alarm`, `alarm-history`, `neighbor`, `path-config`, `client`, `config-dump`, `pm`, `protection`, `environment`.
- **`onBox`:** whether the help tree on box 3 has the command. It catches commands the PDF lists but this release doesn't have, and the other way round.

## Open question

Real outputs carry serials and hostnames. Should `bridge/fixtures/` (which is pushed) get redacted copies, or should the template tests read the captures from `docs/internal/box3/` and skip when they are missing?

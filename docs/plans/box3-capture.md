# OLS Tracer: capturing the CLI of box 3

Round 1 of Goal 2.5: learn box 3's CLI and what its output looks like, store it so it can be reused, and build the first Iter 3 view on it: measured light on the fibers. Everything collected goes in `data/boxes/box3/`.

**Status (2026-10-31):** run 1 (healthy) is captured as one hand-made `session.log`. That is the last hand capture. From now on the bridge records every run itself, from the SSH session the UI already opens (see [The recorder](#the-recorder)), and nobody is asked to capture anything. The wiring below is confirmed.

## Box 3

| | |
| --- | --- |
| Hostname | PAHO-GS2000-03 (`ne-type` COHERENT-GS2000) |
| Release | CSP-2.10.100.10_20261013 |
| Chassis | 1 |
| Cards | 1-1 TMUXC1125 (terminal mux/demux with integrated amplifiers), 1-7 800MX, 1-8 800MX |
| Client | 1-7-4: FS QSFP-LR4-100G (100GBASE-LR4, 4 lanes), port mode 100GE |
| Line | 1-7-5: Finisar QSFP-DD DCO, ZR400-16QAMSS-60G-OFEC at 193.5 THz, target −3 dBm |
| Service | Cross-connect CC5_4: 100GE-1-7-4 ⇄ 100GE-1-7-5-4 → flexgdu-1-7-5-4 → flexgo-1-7-5 (#4) → och 1-7-5 |
| Not in service | 1-7-1 (laser off), 1-8-1 and 1-8-4 (no transceiver) |
| Box clock | Wrong: 2021-07-26 on 2026-10-31 (`DATETIME_UNCHANGED` alarm), so alarm times need the offset in `meta.json` |

### Wiring

The light leaves the BERT, goes through 1-7-4 and 1-7-5, into the C1125, round its line side and back through a 10 dB pad, and returns the same way. LLDP on 1-1-osc sees the box itself, which matches the loop.

```csv
strand,from,to,via,length_km,loss_db,notes
F01,BERT:P1,1-7-4,,,,direct patch
F02,1-7-4,BERT:P1,,,,direct patch
F03,1-7-5,1-1-ad1,,,,line Tx into the mux
F04,1-1-ad1,1-7-5,,,,demux out to the line Rx
F05,1-1-line,1-1-line,ATT1,,10,line side looped back through a 10 dB pad
```

This is `data/boxes/box3/wiring.csv`, and the table above is in `setup.md`. Inside the C1125 (ad1 → booster → line, line → preamp → ad1) is L0, which stays opaque glass for now. F02 ends at the BERT, so the box cannot see it pulled: its right answer in an experiment is "insufficient evidence".

## The recorder

The bridge (`bridge/server.mjs`) already holds the box's SSH session, with two shells on it. The terminal shell is for people: it has Tab completion, history and line editing, and wraps to the width of the panel, so its output is never saved. The poller shell is clean: `term: dumb`, 500 columns, no paging, and the poller already cuts each command's output between its echo and the next prompt. The recorder writes what the poller reads to disk.

1. **Prerequisites.** Right after login, on the poller's shell, it runs the setup commands and saves their output as the run's first files:
   ```
   configure
   set cli length 0
   set cli width 1024
   exit
   ```
   Run 1 shows these work on this release (`set cli auto-width disabled` is `invalid command`). Box 3 has `config-saving-mode auto`, so they may be saved to its config; that is accepted. If one fails, `meta.json` says so and the poller stops, because paging could cut the output.
2. **A snapshot when the session opens.** It runs every snapshot command in the capture list once, into a new run folder.
3. **Polls.** The periodic polls append their parsed results to the latest run's `poll.jsonl`, one line per command per poll. Raw output goes to disk only in snapshots, so a long session stays small.
4. **A snapshot when the alarms change.** When the parsed `show alarm` set changes, it takes another snapshot into a new run folder. A pull and its restore are each recorded without anyone typing.
5. **Typed commands.** When someone runs a `show` command in the UI's terminal, the recorder reads the final command line (after Tab completion and backspaces) from a headless xterm (`@xterm/headless`) fed with the same output, runs it again on the poller's shell, and saves that clean output in the latest run. It only re-runs `show` commands, never `set`, `delete`, `clear`, `commit` or `rpc`.
6. **The answer.** The only step a person does is labelling, for scoring. Marking a fiber as pulled in the UI writes `answer.json` into the run that the alarm change created. The agent never reads it.

> **Laser safety:** never look into a pulled connector or a port, and cap the open ends. Avoid an amplifier's output, whose power can be high. Don't rely on ALS to shut the laser off.

### Run layout

Each run folder is one snapshot, plus the polls that follow it until the next one.

```
data/boxes/box3/runs/
  run-01-healthy/                      run 1, the hand capture, converted to this layout
  20261031-145210-connect/             <YYYYMMDD-HHMMSS>-<trigger>: connect | alarms
    meta.json
    raw/index.jsonl                    one line per command
    raw/000_configure.txt              prerequisites first
    raw/007_show-och-1-7-5.txt         the exact output, prompt lines cut
    parsed/007_show-och-1-7-5.json     its TTP result, or { "error": … }
    poll.jsonl                         the polls until the next snapshot
    answer.json                        only when a fault was marked
```

- **File names:** `NNN_<slug>.txt`, where NNN is the order they ran and the slug is the command with spaces turned into `-`. The address keeps its case, `*` becomes `all` and `?` becomes `help`: `show port 1-7-*` is `004_show-port-1-7-all.txt`.
- **`raw/index.jsonl`:** one line per command, in the order they ran. `ok` is true once the prompt came back, so the output is complete. `at` is null in a hand capture, which has no per-command times.
  ```json
  {"n": 7, "cmd": "show och 1-7-5", "at": "2026-10-31T14:52:10Z", "source": "snapshot", "file": "007_show-och-1-7-5.txt", "ok": true}
  ```
  `source` is `prereq`, `snapshot`, `typed` or `hand`. The sync works out which command of the [CLI index](../reference/cli-data-schemas.md) each line ran: `show och 1-7-5` is `show och <name>`, `show och` (a list without its key) is the same command, and `-l 200` is an option. Typos and commands the index lacks match nothing.
- **Errors and empty output still count.** `Invalid name: alarms` shows the box doesn't have that command (`onBox: no`), and empty output is data.

### `meta.json`

Filled in by the recorder from the prerequisites and the identity commands:

```json
{
  "run": "20261031-145210-connect",
  "box": "box3",
  "host": "10.111.25.12",
  "hostname": "PAHO-GS2000-03",
  "release": "CSP-2.10.100.10_20261013",
  "trigger": "connect",
  "started": "2026-10-31T10:52:10-04:00",
  "ended": "2026-10-31T10:52:41-04:00",
  "boxClock": "2021-07-25T19:31:02+00:00",
  "boxClockOffsetSec": -166216868,
  "prereqs": [{ "cmd": "set cli length 0", "ok": true }, { "cmd": "set cli width 1024", "ok": true }],
  "state": "unknown",
  "notes": ""
}
```

- `boxClockOffsetSec` is the box clock minus the Mac clock. It lines alarm timestamps up with the pull times.
- `state` stays `unknown` until a run is labelled (`healthy`, `fault`, `restored`).

### Run 1

Run 1 came from `script` over ssh, with Tab completion, backspaces and typos in it (`show cas  haschassis       assis`, `physicall^H ^H-channel`). Its only control characters are backspaces and bells. `scripts/split-session-log.mjs` replays the backspaces on each prompt line, so each command reads as the box saw it, splits the log at the prompt lines and writes the layout above (`source: "hand"`). The original `session.log` stays next to the files.

```sh
node scripts/split-session-log.mjs data/boxes/box3/runs/run-01-healthy
npm run sync:cli-data:csp
```

Run 1 ran `date-time`, which prints the box clock (`2021-07-26T18:16:06 UTC`). With no per-command times, its offset is taken against the session start and may be up to 489 s too high. The sync reads `raw/index.jsonl` and nothing else from the run, so it no longer counts `session.log` as a capture of every command. Without the IIVI source on the machine, it keeps the committed `cli-index.source.json` and rebuilds only the observed and merged artifacts.

## Capture list

The commands are the real ones from run 1. **Snapshot** commands run in every snapshot; the others are also polled.

| Group | Command | When |
| --- | --- | --- |
| Prerequisites | `configure`, `set cli length 0`, `set cli width 1024`, `exit` | login |
| Identity | `show system`, `show software`, `date-time` (the box clock) | snapshot |
| Help tree | `help`, `help show`, `show cli` | snapshot |
| Inventory | `show chassis`, `show card`, `show inventory`, `show card 1-* fan`, `show card 1-* psu` | snapshot |
| Port state | `show port`, `show port 1-7-*` | snapshot |
| Path config | `show assignment`, `show cross-connection` | snapshot |
| Neighbors | `show lldp neighbors` | snapshot |
| Lists | `show transceiver`, `show och`, `show eth` (ids only; values come from the per-port commands) | snapshot |
| Client optics | `show transceiver 1-7-4`, `show transceiver 1-7-4 physical-channel 1` to `4` | every 10 s |
| Client | `show eth 1-7-4` | every 30 s |
| Line optics | `show transceiver 1-7-5`, `show och 1-7-5` | every 10 s |
| Alarms | `show alarm` (its changes trigger snapshots) | every 10 s |
| Alarm history | `show log alarm -l 20` (`-l 200` in snapshots) | every 30 s |
| Events | `show log event -l 200` | snapshot |

- The per-port commands are hard-coded to 1-7-4 and 1-7-5 for box 3. Later the poller takes the in-service ports from `show port` and `show assignment`.
- Not on this release, from run 1: `show alarms`, `show alarm history` (use `show log alarm`), and `show pm threshold` (`invalid command`). `show pm` and `show pm history` print `None`.
- `date-time` is an rpc (`rpc date-time` in the index). With no arguments it only prints the clock. It is in the list by name, but the recorder never re-runs it, or any rpc, from typed commands.

## Templates

Nine TTP templates, with run 1 as their fixtures: transceiver, transceiver physical-channel (a lane), och, eth, port, assignment, cross-connection, alarm and log alarm. They are in `data/boxes/box3/ttp/templates/`, each named after its command's id, and `npm test` checks each against its fixture. The [guide](../guide.md#poller) gives the result shapes.

| Template | Fixture | Reads |
| --- | --- | --- |
| `show transceiver <name>` | `show transceiver 1-7-4` | `[config]`, `[state]`, stats |
| `show transceiver <name> physical-channel <index>` | `show transceiver 1-7-4 physical-channel 1` | `[state]`, stats |
| `show och <name>` | `show och 1-7-5` | `[config]`, `[state]`, optical and DSP stats |
| `show eth <index>` | `show eth 1-7-4` | `[config]`, `[state]` counters, stats |
| `show port` | `show port` | `[state]` table: 30 ports |
| `show assignment` | `show assignment` | 16 rows, with end-z on the 2 that cross |
| `show cross-connection` | `show cross-connection` | `[config]` table: CC5_4, CC_1 |
| `show alarm` | `show alarm` | 11 alarms, by id |
| `show log alarm -l <n>` | `show log alarm -l 200` | 200 events (98 CREATE, 102 CLEAR) |

- **Two shapes cover the whole CLI:** `[config]`/`[state]` blocks of `key value unit` lines with `instant | avg | min | max unit` statistics rows, and column tables under a `-----` line. The first is one shared part, `_detail.ttp`, which the four detail templates extend; `bridge/parse.py` runs TTP from the template's folder so it finds it. A table template is one row line, or two where a column can be empty.
- **TTP 0.10.1 limits:** `_headers_` fails on hyphenated column names (`source-entity`), and a `|` inside `re("…")` splits the argument, so the regexes write it as `\x7c`. An indent in a template line is matched literally, so the wrapped alarm text uses ` *` in its regex.
- **Detail forms only:** `show och`, `show transceiver` and `show eth` without an address print wide tables. Their templates read the one-entity form and give empty sections for the list.
- **Wrapped cells:** an alarm's text and an LLDP management address wrap onto a continuation line, which the templates join or skip.
- **Wide tables:** `show och` has two-line headers. Take the ids from it and the values from `show och <id>`.
- **Alarms don't wait for a fault run.** Run 1 has 11 standing alarms, and its `show log alarm` has the CREATE and CLEAR pairs of an old pull (2021-07-25 19:23–19:28: `IN_LOS` on both amplifiers, `LOF` on flexgo-1-7-5, `LINK_RF` on 100ge 1-7-4).
- **No thresholds yet:** `show pm threshold` is invalid, so the fibers can't be coloured by threshold yet.

## Iter 3, step 1: measured light on hover

Hovering a fiber shows what the box measures at its ends. These are run 1's values:

| Strand | Hover |
| --- | --- |
| F01 BERT → 1-7-4 | Rx 7.79 dBm (lane 1: 2.31 dBm) |
| F02 1-7-4 → BERT | Tx 7.67 dBm (lane 1: 2.05 dBm) |
| F03 1-7-5 → 1-1-ad1 | Tx −2.97 dBm (target −3.00), 193.5 THz |
| F04 1-1-ad1 → 1-7-5 | Rx −7.4 dBm, OSNR 29.7 dB, Q-margin 3.4 dB, pre-FEC BER 1.2E-03, post-FEC BER 0 |
| F05 1-1-line loop | Nothing yet: L0 |

- A Tx value goes on the strand that leaves the port, and an Rx value on the strand that arrives. OSNR, Q-margin, BER, CD and PMD are measured at the end of the path, so they go on the arriving strand.
- Box 3 is drawn in `examples/box3.olst.json` with its real CLI addresses and the strands F01 to F05.
- The bridge serves `/bridge/state` from the poller while connected, and from the latest run's `parsed/` files while not, in the same shape. The hovers then work from run 1 with no box connected.
- The app keeps it in the store by CLI address and refreshes it every 10 s. `Pipe` already takes a `tip`, which shows the numbers.
- Colours (more power, a bigger red highlight over the yellow line) come once there are thresholds.

## Order

1. **Done (2026-10-31).** Split run 1 into the recorder's layout (50 commands), write its `meta.json`, `setup.md` and `wiring.csv`, make the sync read `raw/index.jsonl`, and run `npm run sync:cli-data:csp` again (28 index commands observed).
2. **Done (2026-10-31).** The nine templates and their fixtures from run 1, with `npm test` passing (38 tests). The merged index still says `no-template` for them, because its parse status comes from a run's `parsed/` files: the recorder writes those, and run 1 gets its own in step 3.
3. **Done (2026-10-31).** The recorder, parts 1 to 4 (`bridge/recorder.mjs`), and `poll.json` from the capture list. A command's template is found by its id, so `poll.json` has no template names. Run 1 got its `parsed/` (`node bridge/recorder.mjs data/boxes/box3/runs/run-01-healthy`), so the merged index shows the nine as parse-ok and poll-eligible. It was tested against a fake ssh box that replays run 1: the connect snapshot (4 prerequisites and 31 commands, meta.json complete), an `alarms` run when one alarm went away (11 to 10), and a new `connect` run after the box dropped and the bridge reconnected. It hasn't run on box 3 yet.
4. The hovers.
5. Typed commands (part 5) and marking a pulled fiber (part 6).

## Decided

- **Raw captures** carry serials, hostnames and IPs. They are committed as they are for now and cleaned up later (2026-10-31).
- **Prerequisites** may change the box's CLI settings. The recorder runs them on every login and records their results (2026-10-31).

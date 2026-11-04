# OLS Tracer decisions

The decisions that shape the tracer, newest first, each with where it was argued. A decision that was later replaced says what replaced it. Plans are in the [roadmap](roadmap.md).

## 2026-11-04

| Decision | Why | Source |
| --- | --- | --- |
| The catalog's L0 data is put to use, read-only: the light path through L0 cards, threshold colours, a card's insides, range checks. Still no L0 modelling and GNPy stays parked: a number shown is the box's, or the difference of two of the box's | Gain sums miss by about 1 dB at low input, and the WSS step needs the media channels, so a predicted power would be wrong | [Plan 2026-11-01](plans/plan-2026-11-01.md#13-the-l0-catalog-in-use) |
| F03 and F04 run on AD11, not AD1 | The fibers moved on the box: runs of 2026-11-03 read light on AD11 and -99.99 on AD1 | [Box 3 setup](../data/boxes/box3/setup.md) |
| `show media-channel` and `show ocm` join the capture (59 commands, 14 polled, with `show amplifier` now polled too). `show media-channel` is read raw by column name, with no TTP template, until a run has its real output; the active port falls back to the ports showing power | No run has its output, so a template would be a guess that fails silently. A media channel is what opens the WSS, and it holds the frequency and attenuation | [Plan 2026-11-01](plans/plan-2026-11-01.md#13-the-l0-catalog-in-use) |
| The box's own logs are the record of what happened: `history.jsonl` per box, kept from every run's `show log alarm` and `show log configuration`, and cut into episodes that the logs label themselves (a config change, a reboot, a card out). Only an outage nothing explains needs a person's label | On 2026-11-02 the media-channel sweep, the client flaps and two card reboots happened while nothing was connected, and only the logs had them. Runs get deleted for size | [Plan 2026-11-01](plans/plan-2026-11-01.md#14-box-history-and-fast-runs) |
| A snapshot on an alarm change or a pull runs only what changes (19 commands, `fast` in `poll.json`); the full 57 only when the session opens. Threshold warnings and `REACH_MAX_ATT_*` don't start one. A poll that reads as before isn't written | A full snapshot took 60–90 s and 1.4 MB, while the box changed every 30 s; AD11 toggles its warning on its own | [Plan 2026-11-01](plans/plan-2026-11-01.md#14-box-history-and-fast-runs) |
| A run goes to the box `show system` names, not the one the bridge was started for | A box 4 run landed in box 3's runs | [Plan 2026-11-01](plans/plan-2026-11-01.md#14-box-history-and-fast-runs) |
| The poller reads `show optical-port` for every port, not one add/drop port | The fibers moved from AD1 to AD11 and the poll went on reading AD1's -99.99 | [Plan 2026-11-01](plans/plan-2026-11-01.md#14-box-history-and-fast-runs) |
| A reading between a threshold's clear and declare levels takes the box's own alarm state. Limits come from the box's alarm thresholds, else the catalog, else the box's 15-minute TCAs, which are at most a warning | AD1 at 2.81 and AD11 at 2.61 kept an alarm declared at 3, because it clears at 2.5 | [Plan 2026-11-01](plans/plan-2026-11-01.md#11-threshold-colours) |

## 2026-11-01

| Decision | Why | Source |
| --- | --- | --- |
| A pull marked in the UI takes a snapshot of its own (`…-pull`) with its `answer.json`, instead of writing into the run the alarm change created. The strands to mark come from the box's `wiring.csv`, not the canvas | F02 changes no alarm and would have no run to score, a mark before the next poll would land in the run before the pull, and F01, F02 and F05 are not drawn on the canvas | [Plan 2026-11-01](plans/plan-2026-11-01.md#9-recorder-parts-5-and-6) |
| Typed commands are re-run only at the operational prompt (`admin@…>`), and never with `?` or a `|` pipe | Configure mode's `show` prints the config tree, not the state the poller's shell sees, and a pipe could save to a file | [Box 3 capture](plans/box3-capture.md#the-recorder) |
| The work left in Goal 2.5, Goal 1 and Iter 3 is done in one order, the 2026-11-01 plan, top to bottom | One list both machines follow | [Plan 2026-11-01](plans/plan-2026-11-01.md#order) |
| Two machines: the work machine runs box 3 and commits only `data/boxes/box3/runs/**`, `setup.md` and `wiring.csv`; this Mac builds every step that doesn't need the box. Both on `main`, `git pull --rebase` before each push | Work in parallel without conflicts | [Plan 2026-11-01](plans/plan-2026-11-01.md#two-machines) |
| L0's `show` commands are captured read-only (`show optical-port`, `amplifier`, `osc`, `external-connection`, `internal-connection`), and `show optical-port 1-1-ad1` and `1-1-line` are polled. Nothing in L0 is modelled and GNPy stays parked. Narrows 2026-10-30's "no L0" to "no L0 modelling" | F03–F05 get both ends measured, and `show external-connection` may hold the box's own fiber map | [Plan 2026-11-01](plans/plan-2026-11-01.md#6-light-on-the-wires) |
| The L0 cards' profile data comes into the catalog (step 1b): internal light path, amplifiers, port limits and thresholds, channel plan, amplifier port roles. It is built on the work machine, which has the IIVI profiles. Reopens 2026-10-30's "no L0" for catalog data; still no modelling | The L0 cards are only port lists today, and the light path through the C1125 joins F03, F05 and F04 | [Plan 2026-11-01](plans/plan-2026-11-01.md#1b-catalog-two-gaps-and-the-l0-profile) |
| The connect snapshot takes every command discovery and the wires need (57 commands, 12 polled), including dark and empty entities (`show och 1-7-1`, `show transceiver 1-8-1`) | Templates need fixtures for every shape, and a dark port's output before any pull | [Box 3 capture](plans/box3-capture.md#capture-list) |

## 2026-10-31

| Decision | Why | Source |
| --- | --- | --- |
| Internal documents (vendor PDFs, private notes) live only in `docs/internal/`, which is git-ignored. A CLI reference PDF that was committed to `catalog/common/` was removed from the whole history | They must never reach GitHub | |
| The bridge records every run itself, from the SSH session the UI already opens. Run 1's hand-made `session.log` is the last hand capture | Users can't be asked for `script` logs, and the Goal 2.5 experiments need runs nobody types | [Box 3 capture](plans/box3-capture.md#the-recorder) |
| Terminal output is never saved. The recorder re-runs typed `show` commands on the poller's clean shell, and never `set`, `delete`, `clear`, `commit` or `rpc` | The terminal shell has Tab completion, backspaces and panel-width wrapping | [Box 3 capture](plans/box3-capture.md#the-recorder) |
| The prerequisites (`set cli length 0`, `set cli width 1024`) run on every login and their results are recorded, even though box 3 may save them to its config | Paging would cut the output | [Box 3 capture](plans/box3-capture.md#decided) |
| Raw captures, with their serials, hostnames and IPs, are committed as they are for now and cleaned up later | Answers the CLI plan's open question 1 | [Box 3 capture](plans/box3-capture.md#decided) |
| `cli-observed.json` and `cli-index.merged.json` are git-ignored and rebuilt by `npm run sync:cli-data:csp`. `branch` and `index` stay committed | Nothing reads the derived two (the recorder reads the index), they rebuild byte for byte apart from `generatedAt`, and committing them rewrote 1.5 MB per sync. The IIVI XML behind the index is not on every machine | [CLI data schemas](reference/cli-data-schemas.md#artifacts) |

## 2026-10-30

| Decision | Why | Source |
| --- | --- | --- |
| Live sync parses the CLI's text with TTP (Python). Not a JSON mode in the C++ CLI, and not gNMI | TTP is the only option that needs nothing from the product: the CLI exists today. Polling every 10–30 s is live enough, and fixture tests catch templates that a CLI change breaks. If the product ever ships gNMI, `gnmic` replaces the poller in the bridge and the UI stays the same | [Roadmap](roadmap.md#ideas-backlog) |
| Iter 3 shows **measured** light first. No GNPy and no L0 for now | The CLI capture, TTP parsing and box 3 come first | [Roadmap](roadmap.md#iter-3-run-the-light) |
| The poller runs on its own shell of the same SSH session | So it never types into the terminal | [Guide](guide.md#poller) |

## 2026-10-29

| Decision | Why | Source |
| --- | --- | --- |
| The hardware catalogs are generated from the IIVI profiles, one per stream (`csp`, `ctc`, `polaris`, `tencent`, `ws`). A stream's own files are its whole catalog, and `common/` keeps only `cli.json`. Replaces the MVP's hand-written dummy streams | The real inventory per corporation | [Guide](guide.md#catalog) |
| Ports take their role from the profile (line, client, add/drop, COM, OSC, monitor, port), and a `behavior` drives the views and rules. Replaces the MVP's client/line only | The real cards have more port kinds | [Guide](guide.md#catalog) |
| The command source of truth is the IIVI CLI XML (`cli_shortcut_cmds_*.xml`). PDF docs are references only | | [CLI plan](archive/cli-run-plan.md#step-1-build-a-cli-index-from-source-xml-and-captures-under-data) |
| `data/` holds the raw captures, TTP templates and generated CLI index. CSP first | | [CLI plan](archive/cli-run-plan.md#decisions-2026-10-29) |
| The terminal is a real xterm.js terminal on the box's shell. It replaced one-line commands that waited for a `BOX_PROMPT` regex | Tab, history and Engineering mode did not work through them | [CLI plan](archive/cli-run-plan.md#step-2-run-on-one-box-built) |
| The CLI server is our own C++ codebase. Login is SSH first, with a password or a key; RADIUS, TACACS+ and AAA come later. Run may send any command, config included. One box first | | [CLI plan](archive/cli-run-plan.md#decisions-2026-10-29) |
| **MVP:** a web app (React, TypeScript, Vite) with Packet Tracer's interaction model; the stream is picked per project; rules are allowed lists only; generic SVG graphics; L0, L1 and Data are cosmetic views; a local `.olst.json` plus autosave, no backend | People in the industry already know Packet Tracer | [MVP plan](archive/mvp-plan.md#decisions-so-far) |
| **MVP, replaced:** a fiber was one duplex cable, auto-crossed. Now a link is one strand, `a` Tx → `b` Rx, and a duplex pair is two links | | [Guide](guide.md#choices-the-plan-left-open) |

## Open

1. **Confidentiality:** every stream's catalog ships in one bundle. If a user may see only their own corporation's stream, that needs per-stream builds or a backend. ([MVP plan](archive/mvp-plan.md#risks))
2. Should config commands ask for a confirm before **Run** sends them? ([CLI plan](archive/cli-run-plan.md#open-questions))
3. Should the merged index carry one `pollCandidate` per command, or should poll selection live in a separate file? ([CLI plan](archive/cli-run-plan.md#open-questions))
4. Does the login land in the CLI, or does it need `cliclient -n` in `BOX_INIT`? `bridge/.env.example` says IIVI boxes need it; confirm on box 3.
5. Amps, mux/demux and ROADMs: cards in a chassis, standalone devices on the canvas, or both? ([MVP plan](archive/mvp-plan.md#open-questions))
6. Should a fiber carry a length (km) before physics uses it? ([MVP plan](archive/mvp-plan.md#open-questions))
7. Who is it for: internal engineers, customers or training? That decides the polish and the hosting. ([MVP plan](archive/mvp-plan.md#open-questions))

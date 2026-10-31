# OLS Tracer decisions

The decisions that shape the tracer, newest first, each with where it was argued. A decision that was later replaced says what replaced it. Plans are in the [roadmap](roadmap.md).

## 2026-10-31

| Decision | Why | Source |
| --- | --- | --- |
| Internal documents (vendor PDFs, private notes) live only in `docs/internal/`, which is git-ignored. A CLI reference PDF that was committed to `catalog/common/` was removed from the whole history | They must never reach GitHub | |
| The bridge records every run itself, from the SSH session the UI already opens. Run 1's hand-made `session.log` is the last hand capture | Users can't be asked for `script` logs, and the Goal 2.5 experiments need runs nobody types | [Box 3 capture](plans/box3-capture.md#the-recorder) |
| Terminal output is never saved. The recorder re-runs typed `show` commands on the poller's clean shell, and never `set`, `delete`, `clear`, `commit` or `rpc` | The terminal shell has Tab completion, backspaces and panel-width wrapping | [Box 3 capture](plans/box3-capture.md#the-recorder) |
| The prerequisites (`set cli length 0`, `set cli width 1024`) run on every login and their results are recorded, even though box 3 may save them to its config | Paging would cut the output | [Box 3 capture](plans/box3-capture.md#decided) |
| Raw captures, with their serials, hostnames and IPs, are committed as they are for now and cleaned up later | Answers the CLI plan's open question 1 | [Box 3 capture](plans/box3-capture.md#decided) |

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

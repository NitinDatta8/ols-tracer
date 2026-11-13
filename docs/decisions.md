# OLS Tracer decisions

The decisions in force, by topic, each with its date and why. The full log, with the replaced decisions and where each was argued, is in the [archive](archive/decisions-log.md).

## Product

- **Packet Tracer's interaction model,** as a React + TypeScript + Vite web app: the stream is picked per project, rules are allowed lists, graphics are generic SVG, the L0, L1 and Data views are cosmetic, and a topology is a local `.olst.json` plus autosave, with no backend. People in the industry already know Packet Tracer. (2026-10-29)
- **A link is one strand,** `a` Tx → `b` Rx, and a duplex pair is two links. It replaced the MVP's auto-crossed duplex cable. (2026-10-29)
- **A pet project:** it lives in this repo and changes nothing in the product.
- **The lab page is the fixed Horsham lab,** one file in the repo (`catalog/csp/lab.olst.json`) that the bridge serves and saves and a commit shares, in place of New, Open and Save. Adding, removing or moving a chassis or rack needs it unlocked; cards and pluggables stay free. The lock is a check in the browser that keeps only the password's hash, not security. A lab set up once by hand is the same for everyone. Being built: [procedures plan](procedures-plan.md#6-lab-file-and-lock). (2026-11-12)

## Catalog

- **Generated from the IIVI profiles,** one catalog per stream (`csp`, `ctc`, `polaris`, `tencent`, `ws`); `common/` keeps only `cli.json`. Ports take their role from the profile, and a `behavior` drives the views and rules. (2026-10-29)
- **The IIVI CLI XML (`cli_shortcut_cmds_*.xml`) is the command source of truth;** PDFs are only references. `data/` holds the captures, the TTP templates and the generated CLI index, CSP first. `cli-observed.json` and `cli-index.merged.json` are git-ignored and rebuilt by `npm run sync:cli-data:csp`. (2026-10-29, 2026-10-31)
- **The L0 cards' profile data is in the catalog** (light path, amplifiers, port limits, thresholds, channel plan), used read-only. (2026-11-01)

## Box access

- **Only the bridge talks to boxes,** over SSH with a password or a key (AAA later). It keeps one session per box, shared by everyone connected to it (physical views, Codex sessions), and closes it when the last one leaves. Every endpoint names its box's host. One shared session had let a disconnect in one Codex session drop another box. (2026-10-29, 2026-11-10)
- **The terminal is a real xterm.js on the box's shell,** so Tab, history and the box's modes work. **Run** may send any command, config included. (2026-10-29)
- **Live state is the CLI's text, parsed with TTP** (Python) and polled every 10–30 s: it needs nothing from the product. Not a JSON mode, not gNMI; if the product ships gNMI, `gnmic` replaces the poller and the UI stays the same. (2026-10-30)
- **The poller has shells of its own** in the session, so it never types into the terminal: 1 to 8 (`BOX_WORKERS`, default 1, since a box's limit on CLI sessions is only known on the box). A command is done when its prompt is quiet for 100 ms. Paging is turned off on every login (`set cli length 0`, `set cli width 1024`), and that is recorded. (2026-10-30, 2026-10-31, 2026-11-06)
- **Box changes go through procedures, tiered by risk:** a read procedure runs from the MCP; a reversible lab action runs from the MCP with an approval on every call, and restores itself; an upgrade, reboot or provisioning is queued by the MCP and runs once a person clicks **Approve** in the tracer UI. Commit and Rollback are each their own Approve, after a soak. The boxes' logs show these done by hand again and again, and a change done wrong takes a box down. Being built: [procedures plan](procedures-plan.md); until then the MCP sends only `show`. (2026-11-12)
- **A procedure's step lines are the source of truth for rpc lines.** The CLI index lists most rpcs without their arguments (`rpc reboot`), so the lines come from the box logs, and the MCP's `check()` takes an rpc line only when it matches one. Taking any words after a known rpc would let made-up commands through. (2026-11-12)
- **Software loads come from one load server,** named in `bridge/.env` with its login, and the UI lists them per stream. (2026-11-12)

## Recording

- **The bridge records every run itself;** nobody captures by hand. (2026-10-31)
- **Terminal output is never saved.** A `show` typed at the operational prompt runs again on the poller's clean shell, never with `?` or `|`; `set`, `delete`, `clear`, `commit` and `rpc` never run again. (2026-10-31, 2026-11-01)
- **A full snapshot on connect, a fast one on a change.** Connect runs every command, dark and empty entities included. An alarm change or a pull runs only the polled and `fast` commands: a full snapshot took 60–90 s and 1.4 MB. Threshold warnings and `REACH_MAX_ATT_*` don't count as a change, a poll is written only when it reads differently, and `show card` and `show inventory` are polled every 60 s. (2026-11-01, 2026-11-04)
- **A run goes to the box `show system` names,** not the one the bridge was started for. (2026-11-04)
- **A marked pull takes its own snapshot,** with its `answer.json`, for a strand from the box's `wiring.csv`. A missing `wiring.csv` is generated from the box's tables, strongest evidence first: connections, an OCH inside a media channel, then power. (2026-11-01, 2026-11-06)
- **The box's own logs are the record of what happened:** one `history.jsonl` per box, cut into episodes the logs label themselves. Only an outage nothing explains needs a person. (2026-11-04)
- **Raw captures are committed as they are,** serials, hostnames and IPs included, to be cleaned up later. (2026-10-31)

## Light

- **Measured, never modelled:** a number shown is the box's, or the difference of two of the box's. No L0 modelling, and GNPy is parked: gain sums miss by about 1 dB. (2026-10-30, 2026-11-04)
- **Thresholds** come from the box's alarm thresholds, else the catalog, else the box's 15-minute TCAs, which are at most a warning. Between a threshold's clear and declare levels, the box's own alarm decides. (2026-11-04)

## MCP

- **The intelligence layer is an MCP server in its own repo,** `ols-mcp`. It takes OLS Tracer's code from a pinned git dependency and its data only over the bridge's HTTP API. It sends only catalog `show` commands to a box, and writes fixes out without running them. (2026-11-07)
- **Local first, built as a remote one:** Streamable HTTP, a token on every call, an audit log, no stdio. A remote server needs IT approval, and this way the move is config. (2026-11-07)
- **Codex is the client.** Tools that only read carry `readOnlyHint`, and `default_tools_approval_mode = "auto"`, so allowing `run_show` once covers the session. Each `run_show` is saved in the box's latest run (`source: "mcp"`, with the session). (2026-11-07, 2026-11-10)
- **Tools return facts; the agent reasons.** False alarms are tagged (`baseline`, `unused`, `off-path`, `housekeeping`), never deleted. The answer is short: the fault, the root alarm when it helps, and the fix, as CLI lines checked against the catalog or as a slot, port and Tx or Rx. (2026-11-07)
- **A baseline is captured only after a person says the box is healthy,** never automatically, and a setup change marks it stale. A baseline taken during a fault would hide that fault. (2026-11-07)

## Repo

- **Internal documents** (vendor PDFs, private notes) stay in `docs/internal/`, which is git-ignored, as is `*.pdf`. (2026-10-31)
- **Two machines on one `main`:** the work machine runs the box and has the IIVI profiles, so it commits the box's runs and the catalog syncs; the dev machine builds the rest. `git pull --rebase` before every push. (2026-11-01)
- **Docs:** a plan moves to `archive/` once it is built; the guide and the roadmap stay current; decisions go here with their date. (2026-10-31)

## Open

1. **Confidentiality:** every stream's catalog ships in one bundle. If a user may see only their own corporation's stream, that needs per-stream builds or a backend.
2. Should **Run** ask before it sends a config command?
3. Should the merged index carry a `pollCandidate` per command, or should poll selection live in its own file (`bridge/poll.json` today)?
4. Does the login land in the CLI, or do IIVI boxes need `cliclient -n` in `BOX_INIT`? Confirm on box 3.
5. Amps, mux/demux and ROADMs: cards in a chassis, standalone devices on the canvas, or both?
6. Should a fiber carry a length (km) before physics uses it?
7. Who is it for: internal engineers, customers or training? That decides the polish and the hosting.

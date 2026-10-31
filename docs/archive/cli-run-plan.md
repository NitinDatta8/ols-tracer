# OLS Tracer: command index, Run on a lab box and the C++ CLI

Follows the [MVP plan](mvp-plan.md). Hovering hardware in the physical view shows its command from `catalog/<stream>/cli.json` (`show chassis 1`, `show card 1-3`, `show port 1-3-C2`, pluggable `show transceiver 1-3-C2`). **Copy** copies it and **Run** runs it on the lab box.

**Status:** step 2 (Run on one box over SSH) is built. Step 1 is now the CLI extraction + capture pipeline under `data/`, and steps 3 and 4 come later.

## Decisions (2026-10-29)

| Topic | Decision |
| --- | --- |
| CLI server | Our own C++ codebase. We may integrate deeply with it later (step 3) |
| Login | SSH first, with a password or a key. RADIUS, TACACS+ and AAA come later (step 4) |
| Commands | Run may send any command, config included |
| Boxes | One box for now; get it right on one box first. More boxes come later, which turns this into network management |
| Capture and generated data location | `data/` is the source of truth for raw captures, TTP templates and generated CLI index artifacts |

## Step 1: build a CLI index from source XML and captures (under `data/`)

Use the IIVI CLI XML as the command source of truth. PDF docs are optional references, not the primary source.

- Parse all stream files matching `cli_shortcut_cmds_*.xml` (not only `eqpt` and `l1`).
- Extract full branch trees (top-level `<cmd-node>` roots with all descendants).
- Generate stream-wide command indexes and per-box observed overlays.
- Keep raw run captures prompt-preserving and unedited, with paging off and wide terminal.
- Keep generated TTP templates and parser outputs in `data/` too.

### Data layout (current working plan)

```text
data/
  cli/
    <stream>/
      branches/
        <source-file>__<root-name>.json
      cli-index.source.json
  boxes/
    <box-id>/
      runs/
        run-01-healthy/
          meta.json
          raw/session.log
          parsed/
            <command-id>.json
      cli-observed.json
      cli-index.merged.json
      ttp/
        templates/
          <template-id>.ttp
        fixtures/
          <template-id>.txt
          <template-id>.json
```

### Output model

- **Branch** (`branches/*.json`): one top-level XML branch with full tree and node metadata (`cmd-type`, `type`, `key-pattern`, `helper-info`, etc.).
- **Index** (`cli-index.source.json`): flattened stream command catalog built from all branches.
- **Observed** (`boxes/<box-id>/cli-observed.json`): what is actually present/captured on a specific box and run set.
- **Merged** (`boxes/<box-id>/cli-index.merged.json`): index + observed overlay, used to choose poll commands and template priorities.
- **Schema reference:** exact JSON schemas are in [CLI data schemas](../reference/cli-data-schemas.md).

### CSP-only first implementation

- Start with stream `csp` only.
- Run `npm run sync:cli-data:csp` to generate `branch`, `index`, `observed` and `merged` outputs under `data/`.
- Keep extending this pipeline in place until CSP is stable, then fan out to other streams.

### UI compatibility path

- Keep `catalog/<stream>/cli.json` for hover/run compatibility.
- Derive this simple map from `cli-index.merged.json` (first preferred command per level).
- Extend inspector command lists from merged data once stable.

## Step 2: Run on one box (built)

A browser cannot open SSH, so a small bridge sits between them:

```
Browser ──HTTP (/bridge, proxied by Vite)──> CLI bridge (Node + ssh2) ──one SSH session, kept open──> lab box
```

- `npm run bridge` starts `bridge/server.mjs`, which reads `bridge/.env` (see `bridge/.env.example`): port, user, and a password or a key file. Credentials stay on that machine, never in the browser or a `.olst.json`.
- **The box's IP comes from the physical view:** type it in the header and click Connect (the device keeps it). Closing the view, or the page, disconnects.
- **One session, kept open:** it opens an interactive shell, because the box's CLI is prompt-driven. It sends a keepalive every 15 s and reconnects with backoff (1 s up to 30 s) whenever the session drops. `BOX_INIT` types commands once after login, for example `cliclient -n` to start the CLI.
- **A real terminal:** the view's terminal (xterm.js) attaches to the shell over a WebSocket (`/term`) and passes raw keystrokes and output both ways, with the terminal's size as the pty's. The box's own Tab completion, history, Ctrl-C, paging and modes work as over ssh, and the bridge needs no prompt matching. A terminal that attaches gets the session's last 256 KB first. (This replaced queued one-line commands that waited for a `BOX_PROMPT` regex: Tab, history and Engineering mode did not work through it.)
- **Safety:** the bridge listens on localhost only and answers only the app: requests need an `x-ols-tracer` header (so other web pages cannot call it) and a localhost `Host` (so DNS rebinding cannot). It takes one command on one line, so a newline cannot slip in a second command. It logs every command with a timestamp. Config commands are allowed, per the decision above.
- **CLI modes:** Normal (`>`) → `configure` → Configure (`#`) → `^^^` (Shift+6 three times) → Engineering → `bash` → Bash → `kgdb` → kgdb, and `exit` goes back one. The box's own prompt shows the mode.
- **UI:** Run sits next to Copy, under the terminal and in the inspector, and types the command into the terminal. Its dot is green when the box is connected, orange while connecting and grey when down.
- **Tested** against a fake SSH box running a real bash: Tab completion, double Tab, ↑ history, Ctrl-C, Esc staying in the terminal, Run, resize, and a reconnect after the box drops.

## Step 3: deeper integration with the C++ CLI (later)

- **Generate from the full XML command tree.** Replace the shallow sync with full extraction from `../IIVI_Platform/profile/cu/cli/<stream>/cli_shortcut_cmds_*.xml` into `data/cli/<stream>/...`, then derive `catalog/<stream>/cli.json` from merged results.
- **Structured output.** A JSON output mode in the C++ CLI, or an API (gRPC, NETCONF/YANG), would let the tracer read the box's real state: cards in slots, pluggables and alarms. The tracer could then draw the physical view from the box and show live alarms instead of simulated ones.
- The bridge stays the only thing that talks to boxes, so swapping SSH for an API changes only the bridge.

## Step 4: AAA, MACsec and more boxes (later)

- **RADIUS and TACACS+ (AAA)** do three jobs. The box asks a central server whether a login is allowed (authentication) and what that user may run (authorization; TACACS+ can check every single command). It also records what the user did (accounting). For the bridge, this is still an SSH login: it sends the user and password, and the box checks them with the server. The bridge already answers keyboard-interactive prompts, which is how these logins usually arrive. The change comes when each person logs in as themselves: the bridge then needs one session per user, and the box may refuse some commands.
- **MACsec is not a login method.** It encrypts Ethernet links port to port (IEEE 802.1AE). In the tracer it belongs on client ports and fibers: on/off, key status, alarms, and its CLI commands. It does not belong in the bridge.
- **More boxes:** each device on the canvas gets a `box` name, and the bridge keeps one session per box, listed in a boxes file. Each device shows its own connection status.

## Open questions

1. Should `data/` be fully committed, or should only redacted/stable subsets be committed while raw captures stay local?
2. Should merged indexes carry one `pollCandidate` per command now, or should poll selection live in a separate generated file?
3. Does the login land in the CLI, or does it need a command such as `cliclient -n`? That sets `BOX_INIT`.
4. Should config commands ask for confirmation before Run sends them?

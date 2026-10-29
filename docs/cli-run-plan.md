# OLS Tracer: command book, Run on a lab box and the C++ CLI

Follows the [MVP plan](mvp-plan.md). Hovering hardware in the physical view shows its command from `catalog/<stream>/cli.json` (`show chassis 1`, `show card 1-3`, `show port 1-3-C2`, pluggable `show transceiver 1-3-C2`). **Copy** copies it and **Run** runs it on the lab box.

**Status:** step 2 (Run on one box over SSH) is built. Step 1 is waiting for the command book, and steps 3 and 4 come later.

## Decisions (2026-10-29)

| Topic | Decision |
| --- | --- |
| CLI server | Our own C++ codebase. We may integrate deeply with it later (step 3) |
| Login | SSH first, with a password or a key. RADIUS, TACACS+ and AAA come later (step 4) |
| Commands | Run may send any command, config included |
| Boxes | One box for now; get it right on one box first. More boxes come later, which turns this into network management |

## Step 1: the command book in the catalog (waiting for the book in `docs/internal/`)

- Turn the command book into `cli.json`. Each level becomes a list, and the first command is the one shown on hover:
  ```json
  { "card": ["show card {chassis}-{slot}", "show card {chassis}-{slot} detail", "show alarms card {chassis}-{slot}"] }
  ```
- If the book has commands for only one card type, that linecard gets its own `cli`, which overrides the level.
- The inspector lists every command for the selected hardware, each with Copy and Run.
- A test checks that every template fills in and that every command is in the book.

## Step 2: Run on one box (built)

A browser cannot open SSH, so a small bridge sits between them:

```
Browser ──HTTP (/bridge, proxied by Vite)──> CLI bridge (Node + ssh2) ──one SSH session, kept open──> lab box
```

- `npm run bridge` starts `bridge/server.mjs`, which reads `bridge/.env` (see `bridge/.env.example`): port, user, and a password or a key file. Credentials stay on that machine, never in the browser or a `.olst.json`.
- **The box's IP comes from the physical view:** type it in the header and click Connect (the device keeps it). Closing the view, or the page, disconnects.
- **One session, kept open:** it opens an interactive shell, because the box's CLI is prompt-driven. It sends a keepalive every 15 s and reconnects with backoff (1 s up to 30 s) whenever the session drops. `BOX_INIT` runs commands once after login, for example to turn paging off.
- **One command at a time:** commands are queued. A command's output ends when the box's prompt comes back (`BOX_PROMPT`, a regex). If there is no prompt within `BOX_TIMEOUT`, the bridge sends Ctrl-C and waits for the prompt again, so nothing spills into the next command. If the prompt still does not come, the bridge reopens the session.
- **Safety:** the bridge listens on localhost only and answers only the app: requests need an `x-ols-tracer` header (so other web pages cannot call it) and a localhost `Host` (so DNS rebinding cannot). It takes one command on one line, so a newline cannot slip in a second command. It logs every command with a timestamp. Config commands are allowed, per the decision above.
- **CLI modes:** Normal (`>`) → `configure` → Configure (`#`) → `^^^` → Engineering → `bash` → Bash → `kgdb` → kgdb, and `exit` goes back one. The app follows the mode from the commands it sends, shows it on a badge in the CLI strip, and describes each new mode at the end of the command's output. The modes are listed in `cli.json`.
- **UI:** Run sits next to Copy, in the CLI strip and in the inspector. Its dot is green when the box is connected, orange while connecting and grey when down. Output streams into the inspector, so the dialog does not move.
- **Tested** against a fake SSH box: password and keyboard-interactive logins, a reconnect after the box drops, a hung command, and a command queued behind it.

## Step 3: deeper integration with the C++ CLI (later)

- **Generate the command book from the CLI profile XML.** `npm run sync:cli` reads `../IIVI_Platform/profile/cu/cli/<stream>/cli_shortcut_cmds_eqpt.xml` and `../IIVI_Platform/profile/cu/cli/<stream>/cli_shortcut_cmds_l1.xml` and rewrites `catalog/<stream>/cli.json`.
- **Structured output.** A JSON output mode in the C++ CLI, or an API (gRPC, NETCONF/YANG), would let the tracer read the box's real state: cards in slots, pluggables and alarms. The tracer could then draw the physical view from the box and show live alarms instead of simulated ones.
- The bridge stays the only thing that talks to boxes, so swapping SSH for an API changes only the bridge.

## Step 4: AAA, MACsec and more boxes (later)

- **RADIUS and TACACS+ (AAA)** do three jobs. The box asks a central server whether a login is allowed (authentication) and what that user may run (authorization; TACACS+ can check every single command). It also records what the user did (accounting). For the bridge, this is still an SSH login: it sends the user and password, and the box checks them with the server. The bridge already answers keyboard-interactive prompts, which is how these logins usually arrive. The change comes when each person logs in as themselves: the bridge then needs one session per user, and the box may refuse some commands.
- **MACsec is not a login method.** It encrypts Ethernet links port to port (IEEE 802.1AE). In the tracer it belongs on client ports and fibers: on/off, key status, alarms, and its CLI commands. It does not belong in the bridge.
- **More boxes:** each device on the canvas gets a `box` name, and the bridge keeps one session per box, listed in a boxes file. Each device shows its own connection status.

## Open questions

1. Where in the C++ codebase are CLI commands registered, and can we read that repo?
2. Does the C++ CLI have a JSON or other structured output mode?
3. What does the box's prompt look like, and what turns paging off? These set `BOX_PROMPT` and `BOX_INIT`.
4. Should config commands ask for confirmation before Run sends them?
5. What are the Engineering, Bash and kgdb prompts, and is Engineering entered by typing `^^^` and Enter? The default `BOX_PROMPT` matches a name ending in `#`, `>` or `$`, and `(kgdb)`.

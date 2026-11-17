# BERT screen plan (2026-11-11, rewritten 2026-11-13 and 2026-11-16)

How a person drives the lab's BERT from the BERT tester in the physical view: its own screen, live, in the page. Built as phase 7 of the [procedures plan](procedures-plan.md#7-bert-screen).

## Facts

- **What SmartAccess AnyWhere does underneath** (from the installer's files, 2026-11-14): a Qt app with no web engine. With an IP it opens SSH to the BERT (port 22, or 443) with its own login, the BERT answers its service ports, and each mode is a tunnel to a standard service on the BERT: Remote Screen is VNC, Web View is HTTP (opened in the browser), File Transfer is FTP, Console is telnet. The page used in the lab is Remote Screen.
- **The BERT answers VNC on its IP without SmartAccess** ([box check 7](procedures-plan.md#box-checks), 2026-11-16: from a lab PC, ports 22 and 5900 open). So the tracer shows the same screen itself, and nothing about the BERT is drawn or invented here.
- **The tracer will be hosted on a Linux machine,** and everyone who opens it sees the same lab. The bridge runs there and reaches the BERT, so nothing runs on anyone's PC.
- **The BERT has one fixed IP.**

## Design (built 2026-11-16)

- **The IP is stored once:** the BERT device's `host` in the lab file, the same for everyone, next to **← Back**, editable only while the lab is unlocked.
- **The BERT opens at its Screen** (**Ports | Screen** on its name plate, as an L0 card's **Ports | Inside**): noVNC (`@novnc/novnc`, `src/Screen.tsx`) scaled to fit, clicked and typed on as on the BERT. A VNC password, if the BERT asks for one, is asked for over the screen; **Reconnect** once it closes. **Ports** has its two ports, to put optics in and fiber. It has no CLI, so its stage takes the terminal's room.
- **The bridge relays it:** the page's WebSocket at `/bridge/vnc?host=` goes byte for byte to `BERT_VNC_PORT` (5900) on the BERT, only for a tester's IP in the lab file (`testerHosts` in `bridge/lab.mjs`), and only from the app's Origin, like `/term`. So it is no way into anything else.
- **Shared:** noVNC asks the BERT to share its screen, so everyone who has it open sees the same one, and a SmartAccess session on it stays open.
- Testers no longer poll `/status` and `/state`: their IP is their screen's, not a box to connect to.

## Dropped

- 2026-11-13: the bridge starting SmartAccess (`bridge/launcher.mjs`, `POST /tester/open`, `BERT_SAA_PATH`, `BERT_LAUNCH_MODE`, a `cmd /c start`). That worked only while the bridge ran on the person's own Windows PC.
- 2026-11-16, once check 7 found VNC open: **Copy**, **Open SmartAccess**, the `ols-bert:` link with its one-time registration on each PC, and the one-at-a-time claim on the BERT. The screen is in the page and shared.

## Tests

- The relay (`test/bridge/screens.test.mjs`): both ways, closed with either end, refused for a box's IP, an IP in no device and another Origin.
- Browser check (passed 2026-11-16, against a fake VNC server on the dev machine, the lab copied with made-up hosts): the BERT opens at its screen, drawn and fitted; clicks and keys reach it; **Ports** and back; **Reconnect** once it closes; a VNC password asked for and sent. The IP input is read-only while locked.
- Left: proven on the lab's BERT, and whether its VNC server keeps a SmartAccess session open alongside.

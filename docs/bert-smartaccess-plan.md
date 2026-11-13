# BERT tester SmartAccess plan (2026-11-11, rewritten 2026-11-13)

How a person opens VIAVI SmartAccess AnyWhere on the lab's BERT from the BERT tester in the physical view. Built as phase 7 of the [procedures plan](procedures-plan.md#7-bert-smartaccess).

## Facts

- **SmartAccess AnyWhere is a Windows app** on each person's PC: VIAVI's Qt installer (`SmartAccessAnyWhere_V26-09-28-winsetup.zip`, installer 25.11.27) puts `SmartAccessAnyWhere.exe` under `Viavi\SmartAccessAnywhere` in the Program Files folder, with a Start-menu and a desktop shortcut. Its shortcuts pass no arguments, and it registers no URL protocol, so a web page can't start it as installed. Whether the exe takes an IP on its command line can't be seen from the installer: [box check 7](procedures-plan.md#box-checks).
- **The tracer will be hosted on a Linux machine,** and everyone who opens it sees the same lab. The server can't run a Windows app, and one it ran would open on the server, not on the person's screen. So SmartAccess opens on the person's own PC, and the bridge never launches anything.
- **The BERT has one fixed IP,** and SmartAccess works only with it.
- **Maybe one person at a time:** whether the BERT takes a second SmartAccess connection is box check 7's second question.

## Design

- **The IP is stored once:** the BERT device's `host` in the lab file, the same for everyone, editable only while the lab is unlocked. No new field.
- **The tester's header** (a tester has no box session, so it never polls `/status` or `/state`): the IP, always drawn so nothing shifts; **Copy**; and **Open SmartAccess**, which copies the IP and says so, then:
  - if check 7 finds the exe takes the IP: opens `ols-bert://<ip>`. A one-time registration on each PC (a `.reg` and a `.cmd`, kept in the repo with how to install them) maps that link to `SmartAccessAnyWhere.exe <ip>`. The browser asks once before it hands a link to an app;
  - if not: nothing more. The person opens SmartAccess and pastes the IP.
- **One at a time,** only if check 7 finds the BERT takes one connection: the bridge keeps one claim on the BERT, which every view shows: free, or in use and since when, and by whom once the tracer has logins. **Use the BERT** claims it, refused while someone else holds it; **Done** lets it go, as does 30 min with no word from the page that holds it. The claim is advisory: SmartAccess opened outside the tracer isn't stopped.

## Dropped (2026-11-13)

The first plan had the bridge start SmartAccess (`bridge/launcher.mjs`, `POST /tester/open`, `BERT_SAA_PATH`, `BERT_LAUNCH_MODE`, a `cmd /c start`, and the IP copied by the bridge). That works only while the bridge runs on the person's own Windows PC, never once the tracer is hosted on Linux.

## Tests

- The header: the IP and buttons in every state, Copy and the link, and the input read-only while locked.
- If there is a claim: claimed, refused for a second view, let go by Done and by time, and the same state for every view.
- A browser check, then proven on a lab PC: SmartAccess opens on the BERT.

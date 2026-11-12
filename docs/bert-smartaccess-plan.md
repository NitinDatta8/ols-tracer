# BERT tester SmartAccess launch plan (2026-11-11)

How OLS Tracer should open Viavi SmartAccess AnyWhere from the BERT tester view, and prefill/preconnect it to a target IP when possible.

## Goal

- From a BERT tester in the Physical view, click one button and launch SmartAccess AnyWhere.
- Keep the current model intact: BERT has no box CLI in OLS Tracer.
- Support a per-device tester target IP in the topology.
- Keep this safe: no arbitrary command execution from the browser.

## Scope

### In scope

- New BERT-only UI controls for tester access (target IP + launch button).
- A new bridge endpoint to request a local launcher action.
- A launcher configuration path for SmartAccess AnyWhere.
- Clear user feedback in the UI (started, failed, unsupported).
- Docs updates in the guide.

### Out of scope

- Replacing SmartAccess AnyWhere with a native OLS Tracer tester client.
- Integrating tester telemetry into OLS Tracer state.
- Multi-user remote launch orchestration across machines.

## Constraints and assumptions

- OLS Tracer is a web app; browser code cannot open local Windows apps directly.
- The bridge (`bridge/server.mjs`) is the right place for local process launch.
- BERT remains a tester chassis with no SSH/CLI connection flow.
- The tool path may be environment-specific (example:
  `C:\Users\nitindatta.movva\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Viavi\SmartAccessAnyWhere.lnk`).
- Preconnect behavior depends on SmartAccess AnyWhere startup capabilities:
  - direct command-line args (best), or
  - a wrapper script that automates UI fields, or
  - open-only fallback.

## UX plan

For tester chassis only:

- Header controls show:
  - `Tester IP` input (saved on that device), and
  - `Open SmartAccess` button.
- Button behavior:
  - disabled when no tester IP,
  - on click: `POST /bridge/tester/open?host=<tester-ip>` (or JSON body),
  - toast result from bridge response.
- Existing BERT message stays accurate: still no OLS Tracer CLI terminal.

## Architecture plan

### 1) Topology data model

- Extend device state with a tester target host, e.g. `testerHost?: string`.
- Keep backward compatibility (optional field, no migration bump needed).

Likely files:

- `src/types.ts`
- `src/store.ts`

### 2) Frontend integration

- Add tester-only controls in `PhysicalView` header.
- Reuse existing `bridge()` helper for request/headers.
- Add a small validation guard before request (trimmed non-empty host).

Likely files:

- `src/PhysicalView.tsx`

### 3) Vite proxy

- Expose new bridge route through dev proxy.

Likely files:

- `vite.config.ts`

### 4) Bridge endpoint

- Add endpoint in `bridge/server.mjs`, e.g. `POST /tester/open`.
- Validate inputs strictly (host format like existing `HOST` guard).
- Dispatch to launcher helper module.
- Return structured JSON:
  - `{ ok: true, mode: "preconnect" | "open-only" }`
  - or `{ ok: false, error: "..." }` with status 4xx/5xx.

Likely files:

- `bridge/server.mjs`
- `bridge/launcher.mjs` (new)

### 5) Launcher strategy (ordered)

1. **Direct preconnect** (if SmartAccess supports stable startup args/URI).
2. **Wrapper preconnect** (PowerShell/AutoHotkey wrapper receives IP and automates connect).
3. **Open-only fallback** (launch SmartAccess without preconnect).

Configuration from `bridge/.env` (examples):

- `BERT_LAUNCH_ENABLED=1`
- `BERT_SAA_PATH=<path to exe/lnk/wrapper>`
- `BERT_LAUNCH_MODE=direct|wrapper|open-only`
- `BERT_ALLOWED_HOST_REGEX=...` (optional hardening)

## Security and safety

- Never accept executable path from browser input.
- Only allow fixed launcher path/mode from environment.
- Validate target host using existing hostname/IP pattern.
- Keep existing bridge request origin/header checks intact.
- Log launch attempts (time, target host, mode, result) without secrets.

## Delivery phases

### Phase 0 — Capability check

- Verify SmartAccess AnyWhere startup/preconnect support.
- Decide final mode: `direct` vs `wrapper`.

Exit criteria:

- A repeatable local command can start tool with (or without) target preconnect.

### Phase 1 — MVP launch from BERT view

- Add tester IP field and launch button.
- Add bridge endpoint and open-only launcher mode.
- Add guide docs for setup and expected behavior.

Exit criteria:

- Clicking button from a BERT device opens SmartAccess on host machine.

### Phase 2 — Preconnect

- Implement chosen preconnect strategy.
- Surface response mode in toast (`opened` vs `opened + preconnect requested`).

Exit criteria:

- Button opens tool and reaches configured tester target in one action.

### Phase 3 — Hardening

- Add defensive checks, error messages, and basic automated tests where practical.
- Add troubleshooting section in docs.

Exit criteria:

- Misconfiguration and invalid host errors are explicit and actionable.

## Test plan

### Manual

- BERT device with empty `Tester IP`: button disabled.
- BERT device with valid `Tester IP`: launch success toast.
- Invalid host format: request blocked with clear message.
- Non-BERT device: no SmartAccess controls shown.
- Bridge down: existing bridge-not-running message style preserved.

### Automated (where cheap and stable)

- Unit test host validation helper for launcher endpoint.
- Unit test launcher mode resolution from env.
- UI smoke test for tester controls visibility/disabled states.

## Documentation updates

Update after implementation:

- `docs/guide.md` BERT row: include SmartAccess button behavior.
- `docs/guide.md` bridge section: launcher env vars and safety notes.
- Move this plan to `docs/archive/` when shipped, per repo doc policy.

## Open questions

- What exact SmartAccess AnyWhere version is used in the lab?
- Does that version support command-line target arguments or URI protocol?
- Should tester target be per-device (`testerHost`) or shared global default + per-device override?
- Should launch attempts be recorded in run history, or only bridge logs?

## Acceptance criteria

- A BERT tester can store a target tester IP.
- Clicking `Open SmartAccess` launches the configured tool from OLS Tracer.
- Preconnect works in environments that support it; otherwise clear fallback behavior is shown.
- No arbitrary command execution path is introduced.

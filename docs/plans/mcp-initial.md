# MCP initial

Initial plan to build an MCP server on top of OLS Tracer so an agent can safely query topology, live box state, run history, and troubleshooting signals.

**Status (2026-11-05):** planned

## Goal

Build an MCP server that reuses OLS Tracer's existing bridge and analysis logic to support:

1. Read-only troubleshooting workflows (preferred first).
2. Controlled operational actions (`connect`, `disconnect`, `mark pull`) with guardrails.
3. Structured outputs for an agent to answer questions like "why LOS on 1-3-C2?".

## Constraints

- The bridge stays the only component that talks to boxes over SSH.
- No credentials are exposed through MCP responses.
- Default mode is safe-by-default (read-only tools enabled, mutating actions explicit).
- Keep compatibility with current run layout under `data/boxes/<box>/runs/`.

## Scope (Initial)

### In scope

- New MCP server process (`mcp/` folder).
- MCP tools for bridge status, state, wiring, and pull marking.
- MCP tools for topology validation and diagnostic helpers (path trace, first loss, L0 problems).
- MCP resources for latest run state and outage history episodes.
- Basic safety policy (allow only `show` command execution if command-run tool is added).

### Out of scope

- Multi-user AAA/session isolation.
- NETCONF/gNMI migration.
- Physics-twin modeling (GNPy integration).
- UI redesign; this plan is backend/agent interface only.

## Architecture (initial)

1. **MCP sidecar** in Node/TypeScript, launched independently from the Vite UI.
2. MCP tools call either:
   - existing bridge HTTP endpoints (`/status`, `/state`, `/connect`, `/disconnect`, `/wiring`, `/pull`), or
   - local domain modules (`bridge/history.mjs`, `bridge/recorder.mjs`, `src/rules.ts`, `src/l0.ts`, `src/live.ts`).
3. Domain logic is reused, not reimplemented.

## Initial MCP interface

### Tools (v1)

1. `bridge_status`
   - Returns: connection state, host, error, snapshot progress.
2. `bridge_connect`
   - Input: `host`.
   - Returns: requested host + immediate status.
3. `bridge_disconnect`
   - Returns: final status.
4. `bridge_state`
   - Returns: live state (or last recorded state when disconnected).
5. `list_wiring_strands`
   - Returns: strands from `wiring.csv`.
6. `mark_pulled_strand`
   - Input: strand id.
   - Returns: queued/accepted + status message.
7. `validate_topology`
   - Input: topology JSON.
   - Returns: rule validation errors.
8. `trace_light_path`
   - Input: topology + link id (+ optional state).
   - Returns: ordered hops with hop labels.
9. `first_loss_on_path`
   - Input: topology + link id + box state.
   - Returns: most-upstream LOS/LOF indication.
10. `l0_problems`
    - Input: topology + device id + box state.
    - Returns: range/consistency problems.

### Resources (v1)

1. `ols://bridge/status`
2. `ols://bridge/state`
3. `ols://box/{boxId}/latest`
4. `ols://box/{boxId}/history/events`
5. `ols://box/{boxId}/history/episodes`

## Delivery phases

## Phase 0 - scaffold

- Create `mcp/` package with server entrypoint and tool/resource registration.
- Add config (`MCP_BRIDGE_BASE_URL`, timeouts, safe mode flags).
- Add README with run instructions.

**Exit criteria:** MCP server starts and responds to ping/list-tools/list-resources.

## Phase 1 - bridge-backed tools

- Implement `bridge_status`, `bridge_connect`, `bridge_disconnect`, `bridge_state`, `list_wiring_strands`, `mark_pulled_strand`.
- Normalize bridge errors into stable MCP error objects.

**Exit criteria:** agent can connect to a box, inspect state, and mark pulls via MCP.

## Phase 2 - diagnostics tools

- Wire in reusable logic from `src/rules.ts`, `src/l0.ts`, `src/live.ts`.
- Implement `validate_topology`, `trace_light_path`, `first_loss_on_path`, `l0_problems`.

**Exit criteria:** agent can produce path-first fault triage from recorded or live state.

## Phase 3 - history/resources

- Expose latest run and history/episode resources from `bridge/recorder.mjs` + `bridge/history.mjs`.
- Add lightweight filtering parameters (by time window, severity, run id).

**Exit criteria:** agent can answer "what changed" and "what likely caused outage" from persisted data.

## Safety model (initial)

- Mutations are explicit tools only (`bridge_connect`, `bridge_disconnect`, `mark_pulled_strand`).
- If command execution tool is later added, only `show` commands at operational mode are allowed by default.
- Reject commands containing pipes, help (`?`), or known mutating verbs (`set`, `delete`, `commit`, `rpc`, `clear`).
- Include audit fields in responses: `requestedAt`, `source` (`live` or `run`), and `runId` when applicable.

## Test plan

1. Unit tests for tool input validation and error mapping.
2. Integration tests against a mocked bridge HTTP server.
3. Integration tests against recorded data in `data/boxes/box3/runs/`.
4. Golden tests for diagnostic outputs (`trace_light_path`, `first_loss_on_path`, `l0_problems`) using existing fixtures.

## Risks and mitigations

- **Risk:** drift between frontend domain logic and MCP wrappers.
  - **Mitigation:** import shared functions from `src/` and avoid duplicate implementations.
- **Risk:** accidental unsafe command paths.
  - **Mitigation:** allowlist + parser checks + default safe mode.
- **Risk:** stale run data interpreted as live.
  - **Mitigation:** always include `live` flag and timestamps in responses.

## Done definition (initial)

- MCP server runs locally and advertises v1 tools/resources.
- Core bridge and diagnostic tools work against both live and recorded data.
- Safety policy enforced for mutating operations.
- Documentation added with examples for agent prompts and expected outputs.


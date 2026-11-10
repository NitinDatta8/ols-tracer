# OLS Tracer knowledge schema (v0.1)

This document defines the first, minimal format for command-meaning knowledge used by agents.

## Purpose

- Keep command and field semantics in one machine-readable place.
- Reuse the CLI extraction pipeline as source-of-truth references (`nodeId`, `commandId`).
- Support debugging and teaching with short, practical notes per field.

## Storage

- Canonical knowledge file (per stream): `data/cli/<stream>/knowledge.json`
- Current rollout: `data/cli/csp/knowledge.json`
- Machine-validated schema: `docs/reference/knowledge.schema.v0.1.json`

This follows existing stream-scoped CLI artifacts under `data/cli/`.

## Top-level shape

```json
{
  "schemaVersion": "0.1",
  "stream": "csp",
  "sourceIndexPath": "data/cli/csp/cli-index.source.json",
  "entries": []
}
```

## Entry fields (v0.1)

Each `entries[]` item contains:

- `id`: stable semantic key (for example `och.chromatic-dispersion`)
- `ref`: link to CLI truth
  - `nodeId`
  - `commandId`
  - `op` (`show | set | delete | add | rpc`)
- `kind`: `metric | setting | enum`
- `term`: canonical field name
- `meaning`: one-line plain-English definition
- `value`:
  - `type`: `number | enum | string | boolean`
  - `unit`: string or `null`
  - `range`: `{ "min": number|null, "max": number|null }` or `null`
  - `options`: enum options with short meaning
- `debug`:
  - `why_it_matters`
  - `bad_pattern`
  - `check_next`: follow-up CLI commands
- `impact`:
  - `service_affecting`: boolean
  - `risk`: `low | medium | high`
- `status`:
  - `source`: `helperInfo | lab-note | inferred | manual`
  - `confidence`: `low | medium | high`
  - `lastReviewed`: `YYYY-MM-DD`

## Authoring rules

- Keep `ref.commandId` and `ref.nodeId` aligned with `data/cli/<stream>/cli-index.source.json` and branch files.
- Prefer short, operator-focused `debug` text.
- Use `status.source = helperInfo` when copied from CLI XML helper info.
- Use `status.source = lab-note` for findings from run history or troubleshooting cases.
- Keep entries atomic: one metric/setting per entry.

## Out of scope for v0.1

- Deep formulas or physics models.
- Localization.
- Box-specific overrides (can be added later as a separate overlay file).

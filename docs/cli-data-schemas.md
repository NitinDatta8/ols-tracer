# OLS Tracer CLI data schemas

These are the canonical JSON schemas for the CLI extraction pipeline.

Current rollout scope: **CSP only** (`stream = "csp"`).

## Artifacts

- `data/cli/csp/branches/*.json` uses `branch` schema.
- `data/cli/csp/cli-index.source.json` uses `index` schema.
- `data/boxes/<box-id>/cli-observed.json` uses `observed` schema.
- `data/boxes/<box-id>/cli-index.merged.json` uses `merged` schema.

## `branch` schema (`cli-branch.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ols-tracer/schema/cli-branch.schema.json",
  "title": "OLS Tracer CLI Branch",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "kind",
    "stream",
    "branchId",
    "source",
    "root",
    "stats"
  ],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "kind": { "const": "branch" },
    "stream": { "$ref": "#/$defs/streamId" },
    "branchId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._:-]*$"
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "iiviRoot",
        "profileDir",
        "sourceFile",
        "generatedAt",
        "extractor",
        "extractorVersion"
      ],
      "properties": {
        "iiviRoot": { "type": "string", "minLength": 1 },
        "profileDir": { "type": "string", "minLength": 1 },
        "sourceFile": { "type": "string", "minLength": 1 },
        "generatedAt": { "type": "string", "format": "date-time" },
        "extractor": { "type": "string", "minLength": 1 },
        "extractorVersion": { "type": "string", "minLength": 1 }
      }
    },
    "root": { "$ref": "#/$defs/node" },
    "stats": {
      "type": "object",
      "additionalProperties": false,
      "required": ["nodeCount", "leafCount", "maxDepth"],
      "properties": {
        "nodeCount": { "type": "integer", "minimum": 1 },
        "leafCount": { "type": "integer", "minimum": 0 },
        "maxDepth": { "type": "integer", "minimum": 1 }
      }
    }
  },
  "$defs": {
    "streamId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$"
    },
    "cmdType": {
      "type": "string",
      "enum": ["set", "show", "delete", "add", "rpc"]
    },
    "nodeType": {
      "type": "string",
      "enum": ["container", "list", "leaf", "unknown"]
    },
    "nullableString": {
      "type": ["string", "null"]
    },
    "node": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "nodeId",
        "name",
        "type",
        "path",
        "cmdTypeRaw",
        "cmdTypes",
        "keyPattern",
        "keyRegex",
        "helperInfo",
        "children"
      ],
      "properties": {
        "nodeId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9._:-]*$"
        },
        "name": { "type": "string", "minLength": 1 },
        "aliasName": { "$ref": "#/$defs/nullableString" },
        "type": { "$ref": "#/$defs/nodeType" },
        "path": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "cmdTypeRaw": { "type": "string" },
        "cmdTypes": {
          "type": "array",
          "uniqueItems": true,
          "items": { "$ref": "#/$defs/cmdType" }
        },
        "key": { "$ref": "#/$defs/nullableString" },
        "keyQuery": { "$ref": "#/$defs/nullableString" },
        "keyElem": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "array",
              "minItems": 1,
              "items": { "type": "string", "minLength": 1 }
            }
          ]
        },
        "idName": { "$ref": "#/$defs/nullableString" },
        "keyPattern": { "$ref": "#/$defs/nullableString" },
        "keyRegex": { "$ref": "#/$defs/nullableString" },
        "keyPrefixReplacement": { "$ref": "#/$defs/nullableString" },
        "permissionRule": { "$ref": "#/$defs/nullableString" },
        "helperInfo": { "$ref": "#/$defs/nullableString" },
        "unit": { "$ref": "#/$defs/nullableString" },
        "values": {
          "type": "array",
          "items": { "type": "string" }
        },
        "flags": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "keyPatternMatchOnly",
            "tableShowOnly",
            "noAutoCompletionForShow",
            "keyCaseSensitive",
            "valueCaseSensitive"
          ],
          "properties": {
            "keyPatternMatchOnly": { "type": "boolean" },
            "tableShowOnly": { "type": "boolean" },
            "noAutoCompletionForShow": { "type": "boolean" },
            "keyCaseSensitive": { "type": "boolean" },
            "valueCaseSensitive": { "type": "boolean" }
          }
        },
        "children": {
          "type": "array",
          "items": { "$ref": "#/$defs/node" }
        }
      }
    }
  }
}
```

## `index` schema (`cli-index.source.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ols-tracer/schema/cli-index.source.schema.json",
  "title": "OLS Tracer CLI Index (Source)",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "kind",
    "stream",
    "generatedAt",
    "source",
    "branches",
    "commands",
    "stats"
  ],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "kind": { "const": "index" },
    "stream": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$"
    },
    "generatedAt": { "type": "string", "format": "date-time" },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "iiviRoot",
        "profileDir",
        "xmlFiles",
        "extractor",
        "extractorVersion"
      ],
      "properties": {
        "iiviRoot": { "type": "string", "minLength": 1 },
        "profileDir": { "type": "string", "minLength": 1 },
        "xmlFiles": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "extractor": { "type": "string", "minLength": 1 },
        "extractorVersion": { "type": "string", "minLength": 1 }
      }
    },
    "branches": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["branchId", "sourceFile", "rootName", "rootNodeId"],
        "properties": {
          "branchId": { "type": "string", "minLength": 1 },
          "sourceFile": { "type": "string", "minLength": 1 },
          "rootName": { "type": "string", "minLength": 1 },
          "rootNodeId": { "type": "string", "minLength": 1 }
        }
      }
    },
    "commands": {
      "type": "array",
      "items": { "$ref": "#/$defs/command" }
    },
    "stats": {
      "type": "object",
      "additionalProperties": false,
      "required": ["branchCount", "commandCount", "safeCount", "unsafeCount"],
      "properties": {
        "branchCount": { "type": "integer", "minimum": 1 },
        "commandCount": { "type": "integer", "minimum": 1 },
        "safeCount": { "type": "integer", "minimum": 0 },
        "unsafeCount": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "cmdType": {
      "type": "string",
      "enum": ["set", "show", "delete", "add", "rpc"]
    },
    "nodeType": {
      "type": "string",
      "enum": ["container", "list", "leaf", "unknown"]
    },
    "nullableString": { "type": ["string", "null"] },
    "tokenLiteral": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "text"],
      "properties": {
        "kind": { "const": "literal" },
        "text": { "type": "string", "minLength": 1 }
      }
    },
    "tokenParam": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "name", "source"],
      "properties": {
        "kind": { "const": "param" },
        "name": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_-]*$"
        },
        "source": {
          "type": "string",
          "enum": ["key-elem", "id-name", "value", "implicit"]
        },
        "pattern": { "type": ["string", "null"] }
      }
    },
    "command": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandId",
        "branchId",
        "nodeRef",
        "op",
        "syntax",
        "tokens",
        "cmdTypeRaw",
        "cmdTypes",
        "nodeType",
        "keyPattern",
        "keyRegex",
        "helperInfo",
        "permissionRule",
        "safe",
        "tags"
      ],
      "properties": {
        "commandId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9._:-]*$"
        },
        "branchId": { "type": "string", "minLength": 1 },
        "nodeRef": {
          "type": "object",
          "additionalProperties": false,
          "required": ["nodeId", "path"],
          "properties": {
            "nodeId": { "type": "string", "minLength": 1 },
            "path": {
              "type": "array",
              "minItems": 1,
              "items": { "type": "string", "minLength": 1 }
            }
          }
        },
        "op": { "$ref": "#/$defs/cmdType" },
        "syntax": { "type": "string", "minLength": 1 },
        "tokens": {
          "type": "array",
          "minItems": 2,
          "items": {
            "oneOf": [
              { "$ref": "#/$defs/tokenLiteral" },
              { "$ref": "#/$defs/tokenParam" }
            ]
          }
        },
        "cmdTypeRaw": { "type": "string" },
        "cmdTypes": {
          "type": "array",
          "uniqueItems": true,
          "items": { "$ref": "#/$defs/cmdType" }
        },
        "nodeType": { "$ref": "#/$defs/nodeType" },
        "keyPattern": { "$ref": "#/$defs/nullableString" },
        "keyRegex": { "$ref": "#/$defs/nullableString" },
        "helperInfo": { "$ref": "#/$defs/nullableString" },
        "permissionRule": { "$ref": "#/$defs/nullableString" },
        "safe": { "type": ["boolean", "null"] },
        "tags": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]*$"
          },
          "uniqueItems": true
        }
      }
    }
  }
}
```

## `observed` schema (`cli-observed.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ols-tracer/schema/cli-observed.schema.json",
  "title": "OLS Tracer CLI Observed (Per Box)",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "kind",
    "stream",
    "boxId",
    "generatedAt",
    "source",
    "observations",
    "stats"
  ],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "kind": { "const": "observed" },
    "stream": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$"
    },
    "boxId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._:-]*$"
    },
    "generatedAt": { "type": "string", "format": "date-time" },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "runsRoot",
        "runIds",
        "captureRules"
      ],
      "properties": {
        "runsRoot": { "type": "string", "pattern": "^data/boxes/.+/runs$" },
        "runIds": {
          "type": "array",
          "minItems": 0,
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "captureRules": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "pagingOffCommand",
            "minTerminalCols",
            "preservePrompt",
            "allowEdits"
          ],
          "properties": {
            "pagingOffCommand": { "type": "string", "minLength": 1 },
            "minTerminalCols": { "type": "integer", "minimum": 250 },
            "preservePrompt": { "const": true },
            "allowEdits": { "const": false }
          }
        }
      }
    },
    "observations": {
      "type": "array",
      "items": { "$ref": "#/$defs/observation" }
    },
    "stats": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandCount",
        "onBoxYes",
        "onBoxNo",
        "onBoxUnknown",
        "capturedCount",
        "parseOkCount",
        "parseErrorCount"
      ],
      "properties": {
        "commandCount": { "type": "integer", "minimum": 0 },
        "onBoxYes": { "type": "integer", "minimum": 0 },
        "onBoxNo": { "type": "integer", "minimum": 0 },
        "onBoxUnknown": { "type": "integer", "minimum": 0 },
        "capturedCount": { "type": "integer", "minimum": 0 },
        "parseOkCount": { "type": "integer", "minimum": 0 },
        "parseErrorCount": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "captureParse": {
      "type": "object",
      "additionalProperties": false,
      "required": ["status", "templateId", "resultPath", "error"],
      "properties": {
        "status": {
          "type": "string",
          "enum": ["not-attempted", "ok", "error"]
        },
        "templateId": { "type": ["string", "null"] },
        "resultPath": { "type": ["string", "null"] },
        "error": { "type": ["string", "null"] }
      }
    },
    "capture": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "runId",
        "command",
        "rawPath",
        "startedAt",
        "endedAt",
        "promptBefore",
        "promptAfter",
        "redacted",
        "parse"
      ],
      "properties": {
        "runId": { "type": "string", "minLength": 1 },
        "command": { "type": "string", "minLength": 1 },
        "rawPath": { "type": "string" },
        "startedAt": { "type": "string", "format": "date-time" },
        "endedAt": { "type": "string", "format": "date-time" },
        "promptBefore": { "type": "boolean" },
        "promptAfter": { "type": "boolean" },
        "terminalCols": { "type": "integer", "minimum": 1 },
        "redacted": { "type": "boolean" },
        "parse": { "$ref": "#/$defs/captureParse" }
      }
    },
    "observation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandId",
        "status",
        "onBox",
        "captures"
      ],
      "properties": {
        "commandId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9._:-]*$"
        },
        "status": {
          "type": "string",
          "enum": ["not-run", "captured", "parse-ok", "parse-error", "not-on-box"]
        },
        "onBox": {
          "type": "string",
          "enum": ["yes", "no", "unknown"]
        },
        "helpEvidence": {
          "type": "object",
          "additionalProperties": false,
          "required": ["sourcePath", "matched"],
          "properties": {
            "sourcePath": { "type": ["string", "null"] },
            "matched": { "type": "boolean" }
          }
        },
        "captures": {
          "type": "array",
          "items": { "$ref": "#/$defs/capture" }
        },
        "notes": { "type": "string" }
      }
    }
  }
}
```

## `merged` schema (`cli-index.merged.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ols-tracer/schema/cli-index.merged.schema.json",
  "title": "OLS Tracer CLI Index (Merged Source + Observed)",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "kind",
    "stream",
    "boxId",
    "generatedAt",
    "refs",
    "commands",
    "stats"
  ],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "kind": { "const": "merged" },
    "stream": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$"
    },
    "boxId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._:-]*$"
    },
    "generatedAt": { "type": "string", "format": "date-time" },
    "refs": {
      "type": "object",
      "additionalProperties": false,
      "required": ["indexPath", "observedPath"],
      "properties": {
        "indexPath": { "type": "string", "pattern": "^data/cli/.+/cli-index\\.source\\.json$" },
        "observedPath": { "type": "string", "pattern": "^data/boxes/.+/cli-observed\\.json$" }
      }
    },
    "commands": {
      "type": "array",
      "items": { "$ref": "#/$defs/mergedCommand" }
    },
    "stats": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandCount",
        "onBoxYes",
        "onBoxNo",
        "onBoxUnknown",
        "observedYes",
        "parseOkCount",
        "pollEligibleCount"
      ],
      "properties": {
        "commandCount": { "type": "integer", "minimum": 0 },
        "onBoxYes": { "type": "integer", "minimum": 0 },
        "onBoxNo": { "type": "integer", "minimum": 0 },
        "onBoxUnknown": { "type": "integer", "minimum": 0 },
        "observedYes": { "type": "integer", "minimum": 0 },
        "parseOkCount": { "type": "integer", "minimum": 0 },
        "pollEligibleCount": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "cmdType": {
      "type": "string",
      "enum": ["set", "show", "delete", "add", "rpc"]
    },
    "nodeType": {
      "type": "string",
      "enum": ["container", "list", "leaf", "unknown"]
    },
    "coverage": {
      "type": "object",
      "additionalProperties": false,
      "required": ["runsSeen", "captureCount", "parseOkCount", "parseErrorCount"],
      "properties": {
        "runsSeen": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "captureCount": { "type": "integer", "minimum": 0 },
        "parseOkCount": { "type": "integer", "minimum": 0 },
        "parseErrorCount": { "type": "integer", "minimum": 0 }
      }
    },
    "pollCandidate": {
      "type": "object",
      "additionalProperties": false,
      "required": ["eligible", "reason", "templateId", "everySec"],
      "properties": {
        "eligible": { "type": "boolean" },
        "reason": { "type": "string" },
        "templateId": { "type": ["string", "null"] },
        "everySec": { "type": ["integer", "null"], "minimum": 1 }
      }
    },
    "templateRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["templatePath", "fixtureTxtPath", "fixtureJsonPath"],
      "properties": {
        "templatePath": { "type": ["string", "null"] },
        "fixtureTxtPath": { "type": ["string", "null"] },
        "fixtureJsonPath": { "type": ["string", "null"] }
      }
    },
    "mergedCommand": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commandId",
        "branchId",
        "op",
        "syntax",
        "onBox",
        "observed",
        "parseStatus",
        "coverage",
        "sourceMeta",
        "runtime",
        "pollCandidate",
        "template"
      ],
      "properties": {
        "commandId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9._:-]*$"
        },
        "branchId": { "type": "string", "minLength": 1 },
        "op": { "$ref": "#/$defs/cmdType" },
        "syntax": { "type": "string", "minLength": 1 },
        "onBox": { "type": "string", "enum": ["yes", "no", "unknown"] },
        "observed": { "type": "boolean" },
        "parseStatus": {
          "type": "string",
          "enum": ["not-run", "parse-ok", "parse-error", "no-template"]
        },
        "coverage": { "$ref": "#/$defs/coverage" },
        "sourceMeta": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "nodeType",
            "cmdTypeRaw",
            "cmdTypes",
            "keyPattern",
            "keyRegex",
            "helperInfo",
            "permissionRule"
          ],
          "properties": {
            "nodeType": { "$ref": "#/$defs/nodeType" },
            "cmdTypeRaw": { "type": "string" },
            "cmdTypes": {
              "type": "array",
              "items": { "$ref": "#/$defs/cmdType" },
              "uniqueItems": true
            },
            "keyPattern": { "type": ["string", "null"] },
            "keyRegex": { "type": ["string", "null"] },
            "helperInfo": { "type": ["string", "null"] },
            "permissionRule": { "type": ["string", "null"] }
          }
        },
        "runtime": {
          "type": "object",
          "additionalProperties": false,
          "required": ["safe", "tags"],
          "properties": {
            "safe": { "type": ["boolean", "null"] },
            "tags": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-]*$"
              },
              "uniqueItems": true
            }
          }
        },
        "pollCandidate": { "$ref": "#/$defs/pollCandidate" },
        "template": { "$ref": "#/$defs/templateRef" }
      }
    }
  }
}
```

# Command knowledge: first draft

> **Archived 2026-11-11:** the first draft of command knowledge, for `set och`, before the [knowledge schema](../reference/knowledge-schema.md). Of its attributes, `data/cli/csp/knowledge.json` has only `operational-mode-name`; frequency, target-output-power, laser and loopback are not in it yet.

```json
{
  "command": "set och <name> <attribute> <value>",
  "name_format": "<chassis>-<slot>-<C|L><index>",
  "attributes": {
    "frequency": {
      "type": "integer",
      "unit": "MHz",
      "example_range_profile": "[186050000..190875000] or [191300000..196100000]",
      "implication": "service-affecting; validated by card/profile"
    },
    "target-output-power": {
      "type": "decimal(2)",
      "unit": "dBm",
      "example_range_profile": "-10.00..5.00",
      "implication": "service-affecting; runtime range can be further constrained by operational mode"
    },
    "laser": {
      "options": {
        "enabled": true,
        "disabled": false
      },
      "backend_alias": "enabled (transceiver config in CSP)",
      "implication": "final laser-on depends on admin gates + signal policy, not only this flag"
    },
    "loopback": {
      "options": {
        "none": "NONE",
        "facility": "FACILITY",
        "terminal": "TERMINAL"
      },
      "backend_alias": "loopback-mode (logical-channel config)",
      "implication": "used for test/diagnostic traffic redirection; can be blocked by mode/state policies"
    },
    "operational-mode-name": {
      "type": "string enum",
      "implication": "maps to operational-mode ID and changes modulation/FEC operating profile"
    }
  }
}
```

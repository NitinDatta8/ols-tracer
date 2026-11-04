# Box 3

What the CLI can't tell. The fiber map is in [wiring.csv](wiring.csv); the rest of the box comes from its runs.

## Nodes

| Hostname | Chassis model | Release | Chassis numbers (CLI) |
| --- | --- | --- | --- |
| PAHO-GS2000-03 | COHERENT-GS2000 | CSP-2.10.100.10_20261013 | 1 |

| Slot | Card | In use |
| --- | --- | --- |
| 1-1 | TMUXC1125, terminal mux/demux with integrated amplifiers | ad11, line |
| 1-7 | 800MX | 1-7-4 client, 1-7-5 line |
| 1-8 | 800MX | none (1-8-1 and 1-8-4 have no transceiver) |

## Service under test

- In words: BERT P1 → 1-7-4 (client) → CC5_4 → 1-7-5 (line) → 1-1-ad11 → C1125 → 1-1-line → ATT1 → 1-1-line → C1125 → 1-1-ad11 → 1-7-5 → 1-7-4 → BERT P1
- Client type: 100GE, FS QSFP-LR4-100G (100GBASE-LR4, 4 lanes)
- Line: ZR400-16QAMSS-60G-OFEC on a Finisar QSFP-DD DCO, 193.5 THz, target −3 dBm

## BERT

- Vendor and model: ?
- Test interface and ports used: 100GE, one port (P1), straight into 1-7-4
- Pattern, duration and pass criterion: ?
- Remote control: ?

## Passives (anything without its own CLI)

| Id | What | Value |
| --- | --- | --- |
| ATT1 | attenuator on the C1125's line side | 10 dB |

## Behaviour

- Media channels: F03 and F04's light goes through media channel 6, AD11 to LINE at 193.5 THz, 100 GHz wide. Only the config log has shown it so far, and that log cuts a command at 70 characters and carries on in the next row. `ch-6` in `show alarm` is that channel
- ALS/APR: ?
- Protection: ?
- Paging off: `set cli length 0` and `set cli width 1024`, in `configure` (`set cli auto-width disabled` is `invalid command`)
- Prompt per mode: `admin@PAHO-GS2000-03>` normal, `admin@PAHO-GS2000-03#` configure
- Box clock: UTC, wrong (2021-07-26 on 2026-10-31, `DATETIME_UNCHANGED`); `date-time` prints it

## Not found in the CLI

- Alarm history as `show alarm history`: it's `show log alarm -l <n>`
- PM thresholds: `show pm threshold` is `invalid command`
- `show pm` and `show pm history` print `None`

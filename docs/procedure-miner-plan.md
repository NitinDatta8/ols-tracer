# Procedure miner plan

The miner finds the workflows people still do by hand in the boxes' logs, so they can become procedures. It is the last phase left of the [procedures plan](archive/procedures-plan.md#14-procedure-miner) (phase 14). How a procedure is defined and run is in that plan's [Procedures](archive/procedures-plan.md#procedures) section and in the [guide](guide.md#poller).

## What the runs show

The 8 boxes' `history.jsonl` hold 599 config lines (279 CLI or console, 320 NETCONF) and 2,252 alarm events, all as `admin` from 18 source IPs. These were counted on 2026-11-12, partly by hand. The miner counts them again from the runs.

| Done by hand | Seen | Example |
| --- | --- | --- |
| Software upgrade or downgrade: download, wait, activate, `CU_SWITCH` and `NO_CMT_SW`, then commit or rollback | 7 downloads, 5 activates, 1 commit, 1 rollback, often in batches | test02, 2026-10-20 21:21, committed 10-21 03:26 |
| Day-0 commissioning over the console: ztp off, hostname, saving-mode manual, IP, OSPF, route, LLDP name, save, saving-mode auto, save, `reboot ne cold` | boxes 04–08 | 06, 2026-11-09 15:14–15:16 |
| Service turn-up: port-mode, in-service, OCH frequency and power, logical channel, client, cross-connection | 9 CLI, 3 NETCONF; 4–7 min by hand | 04, 2026-10-27 15:54–16:01 |
| Teardown and re-route: delete the cross-connection, ports out of service, laser off, a new client port and cross-connection | 4, all on 04 | 04, 2026-11-05 10:47–10:59 |
| Reboot and wait; a card reboot that ends in an NE reboot | 20 NE and 18 card reboots | 04, 2026-10-28 13:47 → 13:54 |
| Factory reset: ztp off, `clear database keep-networking`, hostname, LLDP, reboot | 4 | test02, 2026-10-19 11:50–12:01 |
| Add/drop sweep: a media channel made and deleted on ad2…ad11 | 13 made and deleted | 03, 2026-11-02 12:10–12:20 |
| Output-power trim (`target-output-power` -3, 0, -1, -2) | 22 changes | 04, 2026-11-05 11:01–11:05 |
| Port-mode against the transceiver: the NETCONF controller sets ZR800, gets `TRANSCEIVER_MISMATCH` and reverts | 20 mismatches on test01 and test02, in lockstep | |
| Card re-provision (module-type) | 7 | 03, 2026-10-28 |

The upgrade with its commit and rollback, the turn-up, the teardown and both reboots are procedures already (`catalog/common/procedures.json`). The rest are not.

## Build

- `bridge/mine.mjs` and `scripts/mine-procedures.mjs`: the config lines grouped by session and time gap, ids replaced by placeholders, and the repeated sequences ranked.
- The MCP's `suggest_procedures`, read-only, over `/history`. A suggestion goes into `procedures.json` only after it has run once with a person watching.
- Test: today's data gives the table above.

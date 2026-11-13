# OLS Tracer roadmap

What is left and what comes next. What is built is in the [guide](guide.md), why in the [decisions](decisions.md), and the finished plans in the [archive](archive/).

## Status

| Iter | Goal | Status |
| --- | --- | --- |
| 1 | Packet Tracer–style builder: chassis → linecards → pluggables → Tx/Rx fiber, single-mode, with L0, L1 and Data views | Done |
| 2 | The real inventory per corporation from the IIVI profiles, the CLI command per level, and **Run** on a lab box | Done |
| 2.5 | Box 3 replica: Connect draws the box from its own CLI, the bridge records every run, and an agent names a pulled fiber | Done but for box runs (below) |
| 3 | Run the light: measured light on the fibers, threshold colours, L0 cards from the inside | Done, read-only |
| MCP | Codex diagnoses a box through the bridge, in the repo `ols-mcp` | Done: 26 of 30 exact on box 3's ten recorded cases, against 2 of 10 for the rule baseline |

## Left

- **Procedures** (notes item 8): the workflows the boxes' logs show done by hand, as procedures the bridge runs from the UI and the MCP, tiered by risk: a software audit and health check, locate chassis, reboot a card or the NE, a software upgrade with its Commit and Rollback, service turn-up and teardown, and a miner that finds more. Plan: [procedures plan](procedures-plan.md).
- **Iter 3 UI**, in the same plan: the fixed lab with a lock, which follows the hardware (notes item 6); a card's insides drawn with the anatomy kit; the BERT's SmartAccess AnyWhere, opened on each person's PC ([BERT plan](bert-smartaccess-plan.md)).
- **Fixes found on the way** ([plan, phase 1](procedures-plan.md#1-fixes-found-on-the-way)): reboots typed in any case and restarts (activate, rollback, clear database) in the box's episodes; eight 2026-11-10 runs never parsed; box 5 opening a new connect run every 10 min.
- **Box runs** (work machine): pull F04 and F05, one per run, each marked in the UI and restored (F01 to F03 ran on 2026-11-05); healthy runs B and C, for drift.
- **`show media-channel` template:** runs have its output since 2026-11-05, so give it a TTP template and fixture, and have `mediaChannels` in `src/l0.ts` read its `data` instead of raw columns. `show ocm` is captured, but nothing reads it.
- **Any box, not just box 3:** `bridge/poll.json` names box 3's ports (1-7-4, 1-7-5); take them from `show port` and `show assignment`. While a box is connected, show its `show alarm` alarms instead of the simulated ones.
- **Box 3 readings nobody has explained:** what `show optical-port`'s flags `C` and `M` mean, why F03 seems to gain 6 dB, and why F05 loses 6.5 dB through a 10 dB pad.
- **Leftovers:** `src/store.ts` upgrades `ch-2026-4ru` to `ch-16slot`, a chassis no stream has; the 9 photos in `public/pluggables/` are unused (key them by part number); GitHub Support still has to purge the orphaned commits that held an internal PDF.
- **Fronts the deck doesn't draw** ([OLS Introduction](reference/ols-introduction.md#cards)): box 3's C1125 and the other cards listed there keep all their profile ports, internal ones too, until a picture of their front comes (a photo, or the card's own deck). The deck also disagrees with the catalog on the front panel's third port (ETH, not MON), the back's MUX ports, and C925/C935/C25 LINE, a fixed LC in the deck but taking SFPs in the profile.
- Requests not planned yet are in [notes](notes.md).

## Later

- **Structured CLI output:** a JSON mode, or NETCONF/YANG, instead of parsing text. The CLI tree is extracted for CSP only (`npm run sync:cli-data:csp`); the other streams come next. The bridge stays the only thing that talks to boxes.
- **AAA (RADIUS, TACACS+):** when each person logs in as themselves, the bridge needs a session per person, and the box may refuse some commands.
- **MACsec** on client ports and fibers: on or off, key status, alarms, its commands.
- **A terminal per person:** two people typing in one box's physical-view terminal share its one shell.
- **LEDs and card stats:** an LED's behaviour is the product's own, in its profile in the codebase: capture it from there, never define it here. Card stats (temperature, power, PM) come with it. Out of the procedures plan since 2026-11-13.
- **Hosting on a shared Linux machine:** one bridge and one lab file, so everyone sees the same lab. The bridge answers only on its own machine today, so a hosted one needs a proxy in front of it and logins (AAA, above) first. SmartAccess AnyWhere stays on each person's PC.
- **More procedures:** factory reset and Day-0 (over the console), a simulated pull with labelled runs, the add/drop and power sweeps, PRBS, loopback, OTDR and delay measurement, an upgrade campaign across boxes that stops at the first failure, and a nightly sanity run that feeds the eval.

## Ideas

| Idea | What it gives | Reuse |
| --- | --- | --- |
| Physics twin (parked) | Per-span power, OSNR, GSNR, ASE/NLI and CD/PMD with no box; what-if, planned vs measured | [GNPy](https://github.com/Orange-OpenSource/gnpy) |
| Undo/redo | For the topology store | `zundo` |
| Command palette | Cmd-K | `cmdk` |
| Auto-layout | For topologies drawn from a box | ELK.js |
| Training mode | Fault injection, like Packet Tracer's Activity Wizard | |
| BOM export | A CSV of part numbers | |
| More rule types | Shared lanes, dependencies, chassis limits | |
| Simulation mode | An animated signal walking the path | |
| Image mapper | The slots and ports marked on a real image | |
| Real L1/OTN and services | Beyond the cosmetic L1 and Data views | |

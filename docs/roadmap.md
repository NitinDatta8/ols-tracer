# OLS Tracer roadmap

Where the tracer is going, iteration by iteration, and the ideas not scheduled yet. What is built is in the [guide](guide.md), and why it is built that way is in the [decision log](decisions.md). It is a pet project: everything stays in this repo and nothing changes in the product.

**The current order of work is the [plan of 2026-11-01](plans/plan-2026-11-01.md).**

## Iterations

| Iter | Goal | Status |
| --- | --- | --- |
| 1 | Packet Tracer–style builder: chassis → linecards → pluggables → Tx/Rx fiber, single-mode only, with L0, L1 and Data views | Done ([MVP plan](archive/mvp-plan.md), from the [original idea](archive/idea.md)) |
| 2 | The real inventory per corporation from the IIVI profiles (CSP first, L0 later), the exact CLI command per level, and **Run** on a lab box | Done ([CLI plan](archive/cli-run-plan.md)) |
| 2.5 | **Box 3 replica:** the tracer learns box 3 from its own CLI, and an agent names any pulled fiber | In progress ([box 3 capture](plans/box3-capture.md)) |
| 3 | **Run the light:** show the measured light on the fibers and in hovers | Step 1 next: 2.5's recorder is done |
| Later | Deeper C++ CLI integration, AAA, MACsec, more boxes | Not started |

## Goal 2.5: box 3 replica

Box 3 in the lab passes BERT traffic end to end. The goal is won when:

1. **The link design is captured:** box 3's inventory and fiber map, drawn on the canvas.
2. **Connect fills the canvas:** on **Connect**, the bridge runs the commands that have TTP templates in the background and fills the chassis with its linecards, pluggables and fibers. Until it is done, the chassis is greyed out with a spinner and "Fetching data from box".
3. **The agent names the pulled fiber:** pull any fiber, and the agent says which one from the alarms and CLI output.

- Each pull is an experiment: a healthy baseline, then one pull per run, with the answer in a hidden `answer.json`. The runs build up so the agent's memory and accuracy can be tracked and improved.
- Only pulls the box can see are scored. A fiber whose Rx end is outside the box (box → BERT), or that runs between passive parts, has "insufficient evidence" as its right answer.
- The agent has to beat a rule-based baseline: the most-upstream LOS on the known path.
- Steps and their status: [box 3 capture → Order](plans/box3-capture.md#order).

## Iter 3: run the light

- **Measured before predicted.** First show what the box reports: transceiver and physical-channel power, and OCH OSNR, CD, Q-margin and pre-FEC BER. Predicted light (GNPy) is parked, and L0 and the C cards stay opaque glass for now.
- **Step 1:** hovering a fiber shows the measured values at its ends ([plan](plans/box3-capture.md#iter-3-step-1-measured-light-on-hover)).
- **Then colour and size:** more power means a bigger red highlight over the yellow line. This needs thresholds, and `show pm threshold` is invalid on box 3's release.
- **Real images** from Coherent presentations. The 9 photos in `public/pluggables/` are keyed by the old demo ids, so nothing has used them since the catalog moved to the IIVI profiles. Two of their parts (FTLC1154RDPL, FTCD3312M1BCL) are in the stream catalogs, so the photos could be keyed by part.

## Later

From step 3 and step 4 of the [CLI plan](archive/cli-run-plan.md#step-3-deeper-integration-with-the-c-cli-later):

- **C++ CLI:** the full XML command tree is extracted for CSP (`npm run sync:cli-data:csp`); the other streams come next. A structured output (a JSON mode, or an API such as NETCONF/YANG) would let the tracer read the box's real state. The bridge stays the only thing that talks to boxes.
- **AAA (RADIUS, TACACS+):** still an SSH login. When each person logs in as themselves, the bridge needs one session per user, and the box may refuse some commands.
- **MACsec** belongs on client ports and fibers (on/off, key status, alarms, its commands), not in the bridge.
- **More boxes:** each device gets a `box` name, the bridge keeps one session per box, and each device shows its own status.

## Ideas backlog

| Idea | What it gives | Reuse | Status |
| --- | --- | --- | --- |
| Box → canvas live sync | **Discover** (import from box), **Reconcile** (badges where the plan differs: missing, wrong part, not in plan), **Live overlay** (pipes coloured by Rx power, a 15-minute sparkline, real alarms), **Snapshot + diff** | TTP | Goal 2.5 |
| AI troubleshooting copilot | "Why LOS on 1-3-C2?": the agent walks the path, runs show commands and highlights the suspect span | MCP; `mcp-telecom`, `mcp-netmiko-server` (read-only SSH) | Goal 2.5's agent |
| Physics twin | Per-span power, OSNR, GSNR, ASE/NLI and CD/PMD with no box; what-if, planned vs measured | GNPy (REST API since 3.0) | Parked |
| Undo/redo | For the topology store | `zundo` | |
| Command palette | Cmd-K | `cmdk` | |
| Auto-layout | For imported topologies | ELK.js | |
| Training mode | Fault injection, like Packet Tracer's Activity Wizard | | |
| BOM export | A CSV of part numbers | | |
| More rule types | Mutual exclusion (shared lanes), dependencies, chassis limits | | |
| Simulation mode | An animated signal walking the path | | |
| Image mapper | Mark the slots and ports on a real image | | |
| Real L1/OTN and services | Beyond the cosmetic L1 and Data views | | |

Notes on live sync:

- A box knows its ports, not where the glass goes. Fibers stay hand-drawn unless a command gives neighbour data (OSC, LLDP or a trace id).
- Values are keyed by CLI address (`1-3-C2`), which the canvas already uses, so a value finds its port without a mapping table, and a later gNMI swap only touches the bridge.
- Live values sit in their own store slice and are never saved in `.olst.json`, just like alarms.

## Sources

- CLI parsing: [TTP](https://pypi.python.org/pypi/ttp/), [ntc-templates](https://ntc-templates.readthedocs.io/en/latest/user/lib_overview/), [Ansible CLI parsing guide](https://docs.ansible.com/projects/ansible/13/network/user_guide/cli_parsing.html)
- If gNMI comes later: [gnmic subscriptions](https://gnmic.openconfig.net/user_guide/subscriptions/), [OpenConfig platform-transceiver](https://www.netconfcentral.org/modules/openconfig-platform-transceiver/2023-08-30/source/raw/)
- [Optical network digital twin: use cases and architecture (arXiv)](https://arxiv.org/pdf/2511.06368)
- GNPy: [GitHub](https://github.com/Orange-OpenSource/gnpy), [PyPI 3.0.0](https://pypi.org/project/gnpy/3.0.0/), [JOCN paper](https://iris.polito.it/bitstream/11583/2826672/1/JOCN_GNPy.pdf), [TIP 2.14 release notes](https://www.telecominfraproject.com/post/what-s-new-in-gnpy-release-2-14-improved-accuracy-multi-vendor-equipment-library-and-yang-model-s)
- MCP: [mcp-telecom](https://pypi.org/project/mcp-telecom/), [mcp-netmiko-server](https://mcp.so/zh/servers/mcp-netmiko-server)

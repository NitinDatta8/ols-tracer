# Information needed to build and attach the sim

[Notes](notes.md) item 4 asks for the CSP sim to be attached to the tracer and shown in it. The product builds CSP three ways: `mk sim csp`, `mk load csp` and `mk target csp`. Before anything is built in the tracer, the questions below have to be answered from `IIVI_Platform` (and, for the last section, from one running sim). Nothing is built until they are.

Write the answers in `docs/reference/sim.md`. For each one, give the path in `IIVI_Platform` and the line it comes from, as [notes](notes.md) does for the profiles. A question the code doesn't answer is marked unknown rather than guessed. Logins and passwords don't go in either doc: they go in `bridge/.env`.

## 1. The three build targets

1. Where `mk` is defined, and what `mk sim csp`, `mk load csp` and `mk target csp` each run (make targets, scripts, toolchain).
2. What each one produces, where its output lands, and which CPU it is built for.
3. What depends on what: does `mk load` need `mk target` first, and does `mk sim` share any of their output?
4. Whether the same three exist for the other streams (`ctc`, `polaris`, `tencent`, `ws`).
5. Any README, wiki page or comment in `IIVI_Platform` that explains the sim and its known limits.

The tracer needs this to say what each one is, and so which of the three can be attached at all.

## 2. Starting and stopping the sim

1. The command or script that starts a sim once it is built, and what it needs: root, Docker, a VM, network namespaces.
2. The config files it reads at start.
3. How many sims can run on one machine at once, and what keeps them apart (ports, folders, names).
4. How to stop one, and how to reset it to a clean state. Does its database survive a restart?

The tracer needs this to know whether each person runs their own sim, and how a run on it starts from a known state.

## 3. Reaching its CLI

1. The protocol (SSH or telnet), the port, and where the default login is set.
2. Whether it is the same CLI as a box, built from the same `cli/csp` profile files, and whether any command is missing or extra.
3. Whether the poller's prerequisites run there: `configure`, `set cli length 0`, `set cli width 1024`, `exit` (`bridge/poll.json`).
4. Whether the sim also serves NETCONF ([notes](notes.md) item 6).

The bridge logs in to every box with one port and one login (`BOX_PORT`, `BOX_USER`, `BOX_PASSWORD`). If the sim needs a different port or login, each device needs its own. The CLI index (`data/cli/csp/cli-index.source.json`) and the TTP templates only work if the sim prints what a box prints.

## 4. The hardware the sim presents

1. What decides the chassis, the cards in each slot, the pluggables in each port, and the PSUs and fans: a profile, a config file or something fixed in code.
2. Whether that can be set per sim, for example to match box 3 (C1125 in slot 1, 800MX in slot 7).
3. Whether a card or pluggable can be put in or taken out while the sim runs.
4. Which parts are really simulated and which are stubs that only answer: CU, linecards, L0 (amplifiers, WSS, OSC, OCM), pluggables, PSUs, fans, LEDs.

The tracer draws the physical view from the CLI, so it needs to know whether that view is the sim's own or the same one every time.

## 5. State and light

1. What the sim reports for optical power, OSNR, chromatic dispersion, pre-FEC BER and the like: fixed values, random ones, values from a file, or -99.99 (no light).
2. Whether it raises alarms on its own, for example LOS on a port with nothing into its Rx.
3. Whether it has any idea of a fiber between two ports, within one sim or between two sims.
4. Whether PM counters and the alarm and event logs fill in as on a box, and what clock the sim keeps.

The L0 views show only what the box reports and never model light. If the sim has no light, they will show none, and that decides how much of the light view is worth showing for a sim.

## 6. Changing the sim from outside

1. Any API, hidden command, file or script that sets a reading, raises or clears an alarm, pulls a fiber, or fails a card, PSU or fan.
2. Whether the sim's internal state can be read from outside the CLI (what it really holds, against what the CLI shows).

Faults on demand would let a pulled fiber be tried without touching one, and the sim's internal state would be the answer key for the agent's eval.

## 7. What the sim says it is

1. The default hostname, and how to set it per sim.
2. What `show software` prints for a sim build: the release string and its format.
3. The serial numbers and part numbers it reports.

The bridge names a box's folder after its hostname, and a run's `meta.json` keeps its release. Two sims with the same default hostname would write into one folder, and the CLI index is picked by release.

## 8. Loads and target builds

1. What `mk load csp` produces: the file name pattern, the format, and how the name maps to the release `show software` prints.
2. Whether a sim can download, activate, commit and roll back a load, as the **Software upgrade**, **Commit software** and **Roll back software** procedures do on a box. Where a load is served from for that.
3. What `mk target csp` produces that a load doesn't, and whether there is a way to put a target build on a box other than as a load.

The tracer needs this to know whether the change procedures can be tried on a sim first, and how a load built here would reach a box.

## 9. From one running sim

A sim started by hand, with these commands typed into its CLI and each one's raw output saved to a file named after the command, as a run's `raw/` folder does:

`show system`, `show software`, `show chassis`, `show card`, `show inventory`, `show port`, `show assignment`, `show transceiver`, `show och`, `show optical-port`, `show amplifier`, `show media-channel`, `show alarm`, `show log alarm -l 50`, `help show`.

Diffed against the same commands from a box 3 run in `data/boxes/paho-gs2000-03/runs/`, they show what the TTP templates and the CLI index would make of a sim, and they become the fixture the tracer's tests use instead of a live sim.

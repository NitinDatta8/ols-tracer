# OLS Tracer

A Packet Tracer–style web app for optical line systems. You drag chassis onto a canvas, fill them with linecards (C25, C925, C1125, 400MX, 800MX) and pluggables, and wire single-mode fiber from Tx to Rx. Every piece of hardware has a datasheet and a CLI command, and **Run** sends that command to a lab box over SSH.

## Install on a new machine

You need [Node.js](https://nodejs.org) 22.12 or newer (`node -v`), git, and the [GitHub CLI](https://cli.github.com) signed in to an account with access to this private repo.

```sh
gh auth login                       # once per machine
gh repo clone NitinDatta8/ols-tracer
cd ols-tracer
npm install
```

## Run

```sh
npm run dev        # open http://localhost:5173
```

Click **Open** and pick `examples/demo.olst.json` to see a ready-made topology.

## Run commands on a lab box (optional)

```sh
cp bridge/.env.example bridge/.env   # then set BOX_USER and BOX_PASSWORD (or BOX_KEY)
npm run bridge:setup                 # once: a Python venv with TTP, for the poller
npm run bridge                       # keep it running next to npm run dev
```

Open a device, type the box's IP in the header and click **Connect**. The machine has to reach the box over SSH, so its IP must be allowed in the lab. The dot turns green once the box is connected, and closing the view disconnects. `bridge/.env` is git-ignored, so credentials never get committed.

## Other commands

```sh
npm test           # every test in test/, in about 30 s
npm run build      # typecheck and production build in dist/
npm run sync:auto  # run all catalog sync steps (platform + linecards + CLI)
npm run sync:platform  # regenerate catalog/streams.json and catalog/<stream>/chassis.json from ../IIVI_Platform profiles
npm run sync:cli       # regenerate catalog/<stream>/cli.json from ../IIVI_Platform profile XML
npm run sync:cli-data:csp # generate CSP branch/index (committed) and observed/merged (git-ignored) under data/
npm run sync:linecards # regenerate catalog/<stream>/linecards.json and catalog/<stream>/pluggables.json from ../IIVI_Platform profiles
```

`npm run dev`, `npm run build` and `npm test` run `sync:auto` first when `../IIVI_Platform/profile/cu` is present. The [guide](docs/guide.md#catalog) says what each sync writes.

## Test

`npm test` runs everything in `test/`, apart from the code it checks: `test/bridge/` for the bridge, `test/src/` for the app's model, and `test/fakes/` for what the tests run against. Nothing in it reaches a box.

- **Sessions** (`test/bridge/sessions-*.test.mjs`, `endpoints.test.mjs`): the real bridge in the test's own process, with ssh2 swapped for a fake (`test/fakes/ssh2.mjs`) that opens no socket. Its boxes are made up (`box-1.t1.test` …) and their runs go to a temp folder. Six people (physical views and Codex sessions) on one box, and six boxes at once, each held by six: one SSH login and one snapshot a box, whatever the number of people, one box's people never touching another's, the bridge quick to answer, and nothing left open once everyone leaves. Also a box that refuses the login, drops the connection, never answers a command or is slow to prompt; shows, pulls and baselines asked for at once; terminals and terminal windows; and run files broken by hand, which never take the bridge down.
- **Recorded runs** (`runs.test.mjs`, `templates.test.mjs`, `test/src/smoke.test.ts`, `l0.test.ts`): box 3's runs as `/run` serves them, the light and the L0 path on them, and every TTP template against its fixture. The bridge ones need `npm run bridge:setup`'s Python, and are skipped without it.
- **Units:** each module's corner cases: the CLI index match, tables, the history and its episodes, the recorder, wiring inference, the poller's shells, typed and asked shows, terminal windows, and the app's catalog, rules, discovery, light, routing and store.

A test opens a session only through the fake ssh2, on a made-up host: never a real host or IP.

## Docs

- [Guide](docs/guide.md): how it works today: use, catalog, rules, poller and code
- [Roadmap](docs/roadmap.md): the iterations, Goal 2.5 and the ideas backlog
- [Decision log](docs/decisions.md): what was decided, when and why, and what is still open
- [Box 3 capture plan](docs/plans/box3-capture.md): the current plan, the recorder and Iter 3's first hovers
- [CLI data schemas](docs/reference/cli-data-schemas.md): the JSON schemas for branch, index, observed and merged
- [Archive](docs/archive/): built plans, kept as they were (the original idea, the MVP plan, the CLI plan)

Plans move to the archive once they are built; the guide and the roadmap stay current.

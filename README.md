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
npm test           # smoke tests
npm run build      # typecheck and production build in dist/
npm run sync:auto  # run all catalog sync steps (platform + linecards + CLI)
npm run sync:platform  # regenerate catalog/streams.json and catalog/<stream>/chassis.json from ../IIVI_Platform profiles
npm run sync:cli       # regenerate catalog/<stream>/cli.json from ../IIVI_Platform profile XML
npm run sync:cli-data:csp # generate CSP branch/index/observed/merged artifacts under data/
npm run sync:linecards # regenerate catalog/<stream>/linecards.json and catalog/<stream>/pluggables.json from ../IIVI_Platform profiles
```

`npm run dev`, `npm run build` and `npm test` run `sync:auto` first when `../IIVI_Platform/profile/cu` is present.

For hardware catalogs, `catalog/<stream>/{chassis,linecards,pluggables}.json` is authoritative when present; `catalog/common/*` is fallback only.
`linecardMappingComplete` means every vendor type had a profile-backed mapping (including `lc-<vendor>` fallback ids).
`knownLinecardMappings`/`fallbackLinecardMappings` and `knownMappingComplete` show how much of that mapping came from explicit known-name overrides.

## Docs

- [Guide](docs/guide.md): how to use it, plus the catalog, rules and code
- [MVP plan](docs/mvp-plan.md), from the [original idea](docs/idea.md)
- [CLI plan](docs/cli-run-plan.md): the command book, Run on a lab box, the C++ CLI and AAA
- [CLI data schemas](docs/cli-data-schemas.md): exact JSON schemas for branch/index/observed/merged

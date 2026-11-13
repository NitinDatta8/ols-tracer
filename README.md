# OLS Tracer

A Packet Tracer–style web app for optical line systems: put chassis, linecards and pluggables on a canvas, wire fiber from Tx to Rx, and run each part's CLI command on a lab box.

## Setup

1. Install [Node.js](https://nodejs.org) 22.12 or newer, Python 3, git and the [GitHub CLI](https://cli.github.com).
2. Get the code:
   ```sh
   gh auth login                        # once per machine
   gh repo clone NitinDatta8/ols-tracer
   cd ols-tracer
   npm install
   npm run bridge:setup                 # the bridge's Python venv, with TTP
   ```
3. For a lab box only:
   ```sh
   cp bridge/.env.example bridge/.env   # set BOX_USER and BOX_PASSWORD (or BOX_KEY); git-ignored
   ```

## Run

1. `npm run bridge`. It serves the lab, `catalog/csp/lab.olst.json` (the Horsham lab: transport and transmission), and saves changes to it as they are made: commit the file to share them.
2. In a second terminal, `npm run dev`, then open http://localhost:5173. The lab opens locked: **🔒 Locked** in the top bar unlocks it with the lab's password, to add, delete or move a chassis or a rack. Without the bridge, the page shows its last copy of the lab, read-only.
3. For a lab box, click its device, then **Connect** next to its IP. The machine must reach the box over SSH.

## Test

```sh
npm test         # everything in test/, about 40 s, no box needed
npm run build    # typecheck and production build
```

## Docs

- [Guide](docs/guide.md): how it works
- [Roadmap](docs/roadmap.md): what is left and what is next
- [Decisions](docs/decisions.md): what was decided, and why
- [Notes](docs/notes.md): requests not planned yet
- [Reference](docs/reference/): CLI data and knowledge schemas
- [Archive](docs/archive/): finished plans and the full decision log

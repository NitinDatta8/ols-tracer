# OLS Tracer

A Packet Tracer–style web app for optical line systems: put chassis, linecards and pluggables on a canvas, wire fiber from Tx to Rx, and run each part's CLI command on a lab box.

## Setup

1. Install [Node.js](https://nodejs.org) 22.12 or newer, git and the [GitHub CLI](https://cli.github.com). For a lab box, also Python 3.
2. Get the code:
   ```sh
   gh auth login                        # once per machine
   gh repo clone NitinDatta8/ols-tracer
   cd ols-tracer
   npm install
   ```
3. For a lab box only:
   ```sh
   cp bridge/.env.example bridge/.env   # set BOX_USER and BOX_PASSWORD (or BOX_KEY); git-ignored
   npm run bridge:setup                 # a Python venv with TTP
   ```

## Run

1. `npm run dev`, then open http://localhost:5173.
2. **Open** → `examples/csp.olst.json` for Horsham setup (transport + transmisison lab).
3. For a lab box, run `npm run bridge` in a second terminal. Click a device, type the box's IP in the header and click **Connect**. The machine must reach the box over SSH.

## Test

```sh
npm test         # everything in test/, about 30 s, no box needed
npm run build    # typecheck and production build
```

## Docs

- [Guide](docs/guide.md): how it works
- [Roadmap](docs/roadmap.md): what is left and what is next
- [Decisions](docs/decisions.md): what was decided, and why
- [Notes](docs/notes.md): requests not planned yet
- [Reference](docs/reference/): CLI data and knowledge schemas
- [Archive](docs/archive/): finished plans and the full decision log

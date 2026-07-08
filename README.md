# Corgi Console

A keyboard-first sales cockpit for trucking-insurance BDR teams. Dial queues ranked by live
buy-signals (cancellations, suspensions, renewal windows, new authorities), one-key call logging,
per-lead history timelines, objection playbooks on screen, follow-up tasks, and a free-data
lead pipeline — all local, all SQLite, no cloud.

Built with Tauri 2 (Rust) + React 19 + TypeScript + Vite. macOS (Apple Silicon).

## Install (fastest — for the team)

1. Download `Corgi.Console_x.y.z_aarch64.dmg` from **[Releases](../../releases)**.
2. Drag **Corgi Console** to Applications.
3. First launch: the app is not notarized, so macOS will complain. **Right-click the app →
   Open → Open** (once), or run:
   ```bash
   xattr -cr "/Applications/Corgi Console.app"
   ```
4. Launch. The app creates its data folder at `~/Desktop/corgi/corgi-os-data/` and an empty
   database on first run.

> Apple Silicon (M-series) only. Intel Macs need a source build (below) with an x86_64 target.

## Get leads in

Two options:

- **CSV import** — drop `truckers.csv` / `brokers.csv` into `~/Desktop/corgi/corgi-os-data/`
  and click **⟳ Re-import CSVs** on the Today view.
- **Built-in pipeline (free data)** — clone this repo to `~/Desktop/corgi/corgi-os/` and the
  **Full refresh** button will run the Python pipeline: FMCSA/Socrata signal-first fleet pull
  (cancellations → suspensions → renewal wire → new authorities) and a multi-source broker
  discovery/merge. Python 3.9+, standard library only; a free
  [Socrata app token](https://dev.socrata.com/docs/app-tokens) in `SOCRATA_APP_TOKEN` raises
  the rate limit but is optional.

## Using it

| View | Key | What |
|---|---|---|
| Today | `1` | Daily meters, due follow-ups, floor intel, one-click refresh |
| Dial (fleets) | `2` | Signal-ranked queue, scripts per angle, objection turns, one-key logging |
| Brokers | `3` | Partner-recruitment queue with broker-specific objections + stage pipeline |
| Pipeline / Validate / Intel / Stats | `4–7` | Deals, data hygiene, floor telemetry, numbers |
| Revive | `8` | Abandoned-quote rescue flows |

In the dial cockpit: `j/k` move · `c` copy number · `h` history timeline · `s/o/q/m/g/v/e` panes ·
`A G D B I C V N @ X` log outcomes (No answer, Gatekeeper, Decision-maker, Meeting, Not interested,
Callback, Voicemail, **Bad #**, **Emailed**, DNC) · every log is undoable.

Every call outcome updates lead lifecycle automatically (attempts, cool-downs, recycling,
broker stage advancement) and lands in a per-lead **History** timeline (`h`) — editable notes,
same-day outcome correction, full undo log.

## Build from source

```bash
# prereqs: Node 20+, Rust stable, Tauri CLI deps (https://tauri.app/start/prerequisites/)
npm install
npm run build          # typecheck + bundle frontend
npx tauri build        # produces .app + .dmg under src-tauri/target/release/bundle/
```

Dev loop: `npx tauri dev`. UI regression suite (Playwright + a mock Tauri bridge over your CSVs):
`node tests/e2e.mjs`.

## Architecture

```
React view (src/views/*.tsx)
  → src/api.ts invoke wrapper (every error → toast; nothing silent)
  → Rust command in src-tauri/src/lib.rs (the ONLY layer touching fs/db/processes)
  → SQLite (~/Desktop/corgi/corgi-os-data/console.db, WAL) — leads, activities (append-only),
    meetings, deals, tasks, settings, undo_log, leads_fts (FTS5)
```

- Angle/priority computed once in Rust (`compute_signals`) — every screen agrees.
- Every mutation is transactional and writes a typed `undo_log` entry.
- Schema migrations are versioned (`user_version`), transactional, and drift-safe
  (`add_column_if_missing`).
- Shared timeline/task components under `src/activity/` render identically everywhere.

## Customizing for your team

- **Scripts, objections, email templates**: all plain data in `src/content.ts`
  (fleet objections, broker objections, agent Q&A, voicemail scripts, templates).
- **Floor intel** on the Today view: edit `FLOOR_INTEL` in `src/content.ts`.
- **Benchmarks** (dials/day etc.): `BENCH` in `src/signals.ts`.

## License

MIT

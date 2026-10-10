# RESQ Mumbai — climate-aware emergency response (HC-05) · research simulation

> **RESEARCH SIMULATION — NOT FOR REAL EMERGENCY USE.** Nothing here contacts any emergency service.
> Ambulances, incidents, hospital beds, road closures, shelters, clinic sites and flood zones are **simulated**.

A dispatcher decision-support prototype for a hypothetical Kurla–Sion–Chunabhatti monsoon flood. A citizen SOS
page feeds simulated demand into a shared backend. The backend then jointly chooses **ambulance → patient → hospital**
on a real directed OpenStreetMap road graph, subject to:

- ambulance availability (one simultaneous case per ambulance),
- hospital eligibility and simulated free beds,
- confirmed road closures.

It replans whenever the situation changes. Every dispatch needs explicit human approval.

## Run it (two terminals)

```bash
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

- Dispatcher application: http://localhost:5173/ (Dispatch Center, Disaster Simulation, Resource Planning, Analytics & Reports, Data & Sources)
- Citizen SOS (simulation): http://localhost:5173/sos
- API docs: http://127.0.0.1:8000/docs

Backend dependencies are pinned in `backend/requirements.txt` (runtime) and `backend/requirements-dev.txt` (+ tests).
`osmnx` is only needed to re-fetch OSM data. To create the environment on a new machine (Python 3.14):

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

Offline fallback: `RESQ_SYNTHETIC=1` (or a missing `data/osm_graph.json`) loads a generated grid. The UI then labels it
**SYNTHETIC ROAD NETWORK**.

## Interface

Dispatcher application (`frontend/src`), styled after `reference/approved_dispatch_ui.png`:

| Route | Section | What it does |
|---|---|---|
| `/` | Dispatch Center | Summary cards, map with layer panel, incident queue, selected incident (Recommendation / Details / History), ambulance → patient → hospital chain, approval, route preview, backend reasons |
| `/simulation` | Disaster Simulation | Add emergency, optimise, road and flood-zone closures (confirmed), reopen, hospital capacity, simulation clock, reset |
| `/resources` | Resource Planning | Ambulance positioning, evacuation routes, temporary medical sites, fleet and hospital status |
| `/analytics` | Analytics & Reports | Optimiser vs FIFO and priority-first baselines (live), seeded benchmark suite, event log |
| `/sources` | Data & Sources | Provenance labels, graph metadata, hazard context, safety boundaries |
| `/sos` | Citizen SOS | Standalone simulated SOS page (opens in a new tab from the sidebar) |

- One polling loop (`store.tsx`) serves every page. Out-of-order responses are ignored.
- If the backend stops answering for 10 s, a "connection lost" banner appears and all state-changing controls are
  disabled.
- Display logic is in `lib/derive.ts` and is unit-tested. The backend stays authoritative: the frontend never
  computes routes or allocations.

## Deploy (Render backend + Vercel frontend)

The backend keeps the live scenario **in memory**, so it must run as **one long-running process**. Serverless
functions (e.g. Vercel's) would lose or split state between invocations. The frontend is a static site.

1. **Backend on Render (free):** Render dashboard → **New → Blueprint** → pick this repo. `render.yaml` creates
   `resq-mumbai-api`: rootDir `backend`, `pip install -r requirements.txt`, `uvicorn app.main:app --host 0.0.0.0 --port $PORT`,
   Python 3.14.2. Wait for the deploy, then open `https://<service>.onrender.com/api/state` and check it returns JSON.
2. **Frontend on Vercel:** set the project's Root Directory to `frontend` (Vite preset: `npm run build` → `dist`).
   The backend URL comes from `frontend/.env.production` (`VITE_API_BASE=https://resq-mumbai-api.onrender.com`). Vite
   reads it at build time, so pushing to `main` is enough. To use a different backend, edit that file, or set `VITE_API_BASE`
   in **Vercel → Settings → Environment Variables** (which overrides it) and redeploy. GitHub repository/environment
   variables are *not* seen by Vercel builds. `frontend/vercel.json` rewrites all paths to `index.html`,
   so `/sos` works on direct load.
3. CORS is open (`*`) on the API; the simulation has no authentication or personal data.

Notes:
- Render's free tier sleeps after ~15 min idle. The first request then takes ~1 min, and the scenario restarts from
  its deterministic initial state. Open `/api/state` a minute before a demo.
- Without `VITE_API_BASE`, a hosted frontend shows "No backend configured" (the `/api` proxy exists only in `npm run dev`).

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
```

```bash
cd frontend && npm run build && npm run lint && npm test
```

The backend suite covers the 16 acceptance tests in `docs/ACCEPTANCE_TESTS.md`, plus 150 randomized brute-force optimality
checks, an end-to-end runbook flow, simulation-clock/rerouting tests and a seeded benchmark fairness test.
`backend/smoke_live.py` runs the runbook flow against a running server. `backend/benchmark_report.py` regenerates
`docs/BENCHMARK_RESULTS.md`. A demo click path is in `docs/DEMO_CLICKPATH.md`. `npm run build` runs `tsc -b` and the Vite production build.

## What is real vs simulated

| Layer | Label | Source |
|---|---|---|
| Road network (928 nodes / 1,773 directed edges) | **REAL MAP GEOMETRY** | OpenStreetMap via OSMnx 2.1.1, retrieved 2026-10-09, bbox 72.855–72.905 E, 19.035–19.080 N, drivable classes, largest strongly-connected component (`backend/fetch_osm.py`) |
| Hospital names & locations (5 used) | **OSM-MAPPED LOCATION** | OSM `amenity=hospital`, retrieved 2026-10-09 (`backend/fetch_facilities.py`) |
| Hospital beds & accepted emergency types | **SCENARIO / SIMULATED** | `backend/data/scenario.json` — *not* real facility status |
| Ambulances, incidents, SOS, closures, shelters, clinic & staging sites, flood zones | **SCENARIO / SIMULATED** | scenario file + dispatcher simulation controls |
| Rainfall | **THIRD-PARTY FORECAST · context only** (or UNKNOWN if offline) | Open-Meteo forecast API; displayed only, never used for routing/closures |
| Tide | **UNKNOWN / NOT CONNECTED** | no verified feed |

Travel time = edge length ÷ **assumed** free-flow speed by road class (trunk 40, primary 35, secondary 30,
tertiary 25, unclassified 20 km/h; links slower). This is not live traffic.
Map data © OpenStreetMap contributors, ODbL 1.0. Rainfall © Open-Meteo, CC BY 4.0.

## How decisions are made

- **Exact optimiser** (`backend/app/optimizer.py`): branch-and-bound over ambulance × hospital options per unapproved
  incident (planning window ≤ 10 simultaneous incidents). The objective is lexicographic:
  1. Maximise incidents served, HIGH priority first, then MEDIUM, then LOW.
  2. Minimise Σ priority × (response time + transport time).
  3. Break ties deterministically by ID.

  Constraints: one incident per ambulance, beds ≤ simulated free beds, hospital eligible for the incident type, and both
  legs reachable on open directed edges. Tests check it against brute-force enumeration.
- **Baseline** (same constraints and travel times): handle incidents in arrival order. Each takes the nearest available
  ambulance, then the nearest eligible hospital with a free bed. The dashboard shows actual measured values for both;
  the baseline can tie the optimiser.
- **Replanning**: a new SOS, closure, capacity change, priority change or approval recomputes all *unapproved*
  recommendations from server state. Superseded options keep an explanation (closed road, hospital full, unit
  re-allocated). **Approved dispatches are never changed automatically.** They are flagged for operator review, with an
  optional suggested reroute the operator can accept.
- **Simulation clock** (`+1 min` / `+5 min`): approved units move along their approved routes.
  - A closure behind a unit is ignored.
  - A closure ahead flags the dispatch for review. The unit continues only to the **last point from which a detour
    still exists** and holds there (BLOCKED).
  - The suggested reroute starts from the unit's current position. After the dispatcher accepts it, the unit continues.
  - On arrival at the hospital the unit waits for the dispatcher to confirm handover.
- **Priority**: an SOS arrives as MEDIUM/unconfirmed. The dispatcher sets or confirms it; approving also confirms it.
  There is no automated medical triage.
- **Infeasibility** is explicit. Example reasons: "All eligible hospitals report zero available beds" or "No available
  ambulance can reach this location on open roads".

### Minimal remaining HC-05 functions

- **Evacuation**: routes each scenario origin to the fastest reachable shelter with enough simulated capacity, avoiding
  closed edges. It reports when an origin is cut off.
- **Temporary medical site**: a coverage heuristic over 4 predefined candidate sites. Demand = unresolved incidents
  (weight = priority) plus evacuation clusters (people / 50). The site with the most demand weight within 10 min on open
  roads wins. The dispatcher can **approve deployment**: the site becomes a simulated temporary post (4 beds,
  `medical` cases only), and the optimiser can then assign patients to it. Not a full medical-logistics model.
- **Vehicle positioning**: computes coverage gaps (demand with no available unit within 5 min). It recommends moving one
  idle ambulance to the predefined staging site that most increases covered weight. The dispatcher approves the move.

## API

- `GET  /api/state` · `GET /api/graph` · `GET /api/metrics` · `GET /api/weather` · `GET /api/clinic/plan` · `GET /api/positioning`
- `POST /api/sos` `{location_id, emergency_type, client_token}` → request ID. A duplicate within 60 s returns the same ID.
- `GET  /api/sos/{id}` → status
- `POST /api/optimize` · `POST /api/reset`
- `POST /api/simulate/close-road` `{edge_ids}` or `{decision_id, leg}` · `/simulate/flood-zone` `{zone_id}` · `/simulate/reopen-roads`
- `POST /api/simulate/fill-hospital` `{hospital_id}` · `/simulate/set-capacity` `{hospital_id, beds}` · `/simulate/add-incident`
- `POST /api/incidents/{id}/priority` · `/decisions/{id}/approve` · `/decisions/{id}/accept-reroute` · `/decisions/{id}/complete`
- `POST /api/evacuation/plan` `{origin_id}` · `/positioning/apply` `{ambulance_id, staging_site_id}` · `/clinic/deploy` `{site_id, beds}`
- `POST /api/simulate/advance` `{seconds}` (simulation clock) · `GET /api/benchmark?seeds=30` (seeded comparison suite)

## Honest limitations

- This is not live data and has no BMC or hospital partnership. Real use needs authorised feeds, clinical/EMS review,
  security, reliability testing and official authorisation.
- No predictive / trained AI model is included. Flood zones are hypothetical rule-based circles and never close roads
  by themselves: the dispatcher must confirm closures.
- Unit movement is a discrete simulation along approved routes at assumed speeds. Positions snap to graph nodes, and
  movement happens only when the dispatcher advances the clock. There is no real-time telemetry.
- Hospital eligibility is a simple per-type list. Real capability (ICU, trauma level) is not modelled.
- Results are measured in simulation only. They make no claim about real response times or lives saved.

Prior art: adaptive emergency management (arXiv:2403.07003). The optimisation methods used are standard; the
contribution is the integrated, explainable, human-approved Mumbai flood workflow.

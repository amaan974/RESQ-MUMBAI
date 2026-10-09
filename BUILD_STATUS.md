# BUILD_STATUS — RESQ Mumbai (HC-05)

Build window started **2026-10-09 18:29 IST**. Feature freeze target 20:04 IST; hard deadline 20:29 IST.
Everything marked PASS below was actually executed. Re-run commands are at the bottom.

## Timeline (actual)
| Time (IST) | Step |
|---|---|
| 18:29 | Read CLAUDE.md, docs/*, HC-05 page 5 (extracted via PDFKit), dashboard reference |
| 18:30 | Found cached real OSM drive graph (`backend/data/osm_graph.json`, retrieved 2026-10-09 12:58 UTC, 928 nodes / 1,773 directed edges). No synthetic fallback needed |
| 18:31–18:41 | Backend: graph/routing (NetworkX Dijkstra with closure-aware weights), exact branch-and-bound optimiser + FIFO baseline, scenario state/replanning, FastAPI. OSM hospital locations fetched (`data/osm_hospitals.json`) |
| 18:41 | **First pytest run: 174 passed** |
| 18:43 | Fix: optimiser bound was weak → 9-incident benchmark took 4.3 s. Added a capacity-aware bound → 3.5 ms; brute-force checks still pass |
| 18:44–18:46 | Frontend: dashboard (`/`), citizen SOS (`/sos`), Leaflet map, API client. `npm run build` PASS (after one unused-import fix) |
| 18:47–18:49 | Browser test of the full demo flow in the real UI (details below) |
| 18:49–18:51 | Approval confirms priority; positioning ignores approved incidents; end-to-end runbook test; dispatcher-confirmed flood-zone closure; Open-Meteo rainfall context (display only) |
| 18:52 | Live HTTP smoke test (`backend/smoke_live.py`) PASS. Fix: AMB-02's base snapped to the same node as Bhabha Hospital (identical 83.7 s legs). Moved the simulated base |
| 18:53–18:55 | Seeded benchmark suite (60 runs) + **second, stronger baseline** (priority-first greedy). `docs/BENCHMARK_RESULTS.md` generated |
| 18:57–19:01 | Simulation clock: approved units move; closure behind ignored; closure ahead → review + hold. **Bug found by test**: block time counted a closed edge already behind the unit (unit froze). Fixed |
| 19:01 | UI test exposed an unrealistic hold: on one-way LTT Road the unit drove to the closure with no legal way out. Fix: hold at the **last point where a detour exists**; quick-close prefers mid-route segments ahead of the unit. Regression test added |
| 19:02–19:04 | UI runbook replay with screenshots (`docs/screenshots/`). Found dashboard crash on schema skew during backend restart → defensive rendering + ErrorBoundary. Approval now updates the stale "priority unconfirmed" text |
| 19:04–19:05 | Deployable temporary medical post (dispatcher-approved; `medical` only; usable by the optimiser) + test |
| 19:06 | Synthetic-fallback full-scenario test. Offline map mode (tiles toggle + local OSM graph layer) verified in the browser. Permanent OSM attribution added |
| 19:07–19:09 | **Robustness fix from a stress test**: one 8-incident instance took 1.6 s / 852k nodes, and hitting the node limit would have raised a server error. Added a dynamic resource-aware bound, a priority-greedy incumbent and an anytime fallback (best feasible plan, labelled "optimality not proven", never raises). Worst case now 21–32 ms, all 180 stress instances proven optimal; the benchmark results are identical (exactness check) |
| 19:09 | **Feature freeze** (scheduled 20:04). Final verification below |

## Acceptance tests (docs/ACCEPTANCE_TESTS.md)
| # | Test | Status | Evidence |
|---|---|---|---|
| 1 | SOS_INTAKE | PASS | `test_sos_intake_and_duplicate_suppression`; UI double-click produced one ID (INC-0003) |
| 2 | GRAPH_PATH | PASS | `test_route_is_contiguous_directed_path_matching_geometry_and_time` (also equals the Dijkstra optimum), `test_decision_routes_are_graph_paths` |
| 3 | CLOSED_ROAD | PASS | `test_closed_road_changes_route`, `test_closed_edge_never_used_by_router`; UI: A H Wadia Marg closed → DEC-0003 superseded, new route |
| 4 | FULL_HOSPITAL | PASS | `test_full_hospital_not_chosen`; UI: HOSP-B full → HOSP-E |
| 5 | AMBULANCE_EXCLUSIVITY | PASS | `test_exclusivity_and_capacity_under_load` (9 incidents, 5 units) |
| 6 | HOSPITAL_CAPACITY | PASS | same test: per-hospital planned ≤ beds and type eligible |
| 7 | ALLOCATION_CORRECTNESS | PASS | `test_allocation_matches_brute_force_on_tiny_graph` (2×2×2 known graph, optimum 700 vs baseline worse), `test_priority_dominates_when_resources_short`, 150 × `test_random_small_problems_match_brute_force` |
| 8 | NO_SOLUTION | PASS | `test_no_solution_when_all_hospitals_full`, `test_no_solution_when_incident_unreachable`, `test_no_solution_via_api` |
| 9 | ADAPTIVE_UPDATE | PASS | `test_adaptive_update_from_server_state` (plan version increments; SOS / closure / capacity / priority) |
| 10 | APPROVAL | PASS | `test_approval_immutable_and_flagged`, `test_superseded_cannot_be_approved`; UI: closure on approved DEC-0006 → unchanged, "Needs operator review" + "Accept suggested reroute" |
| 11 | RESET | PASS | `test_reset_is_deterministic` (IDs, nodes, statuses, beds, decisions, route edges) |
| 12 | BASELINE_FAIRNESS | PASS | `test_baseline_uses_same_constraints`, `test_benchmark_suite_fair_and_exact` |
| 13 | EVACUATION | PASS | `test_evacuation_excludes_closed_and_reports_infeasible`, `test_flood_zone_closure` |
| 14 | CLINIC_CANDIDATE | PASS | `test_clinic_candidate_from_predefined_sites` |
| 15 | FRONTEND | PASS | `npm run build` (tsc -b + vite) PASS. `/sos` and `/` render backend state, verified in the browser. Every button calls a backend endpoint (manual browser check, not an automated UI test) |
| 16 | DATA_LABELS | PASS | `test_data_labels`; banner on both pages; badges REAL MAP GEOMETRY / OSM-MAPPED LOCATION / SCENARIO / SIMULATED / THIRD-PARTY FORECAST · context only / UNKNOWN |

Extra:
- `test_demo_runbook_flow` (end-to-end)
- `test_anytime_fallback_never_raises_and_stays_feasible`, `test_stress_instances_solve_to_proven_optimality` (×3)
- `test_full_scenario_runs_on_synthetic_fallback_and_is_labeled`
- `test_flood_zone_closure`
- `test_weather_failure_is_unknown`
- `test_positioning_returns_rule_and_valid_ids`
- `test_synthetic_fallback_is_labeled`
- `test_zero_length_route`
- Clock: `test_clock_moves_unit_to_hospital`, `test_clock_closure_behind_ignored_ahead_blocks_and_reroutes`, `test_close_on_approved_decision_only_closes_road_ahead`, `test_unit_holds_at_last_divert_point_and_reroutes`
- `test_deploy_temporary_post_feeds_optimiser`

## Latest recorded runs
**Final verification — 2026-10-09 19:09:32 IST**
- `cd backend && .venv/bin/python -m pytest -q` → **188 passed** (4.0 s), 1 deprecation warning from starlette TestClient
- `cd frontend && npm run build` → PASS (tsc -b + vite build)
- `cd frontend && npm run lint` → 0 errors, 1 warning (`react(set-state-in-effect)` on the polling effect; setState happens after an await, so it is intentional)
- `cd backend && .venv/bin/python smoke_live.py` (running server) → **SMOKE PASSED**: SOS INC-0003 → DEC-0003 AMB-02→HOSP-B (171.7 s + 83.7 s) → closure → DEC-0004 avoids it (217.1 s) → HOSP-B full → HOSP-E → approve 200 → reset restores the initial state
- Browser (built-in pane, 1440×900 and 800 px):
  - SOS page → dashboard shows INC-0003 → close road → hospital full → approve.
  - Close road on the approved route: flagged, not changed.
  - Clock +1 min → closure ahead → unit BLOCKED at the last detour point → accept reroute → +15 min → at hospital, awaiting handover.
  - Flood-zone FZ-1 closure (78 directed edges) → seeded suite → deploy temporary post.
  - A fresh tab after the final backend restart shows no console errors.
  - `/sos` at 375 px (mobile): no horizontal scroll, banner visible.
- Solver stress (60 random instances each, 6 units × 6 hospitals): 8 / 10 / 12 incidents → max 21 / 32 / 30 ms, 0 unproven.

## Measured comparison (docs/BENCHMARK_RESULTS.md)
60 runs: 30 seeds × {open roads, all scenario flood zones closed}, 5–9 incidents each, 5 available simulated units, 10 simulated beds.
- **vs FIFO nearest-feasible**: optimiser better in 57, tied in 3, worse in 0. HIGH-priority served 146 vs 108. Mean HIGH response 311.6 s vs 444.4 s.
- **vs priority-first nearest-feasible** (stronger baseline): better in 50, tied in 10, worse in 0.
  - Same HIGH served (146/146) and same total served.
  - Mean HIGH response about equal (311.0 vs 310.4 s — the baseline is marginally faster).
  - Priority-weighted chain cost 8,084 vs 8,731 (−7.4%).
- Conclusion we can honestly state: most of the HIGH-priority gain over FIFO comes from prioritisation. Joint optimisation
  adds a lower total weighted response+transport cost and never does worse. These are simulation measurements only.

## Features
Working and tested:
- SOS → shared backend → exact joint recommendation on the real OSM graph.
- Closure rerouting: per edge, per route segment, or per dispatcher-confirmed flood zone.
- Hospital full / capacity edits trigger re-optimisation.
- Dispatcher priority confirmation.
- Approval, with immutable approved dispatches. They are flagged for review with a suggested reroute; accept-reroute and handover-complete actions exist.
- Explanations for every choice and for every invalidated option.
- Simulation clock with en-route rerouting from the unit's current position.
- Deployable temporary medical post used by the optimiser.
- Three-way comparison on the current state and the stress scenario, plus the seeded suite.
- Evacuation routing with explicit cut-off infeasibility.
- Temporary medical site heuristic.
- Vehicle positioning heuristic with approve-move.
- Event log.
- Deterministic reset.

Not implemented / known gaps:
- Unit movement is discrete (node-snapped), driven by the dispatcher's clock buttons. There is no real-time telemetry.
- Hospital capability is a simple type list (no ICU or trauma level).
- Tide is not connected. Rainfall is third-party forecast context only and never drives decisions.
- No trained or predictive model. Flood zones are hypothetical circles.
- Planning window is capped at 10 simultaneous unapproved incidents. Extras are marked queued, never silently dropped.
- Duplicate-SOS suppression is keyed by a random per-browser token + location + type over 60 s. A shared device could
  suppress a genuine second report.
- If OSM tiles are offline, the base map is blank. Untick "Map tiles" and tick "Routable OSM graph (offline)" to draw the
  cached graph (verified; `docs/screenshots/05_offline_osm_graph_routes.jpg`).
- Rainfall shows UNKNOWN after a backend restart until the dashboard first requests `/api/weather`. It depends on the
  internet and is context only.
- No automated browser (E2E UI) tests. UI checks were manual in the built-in browser.

## Re-run everything
```bash
cd backend && .venv/bin/python -m pytest -q
```
```bash
cd frontend && npm run build
```
```bash
cd backend && .venv/bin/python smoke_live.py
```
```bash
cd backend && .venv/bin/python benchmark_report.py
```
`smoke_live.py` needs the backend running.

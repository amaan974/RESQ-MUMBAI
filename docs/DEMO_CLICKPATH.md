# Demo click path (follows DEMO_RUNBOOK.md; ~90 s core + optional extras)

**Before the jury arrives:**
1. Start the backend and frontend (README).
2. Open `http://localhost:5173/` in one tab and `http://localhost:5173/sos` in a second tab.
3. Click **↺ Reset scenario**.

The red banner stays visible on every page.

| Time | Do | Say / point at |
|---|---|---|
| 0–15 s | `/sos`: **Medical emergency** + **Kurla West** → **SEND SIMULATED SOS** | Request ID (e.g. INC-0003). "Simulation only; no name, phone or GPS collected." Double-click to show duplicate suppression |
| 15–30 s | Dashboard tab | INC-0003 appears in the queue from the backend (2 s polling). Status *recommended*, priority MEDIUM *unconfirmed*. Set it to HIGH in the dropdown to show that the dispatcher sets priority |
| 30–45 s | **⟳ Optimize now** (optional; recommendations recompute automatically) | Recommended card: ambulance → patient (blue) → hospital (green dashed), minutes and km from the OSM graph, reasons list. Header badge: REAL MAP GEOMETRY, 928 nodes / 1,773 directed edges |
| 45–60 s | **Close road on route to patient** | Red closed road on the map. The new decision has a longer time. "Invalidated options" names the closed road. "No route may use a closed directed edge" |
| 60–75 s | **Set HOSP-x full** → then **✓ Approve & dispatch (sim)** | New hospital chosen with the reason. After approval the unit shows as dispatched. "Approval is required; approved dispatches are never changed automatically" |
| 75–90 s | Scroll to **Coordinated optimiser vs nearest-feasible baselines** → **Run seeded benchmark suite** | Actual measured numbers. Be candid: vs priority-first greedy, HIGH-priority coverage is equal and the gain is ~7% lower weighted response+transport cost, never worse |

**Optional extras (if time):**
- **▶ +1 min**, then **Close road on route to patient** on the approved card, then **▶ +1 min** twice. The alert bar
  shows the unit held at the last detour point (BLOCKED). Click **Accept suggested reroute**, then **⏩ +5 min** ×3:
  the unit reaches the hospital and handover needs confirmation.
- **Confirm flood-zone closure** (FZ-1): ~78 directed edges close. Re-planning appears, and the evacuation from
  inside the zone reports *cut off*.
- **Temporary medical site**: the recommended site is shown. **Approve: deploy temporary post** makes it a usable
  simulated facility.
- **Vehicle positioning**: shows coverage gaps. **Approve move** repositions an idle unit.
- **Data sources & labels** table: what is real (OSM roads and hospital locations), what is simulated, and that
  rainfall is third-party context only and tide is not connected.

**Fallbacks:**
- No internet means no map tiles: tick **Routable graph** to draw the cached OSM road graph locally.
- If a demo action fails, use `docs/screenshots/` (genuine captures from this build).
- `cd backend && .venv/bin/python smoke_live.py` proves the flow over HTTP in ~2 s.

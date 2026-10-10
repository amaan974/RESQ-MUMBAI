# Demo click path (follows DEMO_RUNBOOK.md; ~90 s core + optional extras)

**Before the jury arrives:**
1. Start the backend and frontend (README). For the hosted version, open
   https://resq-mumbai-api.onrender.com/api/state a minute early to wake the free backend.
2. Open the dispatcher at `/` in one tab. Open **Citizen SOS** from the sidebar; it opens `/sos` in a new tab.
3. Go to **Disaster Simulation**, choose **Reset scenario** and confirm.

The red simulation notice stays visible on every page.

| Time | Do | Say / point at |
|---|---|---|
| 0–15 s | SOS tab: **Medical emergency** + **Kurla West** → **Send simulated SOS** | Request ID (e.g. INC-0003). "Simulation only; no name, phone or GPS collected." Double-click to show duplicate suppression |
| 15–30 s | **Dispatch Center**: click INC-0003 in the **Incident queue** | It arrived through the shared backend (2 s polling). Priority shows *(unconfirmed)*. Use **Priority** or **Confirm Medium** in the incident header: the dispatcher sets priority |
| 30–45 s | Point at the **Selected incident** panel and map | Ambulance → patient (solid blue) → hospital (dashed green), minutes and km from the OSM road graph. **Why this recommendation** lists the backend's reasons. Top bar: plan proven optimal |
| 45–60 s | **Disaster Simulation** → **Close road on route to patient** | Back in **Dispatch Center**: red closed road; new decision; **History** tab names the invalidated option and the closed road |
| 60–75 s | **Disaster Simulation** → hospital row **Set full**, then **Dispatch Center** → **Approve and dispatch (simulation)** | A new eligible hospital is chosen, with the reason. After approval the unit is dispatched and the progress steps appear |
| 75–90 s | **Analytics & Reports** | Live three-way comparison and the seeded suite. Be candid: against priority-first greedy, High-priority coverage is equal; the gain is lower weighted response + transport cost, never worse |

**Optional extras (if time):**
- **Disaster Simulation**: **Advance 1 min**, **Close road on route to patient** for the approved dispatch, then
  **Advance 1 min** twice. **Dispatch Center** shows the amber review alert and the unit holding at the last detour
  point. **Accept suggested reroute**, advance 5 min ×3, then **Confirm hospital handover**.
- **Disaster Simulation** → **Confirm closures in zone** (FZ-1, with confirmation): ~78 directed edges close.
  **Resource Planning** shows the evacuation origin inside the zone as *cut off*. **Reopen all roads** restores it.
- **Resource Planning**: **Approve temporary post** makes the recommended site a usable simulated facility;
  **Approve move** repositions an idle ambulance when the coverage heuristic finds an improvement.
- **Data & Sources**: what is real (OSM roads and hospital locations), what is simulated, rainfall as third-party
  context only, tide not connected.

**Fallbacks:**
- No map tiles: open **Layers** on the map, untick **Base map tiles (online)** and tick **Routable OSM graph (offline)**.
- Backend restarting: the app shows a "Backend connection lost" banner, keeps the last state visible and disables
  actions until the connection returns.
- If a demo action fails, use `docs/screenshots/` (genuine captures from this build).
- `cd backend && .venv/bin/python smoke_live.py` proves the flow over HTTP against a local backend in ~2 s.

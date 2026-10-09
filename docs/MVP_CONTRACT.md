# RESQ Mumbai — Binding MVP contract

## Product and real-world scenario
Mumbai monsoon rain plus high tide can increase flood and access risk. In a **hypothetical** Kurla–Sion–Chunabhatti scenario, an SOS reaches a dispatcher; a road becomes inaccessible; the initially selected hospital loses capacity; additional demand arrives. RESQ recommends the **ambulance -> incident -> hospital** chain that remains feasible, then updates **unapproved** choices as conditions change. All command actions require explicit dispatcher approval. This is a decision-support demonstration, not live response management.

## Core UX (MUST)
**Citizen SOS (`/sos`):** emergency type (medical/flood rescue), one of three predefined demo locations, Send SOS, request ID/status, explicit 'SIMULATION ONLY — DOES NOT CONTACT EMERGENCY SERVICES'. No patient name, phone number, medical diagnosis, precise GPS requirement or actual dispatch messaging. Repeated-click suppression.

**Dispatcher (`/`):** map, incident queue, available ambulances, available hospital capacities, calculated recommended ambulance + route to incident + route to hospital, basic reasons, timestamp/data badges, Approve, Close a road **used by current recommendation**, Set selected hospital to full, Add emergency, Reset. Changes must hit a shared backend; refresh/polling is acceptable. Controls must work.

## Core engine (MUST)
- A real directed OpenStreetMap **driving network** for a bounded pilot if obtainable; cached offline. Geometry, snapped coordinates, graph edge IDs and route polylines must be derived from graph. If unavailable, explicit synthetic directed connected graph fallback, visibly marked.
- Road travel-time weighting using length / documented assumed speed (not simulated actual traffic). No route may traverse a closed directed edge. Zero-length/unreachable cases handled honestly.
- Jointly evaluate **available ambulance -> SOS location -> medically eligible hospital** paths with hospital capacity and one-ambulance-one-simultaneous-case constraint. For 3–5 vehicles/incidents/hospitals, an exact enumerator/backtracker is fine. Prioritize high-priority unmet incidents, then minimize total feasible estimated travel; deterministic tie-breaks.
- Status lifecycle: SOS pending -> reviewed -> recommended -> approved / infeasible; no silent changes to approved decisions. Incident priority set/confirmed by dispatcher; no AI autonomous medical triage.
- New SOS, relevant road closure, hospital availability change triggers new pending recommendations; explain invalidated options.
- Closest-feasible baseline **with same capacity and closure constraints** vs global coordinated planner. Show actual measured values; never invent % improvement. Baseline can tie or beat optimiser on an individual case.

## Remaining official HC-05 outputs (MINIMAL BUT FUNCTIONAL)
- **Vehicle positioning:** Show coverage gaps and recommend one waiting location for an idle unit using a clearly documented candidate-site/demand heuristic; if time is short, prioritize working dispatch.
- **Evacuation routes:** Compute one graph path from simulated evacuation origin to a reachable predefined shelter with closed edges excluded.
- **Temporary medical resources:** Select one of a few candidate temporary medical site positions to cover scenario demand; explain the simple rule. Do not call this a comprehensive medical logistics solution.

## AI (CONDITIONAL STRETCH, NOT A CLAIM)
Do not train or label a fabricated model as AI. Live/observed rainfall and tides may be presented as context only after verifying a source. A transparent **scenario flood-risk layer** is acceptable and must be labeled rule-based/simulated. If suitable historically labeled Mumbai road/flood outcomes are sourced AND core tests pass, a supervised model with held-out evaluation may be added. Risk predictions must NOT override confirmed road closures, capacity or clinical eligibility.

## Proposed project contracts
API minimum:
- `GET /api/state`
- `POST /api/sos`
- `POST /api/optimize`
- `POST /api/simulate/close-road`
- `POST /api/simulate/fill-hospital`
- `POST /api/simulate/add-incident`
- `POST /api/decisions/{id}/approve`
- `POST /api/reset`
- `GET /api/metrics`
A predictable request/response model and error handling matter more than exact endpoint names.

Core entities: road directed edge {edge_id,u,v,travel_time,closed}; ambulance {id,node,available}; incident {id,node,type,priority,status}; hospital {id,node,eligible_types,capacity}; decision {incident_id,ambulance_id,hospital_id,route_edge_ids,polyline,estimated_ambulance_time,estimated_transport_time,reason,status}; source metadata {source,type,observed_at,simulated}.

## Priority/cut list
P0: SOS -> persistent in-session incident -> computed map route -> ambulance/hospital recommendation -> closure -> recalculation -> tests -> reset.
P1: baseline, hospital fullness, dispatcher approval, evacuation and clinic minimal demo.
P2: vehicle repositioning, polished analytics, optional real weather retrieval.
CUT under 2 hours: trained ML without labels, voice first-aid AI, real GPS tracking, real SMS, real emergency-number integration, federated learning, IoT, city-wide live deployment, blockchain, autonomous dispatch.

## Strict user reality
The intended future operator is a BMC-type disaster or ambulance dispatch control-room user, **not an established BMC partner**. A citizen SOS page is a simulated demand input. Real-life use would require verified emergency feeds, hospital agreements, access/security controls, reliability testing, accessibility and official authorization.

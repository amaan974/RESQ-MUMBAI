# RESQ Mumbai — Claude Code project instructions

## Objective
Build a **functional, locally runnable, simulated** emergency decision-support MVP for FUSION 2026 / HC-05. This is not a production emergency service. Its principal user is a municipal/ambulance dispatcher. A citizen SOS page supplies simulated incoming demand.

First principles: in changing floods, find the best **feasible** allocation of limited ambulances, accessible road routes, eligible hospital capacity, evacuation paths and temporary medical support while preserving human decision authority. The purpose is **decisions**, not merely displaying maps or weather alerts.

## Required reading (in this order)
1. `docs/MVP_CONTRACT.md` — scope, strict features, engineering choices, cut list.
2. `docs/DATA_AND_SAFETY.md` — data trust, sourcing and no-fake-AI rules.
3. `docs/ACCEPTANCE_TESTS.md` — objective pass/fail requirements.
4. `docs/DEMO_RUNBOOK.md` — scenario the jury must be able to execute.
5. `reference/HC05_OFFICIAL_PROBLEM.pdf` — source problem statement, page 5.
6. `reference/dashboard_reference.png` — visual inspiration, NOT hardcoded output.

If anything conflicts, **official problem statement and safe/accurate claims** take priority. The specification defines the MVP scope, not changes to the problem statement.

## Tech and simplicity
One React + TypeScript + Vite + Leaflet frontend; one Python + FastAPI + NetworkX backend; simple in-memory scenario state/JSON, pytest. OSMnx optional for fetching and caching a small directed OSM road graph. Avoid microservices, authentication frameworks, Firebase, Docker requirements, LLM agents and premature ML training. Use a correct small exact enumeration/backtracking assignment instead of a large solver if faster.

## Execution rules
- Start with data contracts, road graph and working SOS-to-recommendation calculation. Then frontend.
- Implement → run test → inspect failure → fix → retest. Record **actual** test results and limitations in `BUILD_STATUS.md`.
- Test API and algorithm in isolation before UI polish. Never fake successful output, model metrics, hospital data or route geometry.
- A confirmed road closure or hospital capacity=0 must change feasible decisions or explicitly produce 'no feasible recommendation'.
- Keep approved dispatches immutable by automated replanning; alert for review instead.
- A reported SOS request must not contact real-world services. Keep citizen data synthetic and include a clear DEMO ONLY banner.
- Do not silently mislabel a synthetic graph as Mumbai's actual street network.
- Ask before destructive terminal actions or overwriting existing user files.
- Operate within competition rules: code developed during authorized hackathon window, open-source attribution, understandable team contributions.

## Two-hour timeboxes (targets, not guarantees)
0–10m contracts/setup; 10–40m backend graph/routing/optimizer/tests; 40–65m command dashboard; 65–80m SOS integration; 80–95m event simulation and minimal evacuation/clinic features; 95–110m tests; 110–120m demo/freeze. At 95m STOP adding features. If graph acquisition fails after ~8m, explicitly label and switch to offline **synthetic demonstration graph**; preserve functional optimization.

## Required finish state
Runnable backend/frontend with startup instructions, reproducible reset, tests, source and assumption disclosures, working features and known gaps. Do not say 'working' unless tested.

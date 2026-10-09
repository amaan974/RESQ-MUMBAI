# Objective acceptance tests — no fake functionality

Implement as pytest API/engine tests plus frontend typecheck/build. Execute them; do not mark passing unless run.

1. `SOS_INTAKE`: POST valid SOS -> unique ID/pending incident; dashboard state reflects it. Duplicate rapid submission is suppressed.
2. `GRAPH_PATH`: selected route edge IDs form a contiguous directed path; polyline matches path geometry; travel time is calculated from edges.
3. `CLOSED_ROAD`: close a currently used edge -> next recommended path never contains it; route changes or 'no feasible route'.
4. `FULL_HOSPITAL`: set selected hospital capacity to zero -> no *new* recommendation chooses it; alternative or clear infeasibility.
5. `AMBULANCE_EXCLUSIVITY`: no available ambulance allocated to two simultaneous unapproved incidents.
6. `HOSPITAL_CAPACITY`: number of new simultaneous planned admissions <= simulated available beds, and required emergency type supported.
7. `ALLOCATION_CORRECTNESS`: for tiny known graph with 2 incidents, 2 ambulances, 2 hospitals, compare engine result against brute-force feasible enumeration. Verify weighted objective and priority.
8. `NO_SOLUTION`: no resource/route possible -> explicit error/status; never fabricate assignment.
9. `ADAPTIVE_UPDATE`: new SOS, closure, capacity change recomputes pending decisions from modified server state (not frontend constants).
10. `APPROVAL`: operator approves one recommendation; status is recorded. Automatic reoptimization never silently changes approved allocation; any invalidated route is flagged for operator review.
11. `RESET`: reset restores identical deterministic scenario IDs, nodes and initial resource state.
12. `BASELINE_FAIRNESS`: nearest-feasible baseline sees same road/hospital constraints and scenario; show actual metrics even if no improvement.
13. `EVACUATION`: shelter route excludes closed edges and returns explicit infeasibility if unreachable (P1).
14. `CLINIC_CANDIDATE`: choose from predefined valid site set; return reason and documented demand/coverage heuristic (P1).
15. `FRONTEND`: React build + TypeScript check, URL /sos and / display backend state, no decorative action controls masquerading as functional.
16. `DATA_LABELS`: visible simulation banner; simulated capacity and flood overlays not labeled live; fallback graph labeled synthetic.

## Suggested automated verification
- `pytest -q` from backend/env (record command used)
- `npm run build` from frontend
- `curl` or TestClient API smoke test for SOS -> optimize -> close edge -> re-optimize -> fill hospital -> reset
- Record test outputs in `BUILD_STATUS.md` with date/time and known failures.

## Failure response
Core P0 failure => stop adding secondary features and repair it. Don't claim a passing MVP if SOS and computed optimization aren't connected. A pretty dashboard is NOT a substitute.

# 90-second jury demo — hypothetical Mumbai flood scenario

**All locations/roads are real only if the corresponding data source is verified; all operational inputs are simulated.** Show simulation banner at every step.

1. **0–15 s:** Open citizen `/sos`; choose Kurla / Medical Emergency; send simulated SOS. Note unique request ID.
2. **15–30 s:** Switch to dashboard; incoming request appears from backend without manually creating frontend marker.
3. **30–45 s:** Press Optimize; show selected available ambulance, computed path to patient, feasible hospital and subsequent path, explanation.
4. **45–60 s:** Close one edge on the current path; show route changed or explicit infeasibility. Explain graph constraints.
5. **60–75 s:** Mark selected hospital full; show new feasible hospital or explicit infeasibility. Check dispatcher approval flow.
6. **75–90 s:** Show nearest-feasible baseline vs computed optimiser, using actual measurements. Cite what was simulated and what was real.

## Judge Q&A
**Is this live BMC/ambulance data?** No. Real mapped geography (when fetched); simulated units/capacity/incidents/closures. Real deployment requires authorized feeds and validation.
**Is the AI actually trained?** Only if there is a validated trained model with test evidence. Otherwise this is an adaptive optimization prototype with transparent climate-risk scenarios.
**What is novel?** Mumbai-specific flood-disruption workflow integrating SOS, feasible ambulance/hospital assignment, dynamic road updates, explainable human-approved decisions and reproducible comparisons. Underlying optimization methods are known.
**What about other HC-05 tasks?** Demonstrate small evacuation route and temporary clinic candidate selection if implemented; do not imply production-scale optimization.
**How does it reduce harm?** It targets potential delays and infeasible assignments, but can only claim operational improvements actually measured in simulation, not lives saved.

## Backup plan
Cache graph and frontend assets where possible; keep seeded deterministic scenario and Reset; capture genuine screenshots as fallback. Never swap algorithm outputs for fake ones to mask errors.

# Data plan, provenance, realism, and safety

## Grounded data available to pursue
1. OpenStreetMap (https://www.openstreetmap.org/): roads and some mapped hospitals; use OSMnx only if fetch works; cache graph, record retrieval date and license attribution. Mapped hospital locations are **not live capacity**.
2. BMC Disaster Management (https://dm.mcgm.gov.in/): weather/tide information is a potential public information source; do NOT assume documented, working API or permission to scrape.
3. BMC GIS (municipal GIS service, if accessible): potential locations for historic flooding, shelters and hospitals; validate endpoint, licensing, coordinates and dataset currency before use.
4. Humanitarian Data Exchange (https://data.humdata.org/) / HOT: supplemental public geographic data; availability and refresh schedule unverified until tested.

## Mandatory simulated data
Ambulance GPS locations, availability, incident locations/severity, hospital bed/capacity status, exact road closures and clinic site feasibility are **simulated** without authorized operational feeds.

## Label every relevant layer
- `REAL MAP GEOMETRY` when graph truly sourced from OSM.
- `SYNTHETIC ROAD NETWORK` if fallback graph used.
- `HISTORICAL SUSCEPTIBILITY` if based on a validated historic dataset.
- `SCENARIO / SIMULATED` for sample rainfall, road closures, ambulance positions, demand, beds.
- `PREDICTED` only when a real validated model exists; display calibration/limitations instead of invented percentages.
- `UNKNOWN / STALE` for missing or old information; do not show as verified.

## Scientific framing
The Mumbai rainfall/tide study (https://doi.org/10.1038/s41586-025-09730-4) motivates the climate-health problem and inequalities; it does **not** prove any algorithm's response-time reduction or lives saved. Prior art on adaptive emergency management (https://arxiv.org/abs/2403.07003) prevents a claim that dynamic ambulance routing is wholly novel. RescueTrack (user-supplied IRJET PDF) provides SOS/coordination inspiration, not evidence that this app has comparable latency or usability.

## Safety boundaries
- Never route real people or contact real services. Visible banner: `RESEARCH SIMULATION — NOT FOR REAL EMERGENCY USE`.
- Never treat flood probability as a confirmed closure or guaranteed safe route.
- Human dispatcher must review proposed assignments. No AI diagnosis or autonomous medical triage.
- Do not ask for names, phone numbers, patient details, or unnecessary persistent precise location.
- Constraints: available ambulance, medically eligible hospital, free capacity, directed connected route, confirmed closures excluded.
- Explicit 'no feasible resource/route' if constraints cannot be satisfied.
- Do not claim hospital/municipal sponsorship, verified live data, production readiness, or actual health outcomes.

## Realism upgrade strategy after MVP
With authorized partners: authenticated SOS intake; verified closure feeds; facility status integrations; unit telemetry; operational audits and contingency communications; clinical/EMS review; protected personal data; accessibility; security, availability and on-site validation. These are NOT within a two-hour demo.

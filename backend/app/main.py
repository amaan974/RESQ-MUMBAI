"""RESQ Mumbai API — research simulation, NOT for real emergency use."""
from __future__ import annotations

import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .graph import DATA_DIR, RoadGraph
from .state import Scenario


def load_graph() -> RoadGraph:
    if os.environ.get("RESQ_SYNTHETIC") == "1" or not (DATA_DIR / "osm_graph.json").exists():
        return RoadGraph.synthetic_grid()
    return RoadGraph.load_osm()


app = FastAPI(title="RESQ Mumbai (simulation)", description="RESEARCH SIMULATION — NOT FOR REAL EMERGENCY USE")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
GRAPH = load_graph()
STATE = Scenario(GRAPH)
LOCK = threading.Lock()


def guarded(fn, *args):
    with LOCK:
        try:
            return fn(*args)
        except KeyError as e:
            raise HTTPException(404, f"not found: {e}")
        except PermissionError as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))


class SOSIn(BaseModel):
    location_id: str
    emergency_type: str
    client_token: str | None = Field(default=None, max_length=64)


class CloseRoadIn(BaseModel):
    edge_ids: list[str] | None = None
    decision_id: str | None = None
    leg: str = "to_incident"
    include_reverse: bool = True


class HospitalIn(BaseModel):
    hospital_id: str
    beds: int | None = None


class IncidentIn(BaseModel):
    type: str | None = None
    priority: int | None = None
    lat: float | None = None
    lon: float | None = None
    label: str | None = None


class PriorityIn(BaseModel):
    priority: int


class EvacIn(BaseModel):
    origin_id: str


class PositionIn(BaseModel):
    ambulance_id: str
    staging_site_id: str


@app.get("/api/state")
def get_state():
    with LOCK:
        return STATE.snapshot()


@app.get("/api/graph")
def get_graph():
    """Full routable graph geometry (for drawing). Edge IDs are stable OSM u_v_key identifiers."""
    return {"meta": GRAPH.meta, "edges": [{"edge_id": e["edge_id"], "geometry": e["geometry"], "highway": e["highway"]}
                                          for e in GRAPH.edges.values()]}


@app.post("/api/sos")
def post_sos(body: SOSIn):
    inc, dup = guarded(STATE.add_sos, body.location_id, body.emergency_type, body.client_token)
    return {"request_id": inc["id"], "status": inc["status"], "duplicate": dup, "incident": inc,
            "notice": "SIMULATION ONLY — DOES NOT CONTACT EMERGENCY SERVICES"}


@app.get("/api/sos/{incident_id}")
def get_sos(incident_id: str):
    with LOCK:
        inc = STATE.incidents.get(incident_id)
        if not inc:
            raise HTTPException(404, "unknown request id")
        return {"request_id": incident_id, "status": inc["status"], "priority_confirmed": inc["priority_confirmed"]}


@app.post("/api/optimize")
def post_optimize():
    def run():
        STATE.log("replan", "Dispatcher requested re-optimisation")
        STATE.replan("manual optimise")
        return STATE.snapshot()
    return guarded(run)


@app.post("/api/simulate/close-road")
def close_road(body: CloseRoadIn):
    if body.edge_ids:
        closed = guarded(STATE.close_edges, body.edge_ids, body.include_reverse)
    elif body.decision_id:
        closed = guarded(STATE.close_on_decision, body.decision_id, body.leg)
    else:
        raise HTTPException(422, "provide edge_ids or decision_id")
    return {"closed_edge_ids": closed, "plan": STATE.last_plan}


class AdvanceIn(BaseModel):
    seconds: float = 60


@app.post("/api/simulate/advance")
def advance(body: AdvanceIn):
    return guarded(STATE.advance, body.seconds)


class ZoneIn(BaseModel):
    zone_id: str


@app.post("/api/simulate/flood-zone")
def flood_zone(body: ZoneIn):
    closed = guarded(STATE.close_flood_zone, body.zone_id)
    return {"closed_edge_ids": closed, "plan": STATE.last_plan}


_SUITE: dict = {}


@app.get("/api/benchmark")
def benchmark(seeds: int = 30):
    """Seeded multi-scenario optimiser vs baseline comparison (deterministic; cached per seed count)."""
    from .benchmark import run_suite
    if not 1 <= seeds <= 100:
        raise HTTPException(422, "seeds must be 1..100")
    if seeds not in _SUITE:
        with LOCK:
            _SUITE[seeds] = run_suite(STATE, seeds)
    return {k: v for k, v in _SUITE[seeds].items() if k != "runs"} | {"runs": _SUITE[seeds]["runs"][:200]}


@app.get("/api/weather")
def get_weather(refresh: bool = False):
    from . import weather
    return weather.fetch(force=refresh)


@app.post("/api/simulate/reopen-roads")
def reopen_roads():
    return {"reopened": guarded(STATE.reopen_all)}


@app.post("/api/simulate/fill-hospital")
def fill_hospital(body: HospitalIn):
    h = guarded(STATE.set_hospital_beds, body.hospital_id, 0)
    return {"hospital": h, "plan": STATE.last_plan}


@app.post("/api/simulate/set-capacity")
def set_capacity(body: HospitalIn):
    if body.beds is None:
        raise HTTPException(422, "beds required")
    h = guarded(STATE.set_hospital_beds, body.hospital_id, body.beds)
    return {"hospital": h, "plan": STATE.last_plan}


@app.post("/api/simulate/add-incident")
def add_incident(body: IncidentIn | None = None):
    spec = None
    if body and body.lat is not None and body.lon is not None:
        spec = {k: v for k, v in body.model_dump().items() if v is not None}
    inc = guarded(STATE.add_incident, spec)
    return {"incident": inc, "plan": STATE.last_plan}


@app.post("/api/incidents/{incident_id}/priority")
def set_priority(incident_id: str, body: PriorityIn):
    return {"incident": guarded(STATE.set_priority, incident_id, body.priority)}


@app.post("/api/decisions/{decision_id}/approve")
def approve(decision_id: str):
    return {"decision": guarded(STATE.approve, decision_id)}


@app.post("/api/decisions/{decision_id}/accept-reroute")
def accept_reroute(decision_id: str):
    return {"decision": guarded(STATE.accept_reroute, decision_id)}


@app.post("/api/decisions/{decision_id}/complete")
def complete(decision_id: str):
    return {"decision": guarded(STATE.complete, decision_id)}


@app.post("/api/reset")
def reset():
    guarded(STATE.reset)
    return {"ok": True, "plan": STATE.last_plan}


@app.get("/api/metrics")
def metrics():
    return guarded(STATE.metrics)


@app.post("/api/evacuation/plan")
def evacuation(body: EvacIn):
    return guarded(STATE.evacuation_plan, body.origin_id)


@app.get("/api/clinic/plan")
def clinic():
    return guarded(STATE.clinic_plan)


class ClinicIn(BaseModel):
    site_id: str
    beds: int = 4


@app.post("/api/clinic/deploy")
def clinic_deploy(body: ClinicIn):
    return {"facility": guarded(STATE.deploy_clinic, body.site_id, body.beds), "plan": STATE.last_plan}


@app.get("/api/positioning")
def positioning():
    return guarded(STATE.positioning)


@app.post("/api/positioning/apply")
def apply_positioning(body: PositionIn):
    return {"ambulance": guarded(STATE.apply_positioning, body.ambulance_id, body.staging_site_id)}

"""API acceptance tests against the real OSM scenario (in-process TestClient)."""
from collections import Counter

import pytest
from fastapi.testclient import TestClient

from app.main import app, GRAPH, STATE
from app.optimizer import is_valid

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh():
    assert client.post("/api/reset").status_code == 200
    yield


def state():
    r = client.get("/api/state")
    assert r.status_code == 200
    return r.json()


def recs(s):
    return [d for d in s["decisions"] if d["status"] == "recommended"]


def rec_for(s, iid):
    m = [d for d in recs(s) if d["incident_id"] == iid]
    return m[0] if m else None


def sos(loc="kurla", typ="medical", token="t1"):
    return client.post("/api/sos", json={"location_id": loc, "emergency_type": typ, "client_token": token})


# 1 SOS_INTAKE
def test_sos_intake_and_duplicate_suppression():
    r = sos()
    assert r.status_code == 200
    j = r.json()
    rid = j["request_id"]
    assert rid.startswith("INC-") and j["duplicate"] is False
    assert "DOES NOT CONTACT" in j["notice"]
    s = state()
    inc = [i for i in s["incidents"] if i["id"] == rid][0]
    assert inc["source"] == "citizen_sos" and inc["priority_confirmed"] is False
    assert inc["status"] in ("recommended", "infeasible")
    # duplicate rapid resubmission -> same ID, no new incident
    r2 = sos()
    assert r2.json()["request_id"] == rid and r2.json()["duplicate"] is True
    assert len(state()["incidents"]) == len(s["incidents"])
    # distinct client -> distinct ID
    assert sos(token="t2").json()["request_id"] != rid
    # validation
    assert sos(loc="nowhere").status_code == 422
    assert sos(typ="fire").status_code == 422
    assert client.get(f"/api/sos/{rid}").json()["request_id"] == rid


# 2 GRAPH_PATH (decision level)
def test_decision_routes_are_graph_paths():
    sos()
    s = state()
    assert recs(s)
    amb = {a["id"]: a for a in s["ambulances"]}
    inc = {i["id"]: i for i in s["incidents"]}
    hos = {h["id"]: h for h in s["hospitals"]}
    for d in recs(s):
        for leg, a, b in (("route_to_incident", amb[d["ambulance_id"]]["node"], inc[d["incident_id"]]["node"]),
                          ("route_to_hospital", inc[d["incident_id"]]["node"], hos[d["hospital_id"]]["node"])):
            r = d[leg]
            es = [GRAPH.edges[k] for k in r["edge_ids"]]
            if not es:
                assert a == b
                continue
            assert es[0]["u"] == a and es[-1]["v"] == b
            assert all(x["v"] == y["u"] for x, y in zip(es, es[1:]))
            assert r["travel_time_s"] == pytest.approx(sum(e["travel_time_s"] for e in es), abs=0.2)
            assert r["polyline"][0] == es[0]["geometry"][0] and r["polyline"][-1] == es[-1]["geometry"][-1]
        assert d["estimated_ambulance_time_s"] == d["route_to_incident"]["travel_time_s"]


# 3 CLOSED_ROAD
def test_closed_road_changes_route():
    rid = sos().json()["request_id"]
    d0 = rec_for(state(), rid)
    assert d0
    r = client.post("/api/simulate/close-road", json={"decision_id": d0["id"]})
    assert r.status_code == 200
    closed = set(r.json()["closed_edge_ids"])
    assert closed & set(d0["route_to_incident"]["edge_ids"])
    s = state()
    assert {c["edge_id"] for c in s["closed_edges"]} >= closed
    for d in recs(s):
        assert not closed & set(d["route_to_incident"]["edge_ids"] + d["route_to_hospital"]["edge_ids"])
    d1 = rec_for(s, rid)
    inc = [i for i in s["incidents"] if i["id"] == rid][0]
    assert (d1 and d1["id"] != d0["id"]) or inc["status"] == "infeasible"
    old = [d for d in s["decisions"] if d["id"] == d0["id"]][0]
    assert old["status"] == "superseded" and "closed road" in old["invalidation"]


# 4 FULL_HOSPITAL
def test_full_hospital_not_chosen():
    rid = sos().json()["request_id"]
    d0 = rec_for(state(), rid)
    h = d0["hospital_id"]
    assert client.post("/api/simulate/fill-hospital", json={"hospital_id": h}).status_code == 200
    s = state()
    assert all(d["hospital_id"] != h for d in recs(s))
    assert [x for x in s["hospitals"] if x["id"] == h][0]["beds_available"] == 0
    d1 = rec_for(s, rid)
    inc = [i for i in s["incidents"] if i["id"] == rid][0]
    assert d1 is not None or inc["status"] == "infeasible"


# 5 + 6 AMBULANCE_EXCLUSIVITY / HOSPITAL_CAPACITY
def test_exclusivity_and_capacity_under_load():
    for _ in range(4):
        client.post("/api/simulate/add-incident")
    for loc in ("kurla", "sion", "chunabhatti"):
        sos(loc=loc, token=loc)
    s = state()
    rs = recs(s)
    assert rs
    assert len({d["ambulance_id"] for d in rs}) == len(rs)
    amb = {a["id"]: a for a in s["ambulances"]}
    assert all(amb[d["ambulance_id"]]["status"] == "available" for d in rs)
    hos = {h["id"]: h for h in s["hospitals"]}
    inc = {i["id"]: i for i in s["incidents"]}
    for h, n in Counter(d["hospital_id"] for d in rs).items():
        assert n <= hos[h]["beds_available"]
    for d in rs:
        assert inc[d["incident_id"]]["type"] in hos[d["hospital_id"]]["eligible_types"]
    # more incidents than units -> explicit infeasible statuses with reasons
    active = [i for i in s["incidents"] if i["status"] in ("recommended", "infeasible")]
    assert len(active) == 9
    for i in active:
        if i["status"] == "infeasible":
            assert i["reason"]


# 8 NO_SOLUTION via API
def test_no_solution_via_api():
    for h in [x["id"] for x in state()["hospitals"]]:
        client.post("/api/simulate/fill-hospital", json={"hospital_id": h})
    s = state()
    assert recs(s) == []
    assert all(i["status"] == "infeasible" and "beds" in i["reason"] for i in s["incidents"])


# 9 ADAPTIVE_UPDATE
def test_adaptive_update_from_server_state():
    v0 = state()["plan"]["version"]
    rid = sos().json()["request_id"]
    s1 = state()
    assert s1["plan"]["version"] > v0 and rec_for(s1, rid)
    d = rec_for(s1, rid)
    client.post("/api/simulate/close-road", json={"decision_id": d["id"]})
    s2 = state()
    assert s2["plan"]["version"] > s1["plan"]["version"]
    client.post("/api/simulate/set-capacity", json={"hospital_id": "HOSP-A", "beds": 0})
    s3 = state()
    assert s3["plan"]["version"] > s2["plan"]["version"]
    assert all(x["hospital_id"] != "HOSP-A" for x in recs(s3))
    client.post(f"/api/incidents/{rid}/priority", json={"priority": 3})
    inc = [i for i in state()["incidents"] if i["id"] == rid][0]
    assert inc["priority"] == 3 and inc["priority_confirmed"]


# 10 APPROVAL
def test_approval_immutable_and_flagged():
    rid = sos().json()["request_id"]
    d = rec_for(state(), rid)
    r = client.post(f"/api/decisions/{d['id']}/approve")
    assert r.status_code == 200 and r.json()["decision"]["status"] == "approved"
    s = state()
    amb = [a for a in s["ambulances"] if a["id"] == d["ambulance_id"]][0]
    assert amb["status"] == "dispatched"
    assert all(x["ambulance_id"] != d["ambulance_id"] for x in recs(s))
    # closing a road on the approved route must NOT change it; flag for review instead
    r = client.post("/api/simulate/close-road", json={"decision_id": d["id"]})
    closed = set(r.json()["closed_edge_ids"])
    s = state()
    ad = [x for x in s["decisions"] if x["id"] == d["id"]][0]
    assert ad["status"] == "approved"
    assert ad["route_to_incident"]["edge_ids"] == d["route_to_incident"]["edge_ids"]
    assert ad["review_required"] and ad["alerts"]
    assert any(a["decision_id"] == d["id"] for a in s["alerts"])
    sr = ad["suggested_reroute"]
    if sr:
        assert not closed & set(sr["route_to_incident"]["edge_ids"] + sr["route_to_hospital"]["edge_ids"])
        assert client.post(f"/api/decisions/{d['id']}/accept-reroute").status_code == 200
        ad2 = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
        assert ad2["status"] == "approved" and not closed & set(ad2["route_to_incident"]["edge_ids"])
    # approving twice / approving stale is rejected
    assert client.post(f"/api/decisions/{d['id']}/approve").status_code == 409
    assert client.post("/api/decisions/DEC-9999/approve").status_code == 404


def test_superseded_cannot_be_approved():
    rid = sos().json()["request_id"]
    d = rec_for(state(), rid)
    client.post("/api/simulate/fill-hospital", json={"hospital_id": d["hospital_id"]})
    assert client.post(f"/api/decisions/{d['id']}/approve").status_code == 409


# 11 RESET
def test_reset_is_deterministic():
    def fingerprint(s):
        return (
            [(i["id"], i["node"], i["status"], i["priority"]) for i in s["incidents"]],
            [(a["id"], a["node"], a["status"]) for a in s["ambulances"]],
            [(h["id"], h["node"], h["beds_available"]) for h in s["hospitals"]],
            [(d["id"], d["incident_id"], d["ambulance_id"], d["hospital_id"], tuple(d["route_to_incident"]["edge_ids"]))
             for d in s["decisions"]],
            s["closed_edges"],
        )
    f0 = fingerprint(state())
    rid = sos().json()["request_id"]
    d = rec_for(state(), rid)
    client.post("/api/simulate/close-road", json={"decision_id": d["id"]})
    client.post("/api/simulate/fill-hospital", json={"hospital_id": "HOSP-B"})
    client.post("/api/simulate/add-incident")
    assert fingerprint(state()) != f0
    client.post("/api/reset")
    assert fingerprint(state()) == f0


# 12 BASELINE_FAIRNESS
def test_baseline_uses_same_constraints():
    for _ in range(3):
        client.post("/api/simulate/add-incident")
    sos()
    client.post("/api/simulate/fill-hospital", json={"hospital_id": "HOSP-A"})
    m = client.get("/api/metrics").json()
    cur = m["current"]
    for k in ("incidents_served", "total_response_s", "weighted_chain_cost"):
        assert k in cur["optimizer"] and k in cur["baseline"]
    p, _, _ = STATE.build_problem(STATE.active_incidents())
    base = {k: tuple(v) if v else None for k, v in cur["baseline"]["assignment"].items()}
    opt = {k: tuple(v) if v else None for k, v in cur["optimizer"]["assignment"].items()}
    assert is_valid(p, base) and is_valid(p, opt)
    assert all(v is None or v[1] != "HOSP-A" for v in base.values())
    # optimiser is exact for its objective, so never lexicographically worse than baseline
    ob = cur["optimizer"]["served_by_priority"]; bb = cur["baseline"]["served_by_priority"]
    assert (ob["high"], ob["medium"], ob["low"]) >= (bb["high"], bb["medium"], bb["low"])
    assert m["benchmark"]["optimizer"]["incidents_served"] >= 1


# 13 EVACUATION
def test_evacuation_excludes_closed_and_reports_infeasible():
    r = client.post("/api/evacuation/plan", json={"origin_id": "EVO-1"}).json()
    assert r["status"] == "ok" and r["route"]["edge_ids"]
    # close one used edge -> new route avoids it
    e = r["route"]["edge_ids"][len(r["route"]["edge_ids"]) // 2]
    client.post("/api/simulate/close-road", json={"edge_ids": [e]})
    r2 = client.post("/api/evacuation/plan", json={"origin_id": "EVO-1"}).json()
    assert r2["status"] == "infeasible" or e not in r2["route"]["edge_ids"]
    # isolate origin: close every edge leaving it -> explicit infeasibility
    node = [o for o in state()["evacuation_origins"] if o["id"] == "EVO-1"][0]["node"]
    out = [k for k, ed in GRAPH.edges.items() if ed["u"] == node]
    client.post("/api/simulate/close-road", json={"edge_ids": out, "include_reverse": False})
    r3 = client.post("/api/evacuation/plan", json={"origin_id": "EVO-1"}).json()
    assert r3["status"] == "infeasible" and r3["route"] is None and r3["reason"]


# 14 CLINIC_CANDIDATE
def test_clinic_candidate_from_predefined_sites():
    sos()
    r = client.get("/api/clinic/plan").json()
    sites = {c["id"] for c in state()["clinic_sites"]}
    assert r["site_id"] in sites
    assert r["reason"] and r["rule"]
    assert r["table"][0]["site_id"] == r["site_id"]
    assert r["table"][0]["covered_weight"] >= max(t["covered_weight"] for t in r["table"])


# P2 positioning
def test_positioning_returns_rule_and_valid_ids():
    r = client.get("/api/positioning").json()
    assert "rule" in r and r["covered_weight"] <= r["total_weight"]
    if r["recommendation"]:
        assert r["recommendation"]["ambulance_id"] in r["idle_ambulances"]


# 16 DATA_LABELS (API side)
def test_data_labels():
    s = state()
    labels = {x["layer"]: x["label"] for x in s["sources"]}
    assert labels["Road network"] == "REAL MAP GEOMETRY"
    assert labels["Hospital beds & eligibility"] == "SCENARIO / SIMULATED"
    assert labels["Ambulance positions & availability"] == "SCENARIO / SIMULATED"
    assert labels["Tide"].startswith("UNKNOWN")
    assert labels["Rainfall"] in ("UNKNOWN / NOT CONNECTED", "THIRD-PARTY FORECAST · context only")
    assert all("LIVE" not in v.upper() for v in labels.values())


# End-to-end runbook flow: SOS -> optimise -> close edge -> re-optimise -> fill hospital -> approve -> reset
def test_demo_runbook_flow():
    rid = sos(loc="kurla", typ="medical", token="jury").json()["request_id"]
    s = client.post("/api/optimize").json()
    d1 = rec_for(s, rid)
    assert d1 and d1["route_to_incident"]["polyline"]
    closed = set(client.post("/api/simulate/close-road", json={"decision_id": d1["id"]}).json()["closed_edge_ids"])
    d2 = rec_for(state(), rid)
    assert d2 is None or not closed & set(d2["route_to_incident"]["edge_ids"] + d2["route_to_hospital"]["edge_ids"])
    assert d2 is not None
    client.post("/api/simulate/fill-hospital", json={"hospital_id": d2["hospital_id"]})
    d3 = rec_for(state(), rid)
    assert d3 is not None and d3["hospital_id"] != d2["hospital_id"]
    assert client.post(f"/api/decisions/{d3['id']}/approve").status_code == 200
    inc = [i for i in state()["incidents"] if i["id"] == rid][0]
    assert inc["status"] == "approved" and inc["priority_confirmed"]
    m = client.get("/api/metrics").json()
    assert m["current"]["optimizer"]["incidents_total"] == m["current"]["baseline"]["incidents_total"]
    client.post("/api/reset")
    s = state()
    assert [i["id"] for i in s["incidents"]] == ["INC-0001", "INC-0002"] and not s["closed_edges"]


# Dispatcher-confirmed scenario flood-zone closure changes feasible decisions or reports infeasibility
def test_flood_zone_closure():
    sos(loc="kurla")
    r = client.post("/api/simulate/flood-zone", json={"zone_id": "FZ-1"})
    assert r.status_code == 200
    closed = set(r.json()["closed_edge_ids"])
    assert len(closed) > 5
    s = state()
    for d in recs(s):
        assert not closed & set(d["route_to_incident"]["edge_ids"] + d["route_to_hospital"]["edge_ids"])
    for ev in s["evacuation"].values():
        assert ev["status"] == "infeasible" or not closed & set(ev["route"]["edge_ids"])
    assert client.post("/api/simulate/flood-zone", json={"zone_id": "nope"}).status_code == 404


def test_weather_failure_is_unknown(monkeypatch):
    from app import weather
    def boom(*a, **k):
        raise OSError("offline")
    monkeypatch.setattr(weather.requests, "get", boom)
    w = weather.fetch(force=True)
    assert w["status"] == "unavailable" and w["label"].startswith("UNKNOWN")
    weather._cache["data"] = None


# Seeded benchmark suite: same constraints for both; exact optimiser never lexicographically worse
def test_benchmark_suite_fair_and_exact():
    from app.benchmark import run_suite
    before = set(GRAPH.closed)
    r = run_suite(STATE, seeds=6)
    assert set(GRAPH.closed) == before  # closures restored
    assert r["overall"]["runs"] == 12
    assert r["overall"]["optimizer_worse"] == 0
    assert r["overall_vs_priority_greedy"]["optimizer_worse"] == 0
    for run in r["runs"]:
        assert run["optimizer"]["incidents_total"] == run["baseline"]["incidents_total"]


# Simulation clock: approved units move; closures behind are ignored; closures ahead block + flag; reroute from position
def _approve_new_sos():
    rid = sos(loc="kurla", token="clock").json()["request_id"]
    d = rec_for(state(), rid)
    assert client.post(f"/api/decisions/{d['id']}/approve").status_code == 200
    return d


def test_clock_moves_unit_to_hospital():
    d = _approve_new_sos()
    t1, t2 = d["estimated_ambulance_time_s"], d["estimated_transport_time_s"]
    client.post("/api/simulate/advance", json={"seconds": max(1, t1 / 2)})
    s = state()
    ad = [x for x in s["decisions"] if x["id"] == d["id"]][0]
    amb = [a for a in s["ambulances"] if a["id"] == d["ambulance_id"]][0]
    assert ad["phase"] == "to_incident" and amb["node"] in d["route_to_incident"]["node_path"]
    client.post("/api/simulate/advance", json={"seconds": t1 + t2 + 5})
    s = state()
    ad = [x for x in s["decisions"] if x["id"] == d["id"]][0]
    amb = [a for a in s["ambulances"] if a["id"] == d["ambulance_id"]][0]
    hos = [h for h in s["hospitals"] if h["id"] == d["hospital_id"]][0]
    assert ad["phase"] == "at_hospital" and ad["status"] == "approved" and amb["node"] == hos["node"]
    assert client.post(f"/api/decisions/{d['id']}/complete").status_code == 200
    assert [a for a in state()["ambulances"] if a["id"] == d["ambulance_id"]][0]["status"] == "available"
    assert client.post("/api/simulate/advance", json={"seconds": 0}).status_code == 422


def test_clock_closure_behind_ignored_ahead_blocks_and_reroutes():
    d = _approve_new_sos()
    r1 = d["route_to_incident"]
    if len(r1["edge_ids"]) < 3:
        pytest.skip("route too short for behind/ahead split")
    first_t = GRAPH.edges[r1["edge_ids"][0]]["travel_time_s"]
    client.post("/api/simulate/advance", json={"seconds": first_t + 0.5})  # past the first edge
    client.post("/api/simulate/close-road", json={"edge_ids": [r1["edge_ids"][0]], "include_reverse": False})
    ad = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
    assert not ad["review_required"]  # closure behind the unit
    ahead = r1["edge_ids"][-1]
    client.post("/api/simulate/close-road", json={"edge_ids": [ahead], "include_reverse": False})
    s = state()
    ad = [x for x in s["decisions"] if x["id"] == d["id"]][0]
    amb = [a for a in s["ambulances"] if a["id"] == d["ambulance_id"]][0]
    assert ad["review_required"] and ad["route_to_incident"]["edge_ids"] == r1["edge_ids"]
    client.post("/api/simulate/advance", json={"seconds": 3600})
    s = state()
    ad = [x for x in s["decisions"] if x["id"] == d["id"]][0]
    amb = [a for a in s["ambulances"] if a["id"] == d["ambulance_id"]][0]
    assert ad["blocked"] and ad["phase"] == "to_incident"
    # held on the original route, at or before the closed edge (last point where a detour exists)
    path = d["route_to_incident"]["node_path"]
    assert amb["node"] in path and path.index(amb["node"]) <= path.index(GRAPH.edges[ahead]["u"])
    sr = ad["suggested_reroute"]
    if sr is None:
        return  # explicit 'no open alternative' is acceptable
    first_edges = sr["route_to_incident"]["edge_ids"] or sr["route_to_hospital"]["edge_ids"]
    assert GRAPH.edges[first_edges[0]]["u"] == amb["node"]  # starts from current position
    assert client.post(f"/api/decisions/{d['id']}/accept-reroute").status_code == 200
    client.post("/api/simulate/advance", json={"seconds": 3600})
    ad = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
    assert ad["phase"] == "at_hospital" and not ad["blocked"]


def test_close_on_approved_decision_only_closes_road_ahead():
    d = _approve_new_sos()
    t1 = d["estimated_ambulance_time_s"]
    client.post("/api/simulate/advance", json={"seconds": max(1, t1 / 3)})
    r = client.post("/api/simulate/close-road", json={"decision_id": d["id"], "leg": "to_hospital"})
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        closed = set(r.json()["closed_edge_ids"])
        ad = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
        driven_or_current = set(d["route_to_incident"]["edge_ids"][:1])
        assert not closed & driven_or_current
        assert ad["review_required"]


def test_unit_holds_at_last_divert_point_and_reroutes():
    s = state()
    d = [x for x in recs(s) if x["incident_id"] == "INC-0001"][0]
    client.post(f"/api/decisions/{d['id']}/approve")
    client.post("/api/simulate/advance", json={"seconds": 60})
    assert client.post("/api/simulate/close-road", json={"decision_id": d["id"], "leg": "to_incident"}).status_code == 200
    client.post("/api/simulate/advance", json={"seconds": 120})
    ad = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
    assert ad["blocked"] and ad["review_required"] and ad["suggested_reroute"] is not None
    assert client.post(f"/api/decisions/{d['id']}/accept-reroute").status_code == 200
    client.post("/api/simulate/advance", json={"seconds": 1800})
    ad = [x for x in state()["decisions"] if x["id"] == d["id"]][0]
    assert ad["phase"] == "at_hospital" and not ad["blocked"]


# Temporary medical post: deployed only on dispatcher action; usable by optimiser for 'medical' only
def test_deploy_temporary_post_feeds_optimiser():
    sos(loc="sion", typ="medical", token="tmp")
    site = client.get("/api/clinic/plan").json()["site_id"]
    for h in [x["id"] for x in state()["hospitals"]]:
        client.post("/api/simulate/fill-hospital", json={"hospital_id": h})
    s = state()
    assert recs(s) == []  # nothing feasible before deployment
    r = client.post("/api/clinic/deploy", json={"site_id": site, "beds": 2})
    assert r.status_code == 200 and r.json()["facility"]["eligible_types"] == ["medical"]
    s = state()
    inc = {i["id"]: i for i in s["incidents"]}
    rs = recs(s)
    assert rs and all(d["hospital_id"] == f"TMP-{site}" for d in rs)
    assert all(inc[d["incident_id"]]["type"] == "medical" for d in rs)
    assert len(rs) <= 2
    assert any(i["type"] == "flood_rescue" and i["status"] == "infeasible" for i in s["incidents"])
    assert client.post("/api/clinic/deploy", json={"site_id": site}).status_code == 409
    client.post("/api/reset")
    assert all(not h["id"].startswith("TMP-") for h in state()["hospitals"])

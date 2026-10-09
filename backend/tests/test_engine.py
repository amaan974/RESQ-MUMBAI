"""Engine-level acceptance tests: GRAPH_PATH, ALLOCATION_CORRECTNESS, NO_SOLUTION, exclusivity/capacity."""
import itertools
import random

import networkx as nx
import pytest

from app.graph import RoadGraph
from app.optimizer import Problem, greedy_baseline, is_valid, score_of, solve
from app.state import Scenario


def brute_force(p: Problem):
    choices = [None] + [(a, h) for a in p.ambulances for h in p.hospitals]
    best = None
    for combo in itertools.product(choices, repeat=len(p.incidents)):
        assign = {inc["id"]: c for inc, c in zip(p.incidents, combo)}
        if not is_valid(p, assign):
            continue
        sc = score_of(p, assign)
        if best is None or sc < best[0]:
            best = (sc, assign)
    return best


def tiny_graph() -> RoadGraph:
    """Known tiny directed graph (bidirectional pairs) with explicit travel times (s)."""
    pts = {"X": [19.00, 72.00], "Y": [19.00, 72.02], "I1": [19.01, 72.01], "I2": [19.01, 71.99],
           "H1": [19.02, 72.01], "H2": [19.02, 71.99]}
    links = [("X", "I1", 60), ("X", "I2", 60), ("Y", "I1", 120), ("Y", "I2", 600),
             ("I1", "H1", 100), ("I2", "H2", 100), ("I1", "H2", 300), ("I2", "H1", 300)]
    edges = []
    for u, v, t in links:
        edges.append({"u": u, "v": v, "length_m": t * 10, "travel_time_s": t, "name": f"{u}-{v}"})
        edges.append({"u": v, "v": u, "length_m": t * 10, "travel_time_s": t, "name": f"{u}-{v}"})
    return RoadGraph(pts, edges, {"type": "SYNTHETIC ROAD NETWORK", "source": "unit test"})


def tiny_spec(beds=(1, 1)):
    return {
        "sos_locations": [{"id": "loc", "label": "L", "node": "I1"}],
        "ambulances": [{"id": "X", "label": "x", "node": "X", "status": "available"},
                       {"id": "Y", "label": "y", "node": "Y", "status": "available"}],
        "hospitals": [{"id": "H1", "name": "H1", "node": "H1", "beds_total": 5, "beds_available": beds[0], "eligible_types": ["medical", "trauma", "flood_rescue"]},
                      {"id": "H2", "name": "H2", "node": "H2", "beds_total": 5, "beds_available": beds[1], "eligible_types": ["medical", "trauma", "flood_rescue"]}],
        "seed_incidents": [{"type": "medical", "priority": 1, "label": "I1 low, first", "node": "I1"},
                           {"type": "trauma", "priority": 3, "label": "I2 high, second", "node": "I2"}],
        "extra_incidents": [{"type": "medical", "priority": 2, "label": "extra", "node": "I1"}],
        "shelters": [{"id": "S", "name": "S", "node": "H1", "capacity": 100}],
        "evacuation_origins": [{"id": "E", "name": "E", "node": "I2", "people": 10}],
        "clinic_sites": [{"id": "C1", "name": "C1", "node": "I1"}, {"id": "C2", "name": "C2", "node": "Y"}],
        "staging_sites": [{"id": "T", "name": "T", "node": "I2"}],
        "flood_zones": [],
    }


# ---------------- ALLOCATION_CORRECTNESS ----------------
def test_allocation_matches_brute_force_on_tiny_graph():
    sc = Scenario(tiny_graph(), tiny_spec())
    p, _, _ = sc.build_problem()
    assert len(p.incidents) == 2 and len(p.ambulances) == 2 and len(p.hospitals) == 2
    plan = solve(p)
    bf_score, bf_assign = brute_force(p)
    assert plan.score == bf_score
    assert plan.assignment == bf_assign
    # Known optimum: nearest unit X goes to HIGH-priority I2; Y to I1. Weighted = 3*(60+100) + 1*(120+100) = 700
    assert plan.assignment == {"INC-0001": ("Y", "H1"), "INC-0002": ("X", "H2")}
    assert plan.score[3] == 700.0
    # Greedy FIFO baseline sends X to I1 first -> worse weighted cost, same constraints
    base = greedy_baseline(p)
    assert base.assignment["INC-0001"] == ("X", "H1")
    assert is_valid(p, base.assignment)
    assert base.score[3] > plan.score[3]


def test_priority_dominates_when_resources_short():
    sc = Scenario(tiny_graph(), {**tiny_spec(), "ambulances": [{"id": "Y", "label": "y", "node": "Y", "status": "available"}]})
    p, _, _ = sc.build_problem()
    plan = solve(p)
    assert plan.assignment["INC-0002"] is not None  # HIGH served even though I1 is much closer to Y
    assert plan.assignment["INC-0001"] is None
    assert "higher-priority" in plan.infeasible_reasons["INC-0001"]
    assert plan.score == brute_force(p)[0]


@pytest.mark.parametrize("seed", range(150))
def test_random_small_problems_match_brute_force(seed):
    rnd = random.Random(seed)
    incs = [{"id": f"I{k}", "priority": rnd.choice([1, 2, 3]), "type": rnd.choice(["medical", "trauma"]), "seq": k} for k in range(3)]
    ambs = [f"A{k}" for k in range(rnd.choice([1, 2, 3]))]
    hosps = {f"H{k}": {"beds": rnd.choice([0, 1, 1, 2]), "eligible_types": rnd.choice([["medical"], ["trauma"], ["medical", "trauma"]])}
             for k in range(3)}
    t_resp = {(a, i["id"]): float(rnd.randint(30, 900)) for a in ambs for i in incs if rnd.random() > 0.15}
    t_trans = {(i["id"], h): float(rnd.randint(30, 900)) for i in incs for h in hosps if rnd.random() > 0.15}
    p = Problem(incs, ambs, hosps, t_resp, t_trans)
    plan = solve(p)
    bf = brute_force(p)
    assert is_valid(p, plan.assignment)
    assert plan.score == bf[0]
    assert is_valid(p, greedy_baseline(p).assignment)


# ---------------- NO_SOLUTION ----------------
def test_no_solution_when_all_hospitals_full():
    sc = Scenario(tiny_graph(), tiny_spec(beds=(0, 0)))
    assert not [d for d in sc.decisions.values() if d["status"] == "recommended"]
    for inc in sc.incidents.values():
        assert inc["status"] == "infeasible"
        assert "zero available beds" in inc["reason"]


def test_no_solution_when_incident_unreachable():
    g = tiny_graph()
    sc = Scenario(g, tiny_spec())
    into_i2 = [k for k, e in g.edges.items() if e["v"] == "I2"]
    sc.close_edges(into_i2, include_reverse=False)
    inc2 = sc.incidents["INC-0002"]
    assert inc2["status"] == "infeasible"
    assert "reach" in inc2["reason"]
    for d in sc.decisions.values():
        if d["status"] == "recommended":
            assert d["incident_id"] != "INC-0002"


# ---------------- GRAPH_PATH (real OSM graph) ----------------
@pytest.fixture(scope="module")
def osm():
    return RoadGraph.load_osm()


def test_graph_is_real_osm_and_directed(osm):
    assert osm.meta["type"] == "REAL MAP GEOMETRY"
    assert "OpenStreetMap" in osm.meta["source"]
    assert len(osm.nodes) > 500 and len(osm.edges) > 1000


def test_route_is_contiguous_directed_path_matching_geometry_and_time(osm):
    nodes = sorted(osm.nodes)
    src, dst = osm.nearest_node(19.0450, 72.8640), osm.nearest_node(19.0660, 72.8790)
    r = osm.route(src, dst)
    assert r and r["edge_ids"]
    es = [osm.edges[k] for k in r["edge_ids"]]
    assert es[0]["u"] == src and es[-1]["v"] == dst
    for a, b in zip(es, es[1:]):
        assert a["v"] == b["u"]
    poly = []
    for e in es:
        poly.extend(e["geometry"] if not poly else e["geometry"][1:])
    assert r["polyline"] == poly
    assert r["travel_time_s"] == pytest.approx(sum(e["travel_time_s"] for e in es), abs=0.2)
    # equals true shortest open-path time
    best = nx.dijkstra_path_length(osm.G, src, dst, weight=osm._weight)
    assert r["travel_time_s"] == pytest.approx(best, abs=0.2)
    assert nodes  # sanity


def test_closed_edge_never_used_by_router(osm):
    src, dst = osm.nearest_node(19.0450, 72.8640), osm.nearest_node(19.0660, 72.8790)
    r = osm.route(src, dst)
    mid = r["edge_ids"][len(r["edge_ids"]) // 2]
    osm.closed.add(mid)
    try:
        r2 = osm.route(src, dst)
        assert r2 is None or mid not in r2["edge_ids"]
        assert r2 is None or r2["travel_time_s"] >= r["travel_time_s"]
    finally:
        osm.closed.clear()


def test_zero_length_route(osm):
    n = sorted(osm.nodes)[0]
    r = osm.route(n, n)
    assert r["edge_ids"] == [] and r["travel_time_s"] == 0.0


def test_synthetic_fallback_is_labeled():
    g = RoadGraph.synthetic_grid(4)
    assert g.meta["type"] == "SYNTHETIC ROAD NETWORK"
    assert g.route("S0_0", "S3_3")["length_m"] == 6 * 400


def test_full_scenario_runs_on_synthetic_fallback_and_is_labeled():
    sc = Scenario(RoadGraph.synthetic_grid())
    snap = sc.snapshot()
    road = [x for x in snap["sources"] if x["layer"] == "Road network"][0]
    assert road["label"] == "SYNTHETIC ROAD NETWORK" and road["simulated"] is True
    assert snap["graph"]["label"] == "SYNTHETIC ROAD NETWORK"
    inc, dup = sc.add_sos("kurla", "medical", "syn")
    assert not dup and sc.incidents[inc["id"]]["status"] in ("recommended", "infeasible")


def _stress_problem(seed: int, n_inc: int) -> Problem:
    rnd = random.Random(seed * 7 + n_inc)
    incs = [{"id": f"I{k:02d}", "priority": rnd.choice([1, 2, 3]), "type": rnd.choice(["medical", "medical", "flood_rescue", "trauma"]), "seq": k} for k in range(n_inc)]
    ambs = [f"A{k}" for k in range(6)]
    hosps = {f"H{k}": {"beds": rnd.choice([1, 2, 3]), "eligible_types": rnd.choice([["medical", "trauma", "flood_rescue"], ["medical", "flood_rescue"], ["medical", "trauma"], ["medical"]])} for k in range(6)}
    t_resp = {(a, i["id"]): float(rnd.randint(60, 900)) for a in ambs for i in incs}
    t_trans = {(i["id"], h): float(rnd.randint(60, 900)) for i in incs for h in hosps}
    return Problem(incs, ambs, hosps, t_resp, t_trans)


def test_anytime_fallback_never_raises_and_stays_feasible():
    p = _stress_problem(3, 10)
    plan = solve(p, node_limit=5)
    assert plan.proven_optimal is False
    assert is_valid(p, plan.assignment)
    assert plan.score <= score_of(p, greedy_baseline(p, "priority").assignment)  # never worse than its seed


@pytest.mark.parametrize("n_inc", [8, 10, 12])
def test_stress_instances_solve_to_proven_optimality(n_inc):
    for seed in range(20):
        plan = solve(_stress_problem(seed, n_inc))
        assert plan.proven_optimal, (seed, n_inc, plan.nodes_explored)

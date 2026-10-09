"""Seeded multi-scenario comparison: exact optimiser vs nearest-feasible baseline under identical constraints.

Each seed draws 5-9 simultaneous incidents at random graph nodes (random priority/type), uses the scenario's
initial fleet and simulated beds, and is evaluated twice: all roads open, and all scenario flood zones closed.
Results are simulation measurements only.
"""
from __future__ import annotations

import random
import statistics
import time

from .graph import haversine_m
from .optimizer import greedy_baseline, plan_metrics, solve

TYPES = ["medical", "medical", "flood_rescue", "trauma"]


def run_suite(state, seeds: int = 30) -> dict:
    g = state.graph
    nodes = sorted(g.nodes)
    spec = state.spec
    ambs = {a["id"]: {"node": g.nearest_node(a["lat"], a["lon"]), "status": a["status"]} for a in spec["ambulances"]}
    hosps = {h["id"]: {"node": g.nearest_node(h["lat"], h["lon"]), "beds_available": h["beds_available"],
                       "eligible_types": h["eligible_types"]} for h in spec["hospitals"]}
    zone_edges = sorted({k for z in spec["flood_zones"] for k, e in g.edges.items()
                         if any(haversine_m((p[0], p[1]), (z["lat"], z["lon"])) <= z["radius_m"] for p in e["geometry"])})
    saved = set(g.closed)
    runs = []
    t0 = time.perf_counter()
    try:
        for condition, closed in (("open roads", set()), ("flood zones closed", set(zone_edges))):
            g.closed.clear()
            g.closed.update(closed)
            for seed in range(1, seeds + 1):
                rnd = random.Random(seed)
                k = rnd.randint(5, 9)
                incs = [{"id": f"S{seed}-{j + 1}", "priority": rnd.choice([1, 2, 3]), "type": rnd.choice(TYPES),
                         "seq": j + 1, "node": rnd.choice(nodes)} for j in range(k)]
                p, _, _ = state.build_problem(incs, ambs, hosps)
                o = plan_metrics(p, solve(p))
                b = plan_metrics(p, greedy_baseline(p, "fifo"))
                bp = plan_metrics(p, greedy_baseline(p, "priority"))
                runs.append({"seed": seed, "condition": condition, "incidents": k, "optimizer": o, "baseline": b,
                             "baseline_priority": bp})
    finally:
        g.closed.clear()
        g.closed.update(saved)

    def summarize(rs: list[dict], bkey: str = "baseline") -> dict:
        rs = [{**r, "baseline": r[bkey]} for r in rs]

        def lex(m):
            s = m["served_by_priority"]
            return (s["high"], s["medium"], s["low"])
        better = sum(1 for r in rs if (lex(r["optimizer"]), -r["optimizer"]["weighted_chain_cost"]) >
                     (lex(r["baseline"]), -r["baseline"]["weighted_chain_cost"]))
        worse = sum(1 for r in rs if (lex(r["optimizer"]), -r["optimizer"]["weighted_chain_cost"]) <
                    (lex(r["baseline"]), -r["baseline"]["weighted_chain_cost"]))
        hp_pairs = [(r["optimizer"]["mean_high_priority_response_s"], r["baseline"]["mean_high_priority_response_s"])
                    for r in rs if r["optimizer"]["mean_high_priority_response_s"] is not None
                    and r["baseline"]["mean_high_priority_response_s"] is not None]
        return {
            "runs": len(rs),
            "optimizer_better": better, "tie": len(rs) - better - worse, "optimizer_worse": worse,
            "served_high_optimizer": sum(r["optimizer"]["served_by_priority"]["high"] for r in rs),
            "served_high_baseline": sum(r["baseline"]["served_by_priority"]["high"] for r in rs),
            "served_total_optimizer": sum(r["optimizer"]["incidents_served"] for r in rs),
            "served_total_baseline": sum(r["baseline"]["incidents_served"] for r in rs),
            "mean_weighted_cost_optimizer": round(statistics.mean(r["optimizer"]["weighted_chain_cost"] for r in rs), 1),
            "mean_weighted_cost_baseline": round(statistics.mean(r["baseline"]["weighted_chain_cost"] for r in rs), 1),
            "mean_high_priority_response_s_optimizer": round(statistics.mean(x for x, _ in hp_pairs), 1) if hp_pairs else None,
            "mean_high_priority_response_s_baseline": round(statistics.mean(y for _, y in hp_pairs), 1) if hp_pairs else None,
            "paired_high_priority_runs": len(hp_pairs),
        }

    return {
        "description": f"{seeds} seeded random incident sets (5-9 incidents each) x 2 road conditions; "
                       f"initial simulated fleet ({sum(1 for a in ambs.values() if a['status'] == 'available')} available) "
                       f"and beds ({sum(h['beds_available'] for h in hosps.values())}); {len(zone_edges)} edges in flood zones",
        "comparison_rule": "Better/worse = lexicographic (served HIGH, MEDIUM, LOW, then lower priority-weighted chain cost). "
                           "Weighted cost is only comparable when the same incidents are served.",
        "baselines": {"baseline": "nearest-feasible, FIFO arrival order",
                      "baseline_priority": "nearest-feasible, highest priority first (stronger baseline)"},
        "by_condition": {c: summarize([r for r in runs if r["condition"] == c]) for c in ("open roads", "flood zones closed")},
        "overall": summarize(runs),
        "by_condition_vs_priority_greedy": {c: summarize([r for r in runs if r["condition"] == c], "baseline_priority")
                                            for c in ("open roads", "flood zones closed")},
        "overall_vs_priority_greedy": summarize(runs, "baseline_priority"),
        "compute_s": round(time.perf_counter() - t0, 2),
        "runs": runs,
    }

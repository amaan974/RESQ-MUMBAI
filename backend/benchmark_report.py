"""Run the seeded benchmark suite and write ../docs/BENCHMARK_RESULTS.md (actual measured values)."""
import datetime as dt
from pathlib import Path

from app.benchmark import run_suite
from app.graph import RoadGraph
from app.state import Scenario

g = RoadGraph.load_osm()
r = run_suite(Scenario(g), seeds=30)
lines = [f"# Benchmark results — optimiser vs nearest-feasible baseline (simulation)",
         f"Generated {dt.datetime.now().astimezone().isoformat(timespec='seconds')} by `backend/benchmark_report.py` on graph: "
         f"{g.meta['type']} ({len(g.nodes)} nodes, {len(g.edges)} directed edges).", "",
         r["description"] + ".", "", r["comparison_rule"], "",
         "| Condition | Runs | Opt better | Tie | Opt worse | HIGH served (opt / base) | All served (opt / base) | Mean HIGH response s (opt / base) | Mean weighted cost (opt / base) |",
         "|---|---|---|---|---|---|---|---|---|"]
rows = [(f"{c} — vs FIFO greedy", x) for c, x in list(r["by_condition"].items()) + [("overall", r["overall"])]]
rows += [(f"{c} — vs priority-first greedy", x) for c, x in list(r["by_condition_vs_priority_greedy"].items()) + [("overall", r["overall_vs_priority_greedy"])]]
for c, x in rows:
    lines.append(f"| {c} | {x['runs']} | {x['optimizer_better']} | {x['tie']} | {x['optimizer_worse']} | "
                 f"{x['served_high_optimizer']} / {x['served_high_baseline']} | {x['served_total_optimizer']} / {x['served_total_baseline']} | "
                 f"{x['mean_high_priority_response_s_optimizer']} / {x['mean_high_priority_response_s_baseline']} | "
                 f"{x['mean_weighted_cost_optimizer']} / {x['mean_weighted_cost_baseline']} |")
lines += ["", "Caveats: travel times are length / assumed free-flow speed; fleet, beds and incidents are simulated; the optimiser "
          "maximises priority-ordered coverage first, so it may serve *different* incidents than the baseline (weighted cost then "
          "is not a like-for-like comparison). No claim is made about real response times or outcomes.", "",
          f"Compute time for all runs: {r['compute_s']} s.", "", "## Per-run results", "",
          "| Seed | Condition | Incidents | Served H/M/L opt | H/M/L FIFO greedy | H/M/L priority greedy | Weighted opt | Weighted FIFO | Weighted priority |", "|---|---|---|---|---|---|---|---|---|"]
for x in r["runs"]:
    so, sb, sp = (x[k]["served_by_priority"] for k in ("optimizer", "baseline", "baseline_priority"))
    lines.append(f"| {x['seed']} | {x['condition']} | {x['incidents']} | {so['high']}/{so['medium']}/{so['low']} | "
                 f"{sb['high']}/{sb['medium']}/{sb['low']} | {sp['high']}/{sp['medium']}/{sp['low']} | {x['optimizer']['weighted_chain_cost']} | "
                 f"{x['baseline']['weighted_chain_cost']} | {x['baseline_priority']['weighted_chain_cost']} |")
Path("../docs/BENCHMARK_RESULTS.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines[:17]))

"""Exact joint ambulance -> incident -> hospital assignment (branch & bound) and a greedy baseline.

Pure functions over plain data so they can be verified against brute-force enumeration.

Objective (lexicographic, minimised):
  1. maximise number of served incidents per priority level, highest priority first
     (priority 3 = HIGH, 2 = MEDIUM, 1 = LOW);
  2. minimise weighted chain time  sum_served  priority * (t_ambulance->incident + t_incident->hospital);
  3. deterministic tie-break: lexicographically smallest (incident, ambulance, hospital) tuple list.
Constraints: each ambulance serves at most one incident; each hospital receives at most its
available beds; hospital must list the incident type as eligible; both legs must be reachable
on the open directed road graph (missing travel time => infeasible leg).
"""
from __future__ import annotations

from dataclasses import dataclass, field

PRIORITIES = (3, 2, 1)
UNSERVED = ("~", "~")  # sorts after any real ID in tie-break tuples


@dataclass
class Problem:
    incidents: list[dict]          # {id, priority:int, type:str, seq:int}
    ambulances: list[str]          # available ambulance IDs
    hospitals: dict[str, dict]     # id -> {beds:int, eligible_types:list[str]}
    t_resp: dict[tuple[str, str], float]   # (ambulance_id, incident_id) -> seconds (missing => unreachable)
    t_trans: dict[tuple[str, str], float]  # (incident_id, hospital_id) -> seconds (missing => unreachable)


@dataclass
class Plan:
    assignment: dict[str, tuple[str, str] | None]   # incident_id -> (ambulance_id, hospital_id) or None
    score: tuple = ()
    nodes_explored: int = 0
    infeasible_reasons: dict[str, str] = field(default_factory=dict)
    proven_optimal: bool = True


class _NodeLimit(Exception):
    pass


def options_for(p: Problem, inc: dict) -> list[tuple[float, str, str]]:
    """All individually-feasible (cost, ambulance, hospital) options for an incident, sorted."""
    opts = []
    for a in p.ambulances:
        t1 = p.t_resp.get((a, inc["id"]))
        if t1 is None:
            continue
        for h, hd in p.hospitals.items():
            if hd["beds"] <= 0 or inc["type"] not in hd["eligible_types"]:
                continue
            t2 = p.t_trans.get((inc["id"], h))
            if t2 is None:
                continue
            opts.append((round(inc["priority"] * (t1 + t2), 3), a, h))
    opts.sort()
    return opts


def score_of(p: Problem, assignment: dict[str, tuple[str, str] | None]) -> tuple:
    by_id = {i["id"]: i for i in p.incidents}
    served = {pr: 0 for pr in PRIORITIES}
    cost = 0.0
    for iid, ah in assignment.items():
        if ah is None:
            continue
        inc = by_id[iid]
        served[inc["priority"]] += 1
        cost += inc["priority"] * (p.t_resp[(ah[0], iid)] + p.t_trans[(iid, ah[1])])
    tie = tuple((iid, *(assignment[iid] or UNSERVED)) for iid in sorted(assignment))
    return tuple(-served[pr] for pr in PRIORITIES) + (round(cost, 3), tie)


def is_valid(p: Problem, assignment: dict[str, tuple[str, str] | None]) -> bool:
    used_a: set[str] = set()
    beds = {h: d["beds"] for h, d in p.hospitals.items()}
    by_id = {i["id"]: i for i in p.incidents}
    for iid, ah in assignment.items():
        if ah is None:
            continue
        a, h = ah
        if a in used_a or a not in p.ambulances or h not in beds:
            return False
        if by_id[iid]["type"] not in p.hospitals[h]["eligible_types"]:
            return False
        if (a, iid) not in p.t_resp or (iid, h) not in p.t_trans:
            return False
        used_a.add(a)
        beds[h] -= 1
        if beds[h] < 0:
            return False
    return True


def explain_infeasible(p: Problem, inc: dict) -> str:
    if not p.ambulances:
        return "No available ambulance in the fleet"
    if not any((a, inc["id"]) in p.t_resp for a in p.ambulances):
        return "No available ambulance can reach this location on open roads"
    elig = [h for h, d in p.hospitals.items() if inc["type"] in d["eligible_types"]]
    if not elig:
        return f"No hospital is eligible for type '{inc['type']}'"
    with_beds = [h for h in elig if p.hospitals[h]["beds"] > 0]
    if not with_beds:
        return "All eligible hospitals report zero available beds"
    if not any((inc["id"], h) in p.t_trans for h in with_beds):
        return "No eligible hospital with beds is reachable from this location on open roads"
    return "Feasible options exist but resources were allocated to higher-priority or better-matched incidents"


def solve(p: Problem, node_limit: int = 400_000) -> Plan:
    """Exact branch & bound. Anytime: if `node_limit` is reached, returns the best feasible plan found so far
    with proven_optimal=False (never raises, never fabricates)."""
    order = sorted(p.incidents, key=lambda i: (-i["priority"], i["seq"], i["id"]))
    opts = {i["id"]: options_for(p, i) for i in order}

    # feasible incumbent from priority-first greedy (same constraints) => strong early pruning + anytime result
    seed = greedy_baseline(p, "priority").assignment
    best: dict = {"score": score_of(p, seed), "assign": dict(seed)}
    explored = 0
    n = len(order)
    n_amb = len(p.ambulances)

    assign: dict[str, tuple[str, str] | None] = {}
    used_a: set[str] = set()
    beds = {h: d["beds"] for h, d in p.hospitals.items()}

    def rec(k: int, served: dict, cost: float):
        nonlocal explored
        explored += 1
        if explored > node_limit:
            raise _NodeLimit()
        if best["score"] is not None:
            # Optimistic bound: a remaining incident can only be served via an option whose ambulance is still unused
            # and whose hospital still has a bed (its cheapest such option lower-bounds its cost); at most `cap` more
            # incidents can be served; best coverage takes highest priorities first at their cheapest options.
            cap = min(n_amb - len(used_a), sum(b for b in beds.values() if b > 0))
            lv: dict[int, list[float]] = {pr: [] for pr in PRIORITIES}
            for inc_r in order[k:]:
                for c_r, a_r, h_r in opts[inc_r["id"]]:
                    if a_r not in used_a and beds[h_r] > 0:
                        lv[inc_r["priority"]].append(c_r)
                        break
            opt_served, lb = [], cost
            for pr in PRIORITIES:
                vals = sorted(lv[pr])
                take = min(cap, len(vals))
                opt_served.append(-(served[pr] + take))
                lb += sum(vals[:take])
                cap -= take
            bound = tuple(opt_served) + (round(lb - 0.01, 3),)  # small tolerance for rounding
            if bound > best["score"][:-1]:
                return
        if k == n:
            full = dict(assign)
            sc = score_of(p, full)
            if best["score"] is None or sc < best["score"]:
                best["score"], best["assign"] = sc, full
            return
        inc = order[k]
        iid = inc["id"]
        for c, a, h in opts[iid]:
            if a in used_a or beds[h] <= 0:
                continue
            used_a.add(a)
            beds[h] -= 1
            assign[iid] = (a, h)
            served[inc["priority"]] += 1
            rec(k + 1, served, cost + c)
            served[inc["priority"]] -= 1
            del assign[iid]
            beds[h] += 1
            used_a.discard(a)
        assign[iid] = None
        rec(k + 1, served, cost)
        del assign[iid]

    proven = True
    try:
        rec(0, {pr: 0 for pr in PRIORITIES}, 0.0)
    except _NodeLimit:
        proven = False
    result = best["assign"] if best["assign"] is not None else {}
    plan = Plan(assignment=result, score=best["score"] or (), nodes_explored=explored, proven_optimal=proven)
    for inc in p.incidents:
        if result.get(inc["id"]) is None:
            plan.infeasible_reasons[inc["id"]] = explain_infeasible(p, inc)
    return plan


def greedy_baseline(p: Problem, order: str = "fifo") -> Plan:
    """Nearest-feasible dispatch: incidents in arrival order (order="fifo") or highest priority first then
    arrival (order="priority"); each takes the nearest available reachable ambulance, then the nearest
    eligible reachable hospital with a free bed. Uses exactly the same constraints/travel times as the optimiser."""
    used_a: set[str] = set()
    beds = {h: d["beds"] for h, d in p.hospitals.items()}
    assignment: dict[str, tuple[str, str] | None] = {}
    plan = Plan(assignment=assignment)
    key = (lambda i: (i["seq"], i["id"])) if order == "fifo" else (lambda i: (-i["priority"], i["seq"], i["id"]))
    for inc in sorted(p.incidents, key=key):
        iid = inc["id"]
        amb = min(((p.t_resp[(a, iid)], a) for a in p.ambulances
                   if a not in used_a and (a, iid) in p.t_resp), default=None)
        hosp = min(((p.t_trans[(iid, h)], h) for h, d in p.hospitals.items()
                    if beds[h] > 0 and inc["type"] in d["eligible_types"] and (iid, h) in p.t_trans), default=None)
        if amb is None or hosp is None:
            assignment[iid] = None
            plan.infeasible_reasons[iid] = explain_infeasible(p, inc)
            continue
        used_a.add(amb[1])
        beds[hosp[1]] -= 1
        assignment[iid] = (amb[1], hosp[1])
    plan.score = score_of(p, assignment)
    return plan


def plan_metrics(p: Problem, plan: Plan) -> dict:
    by_id = {i["id"]: i for i in p.incidents}
    resp, chain = [], []
    served = {pr: 0 for pr in PRIORITIES}
    weighted = 0.0
    for iid, ah in plan.assignment.items():
        if ah is None:
            continue
        t1, t2 = p.t_resp[(ah[0], iid)], p.t_trans[(iid, ah[1])]
        pr = by_id[iid]["priority"]
        served[pr] += 1
        resp.append(t1)
        chain.append(t1 + t2)
        weighted += pr * (t1 + t2)
    hp = [p.t_resp[(plan.assignment[i["id"]][0], i["id"])] for i in p.incidents
          if i["priority"] == 3 and plan.assignment.get(i["id"])]
    return {
        "incidents_total": len(p.incidents),
        "incidents_served": len(resp),
        "served_by_priority": {"high": served[3], "medium": served[2], "low": served[1]},
        "total_response_s": round(sum(resp), 1),
        "mean_response_s": round(sum(resp) / len(resp), 1) if resp else None,
        "max_response_s": round(max(resp), 1) if resp else None,
        "mean_high_priority_response_s": round(sum(hp) / len(hp), 1) if hp else None,
        "total_chain_s": round(sum(chain), 1),
        "weighted_chain_cost": round(weighted, 1),
    }

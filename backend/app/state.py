"""In-memory scenario state: incidents, fleet, hospitals, closures, decisions, and replanning.

Every event (SOS, closure, capacity change, approval) replans UNAPPROVED incidents from this
server-side state. Approved decisions are never changed automatically; they are flagged for review.
"""
from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

from . import weather
from .graph import DATA_DIR, RoadGraph, haversine_m
from .optimizer import Problem, greedy_baseline, plan_metrics, solve

PRIORITY_LABEL = {3: "HIGH", 2: "MEDIUM", 1: "LOW"}
ACTIVE = ("pending", "reviewed", "recommended", "infeasible")
PLANNING_WINDOW = 10            # max simultaneous unapproved incidents in the exact search
DUPLICATE_WINDOW_S = 60
CLINIC_COVER_S = 600            # demand covered if within 10 min of a temporary site
POSITION_COVER_S = 300          # demand covered if an idle ambulance is within 5 min
EMERGENCY_TYPES = ("medical", "flood_rescue", "trauma")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def mins(s: float | None) -> str:
    return "n/a" if s is None else f"{s / 60:.1f} min"


class Scenario:
    def __init__(self, graph: RoadGraph, scenario: dict | None = None):
        self.graph = graph
        self.spec = scenario or json.loads((DATA_DIR / "scenario.json").read_text())
        self.reset()

    # ------------------------------------------------------------------ setup
    def _snap(self, item: dict) -> str:
        return item["node"] if "node" in item else self.graph.nearest_node(item["lat"], item["lon"])

    def reset(self) -> None:
        self.graph.closed.clear()
        s = self.spec
        self.inc_seq = 0
        self.dec_seq = 0
        self.extra_idx = 0
        self.plan_version = 0
        self.sim_time_s = 0.0
        self.events: list[dict] = []
        self.sos_index: dict[tuple, tuple[float, str]] = {}
        self.decisions: dict[str, dict] = {}
        self.alerts: list[dict] = []
        self.sos_locations = {l["id"]: {**l, "node": self._snap(l)} for l in s["sos_locations"]}
        self.ambulances = {a["id"]: {"id": a["id"], "label": a["label"], "node": self._snap(a),
                                     "status": a["status"], "home_node": self._snap(a)} for a in s["ambulances"]}
        self.hospitals = {h["id"]: {"id": h["id"], "name": h["name"], "node": self._snap(h),
                                    "beds_total": h["beds_total"], "beds_available": h["beds_available"],
                                    "eligible_types": list(h["eligible_types"]), "osm_mapped": h.get("osm_mapped", False), "temporary": False}
                          for h in s["hospitals"]}
        self.shelters = {x["id"]: {**x, "node": self._snap(x)} for x in s["shelters"]}
        self.evac_origins = {x["id"]: {**x, "node": self._snap(x)} for x in s["evacuation_origins"]}
        self.clinic_sites = {x["id"]: {**x, "node": self._snap(x)} for x in s["clinic_sites"]}
        self.staging_sites = {x["id"]: {**x, "node": self._snap(x)} for x in s["staging_sites"]}
        self.incidents: dict[str, dict] = {}
        for spec in s["seed_incidents"]:
            self._new_incident(spec["type"], spec["priority"], spec["label"], self._snap(spec), "scenario_seed", True)
        self.evacuation: dict[str, dict] = {}
        self.log("reset", "Scenario reset to deterministic initial state")
        self.replan("reset")

    def log(self, kind: str, message: str) -> None:
        self.events.append({"t": now_iso(), "kind": kind, "message": message})
        self.events = self.events[-200:]

    def _new_incident(self, typ: str, priority: int, label: str, node: str, source: str, confirmed: bool) -> dict:
        self.inc_seq += 1
        iid = f"INC-{self.inc_seq:04d}"
        lat, lon = self.graph.nodes[node]
        inc = {"id": iid, "type": typ, "priority": priority, "priority_confirmed": confirmed, "label": label,
               "node": node, "lat": lat, "lon": lon, "status": "pending" if not confirmed else "reviewed",
               "source": source, "seq": self.inc_seq, "created_at": now_iso(), "reason": None, "decision_id": None}
        self.incidents[iid] = inc
        return inc

    # ------------------------------------------------------------------ events
    def add_sos(self, location_id: str, emergency_type: str, client_token: str | None) -> tuple[dict, bool]:
        if location_id not in self.sos_locations:
            raise ValueError(f"unknown location_id '{location_id}'")
        if emergency_type not in ("medical", "flood_rescue"):
            raise ValueError("emergency_type must be 'medical' or 'flood_rescue'")
        key = (client_token or "anonymous", location_id, emergency_type)
        prev = self.sos_index.get(key)
        if prev and time.monotonic() - prev[0] < DUPLICATE_WINDOW_S and self.incidents[prev[1]]["status"] in ACTIVE:
            return self.incidents[prev[1]], True
        loc = self.sos_locations[location_id]
        inc = self._new_incident(emergency_type, 2, f"SOS: {loc['label']}", loc["node"], "citizen_sos", False)
        self.sos_index[key] = (time.monotonic(), inc["id"])
        self.log("sos", f"{inc['id']} simulated SOS received: {emergency_type} at {loc['label']} "
                        f"(default priority MEDIUM, awaiting dispatcher confirmation)")
        self.replan(f"new SOS {inc['id']}")
        return inc, False

    def add_incident(self, spec: dict | None) -> dict:
        if spec is None or not spec:
            extra = self.spec["extra_incidents"]
            spec = extra[self.extra_idx % len(extra)]
            self.extra_idx += 1
        typ = spec.get("type", "medical")
        if typ not in EMERGENCY_TYPES:
            raise ValueError(f"type must be one of {EMERGENCY_TYPES}")
        pr = int(spec.get("priority", 2))
        if pr not in (1, 2, 3):
            raise ValueError("priority must be 1, 2 or 3")
        node = spec["node"] if "node" in spec else self.graph.nearest_node(spec["lat"], spec["lon"])
        inc = self._new_incident(typ, pr, spec.get("label", "Dispatcher-added emergency (scenario)"), node,
                                 "dispatcher_simulation", True)
        self.log("incident", f"{inc['id']} simulated emergency added: {typ}, {PRIORITY_LABEL[pr]} at {inc['label']}")
        self.replan(f"new incident {inc['id']}")
        return inc

    def set_priority(self, iid: str, priority: int) -> dict:
        inc = self._get_incident(iid)
        if priority not in (1, 2, 3):
            raise ValueError("priority must be 1, 2 or 3")
        if inc["status"] not in ACTIVE:
            raise PermissionError(f"{iid} is {inc['status']}; priority locked")
        inc["priority"], inc["priority_confirmed"] = priority, True
        if inc["status"] == "pending":
            inc["status"] = "reviewed"
        self.log("priority", f"Dispatcher set {iid} priority to {PRIORITY_LABEL[priority]}")
        self.replan(f"priority change {iid}")
        return inc

    def close_edges(self, edge_ids: list[str], include_reverse: bool = True) -> list[str]:
        unknown = [e for e in edge_ids if e not in self.graph.edges]
        if unknown or not edge_ids:
            raise ValueError(f"unknown or empty edge ids: {unknown[:3]}")
        closed = []
        for e in edge_ids:
            for k in (e, self.graph.reverse_twin(e) if include_reverse else None):
                if k and k not in self.graph.closed:
                    self.graph.closed.add(k)
                    closed.append(k)
        names = sorted({self.graph.edges[k]["name"] or "unnamed road" for k in closed})
        self.log("closure", f"Confirmed closure (simulated): {len(closed)} directed edge(s) on {', '.join(names) or 'unnamed road'}")
        self.replan("road closure")
        return closed

    def close_on_decision(self, decision_id: str, leg: str = "to_incident") -> list[str]:
        d = self._get_decision(decision_id)
        route = d["route_to_incident"] if leg == "to_incident" else d["route_to_hospital"]
        segs = [s for s in route["segments"] if not any(k in self.graph.closed for k in s["edge_ids"])]
        if d["status"] == "approved":
            # a moving unit: only close road strictly ahead of it (not the edge it is on, not road behind it)
            _, _, a1, a2 = self._progress(d)
            ahead = set((a1 + a2)[1:])
            segs = [s for s in segs if all(k in ahead for k in s["edge_ids"])]
        if not segs:
            raise ValueError("this leg has no open road segment (ahead of the unit) to close")
        # prefer an intermediate segment (not touching the leg's start/end), so the closure tests rerouting rather
        # than simply cutting off the patient/hospital location; then longest; deterministic
        ends = {route["edge_ids"][0], route["edge_ids"][-1]} if route["edge_ids"] else set()
        mid = [s for s in segs if not ends & set(s["edge_ids"])]
        seg = max(mid or segs, key=lambda s: (s["length_m"], s["edge_ids"][0]))
        return self.close_edges(seg["edge_ids"])

    def close_flood_zone(self, zone_id: str) -> list[str]:
        """Dispatcher CONFIRMS closures for every directed edge with geometry inside a scenario flood zone."""
        z = next((z for z in self.spec["flood_zones"] if z["id"] == zone_id), None)
        if z is None:
            raise KeyError(zone_id)
        inside = [k for k, e in self.graph.edges.items()
                  if any(haversine_m((p[0], p[1]), (z["lat"], z["lon"])) <= z["radius_m"] for p in e["geometry"])]
        if not inside:
            raise ValueError(f"no road edges inside {zone_id}")
        self.log("closure", f"Dispatcher confirmed closure of scenario flood zone {zone_id} ({z['name']})")
        return self.close_edges(inside)

    def reopen_all(self) -> int:
        n = len(self.graph.closed)
        self.graph.closed.clear()
        self.log("closure", f"All {n} closed directed edges reopened (simulated)")
        self.replan("roads reopened")
        return n

    def set_hospital_beds(self, hid: str, beds: int) -> dict:
        h = self.hospitals.get(hid)
        if h is None:
            raise KeyError(hid)
        if beds < 0:
            raise ValueError("beds must be >= 0")
        h["beds_available"] = beds
        h["full_after_approval"] = beds == 0 and any(
            d["hospital_id"] == hid and d["status"] == "approved" for d in self.decisions.values())
        self.log("capacity", f"{hid} simulated available beds set to {beds}" + (" (FULL)" if beds == 0 else ""))
        self.replan(f"capacity change {hid}")
        return h

    def approve(self, decision_id: str) -> dict:
        d = self._get_decision(decision_id)
        if d["status"] != "recommended":
            raise PermissionError(f"{decision_id} is '{d['status']}', only current recommendations can be approved")
        problems = self._validate(d)
        if problems:
            raise PermissionError("recommendation no longer valid: " + "; ".join(problems))
        d["status"], d["approved_at"] = "approved", now_iso()
        d["elapsed_s"], d["phase"], d["blocked"] = 0.0, "to_incident", False
        inc = self.incidents[d["incident_id"]]
        if not inc["priority_confirmed"]:
            inc["priority_confirmed"] = True
            self.log("priority", f"Approval confirms {inc['id']} priority {PRIORITY_LABEL[inc['priority']]}")
        if d["reason"] and d["reason"][0].startswith("Priority"):
            d["reason"][0] = f"Priority {PRIORITY_LABEL[inc['priority']]} (confirmed by dispatcher approval)"
        inc["status"] = "approved"
        self.ambulances[d["ambulance_id"]]["status"] = "dispatched"
        self.hospitals[d["hospital_id"]]["beds_available"] -= 1
        self.log("approval", f"Dispatcher APPROVED {decision_id}: {d['ambulance_id']} -> {d['incident_id']} -> "
                             f"{d['hospital_id']} (simulated dispatch; no real unit contacted)")
        self.replan(f"approval {decision_id}")
        return d

    def accept_reroute(self, decision_id: str) -> dict:
        d = self._get_decision(decision_id)
        if d["status"] != "approved" or not d.get("suggested_reroute"):
            raise PermissionError("no suggested reroute awaiting review for this decision")
        sr = d["suggested_reroute"]
        # suggested routes start at the unit's CURRENT position; progress restarts on the new routes
        d["route_to_incident"], d["route_to_hospital"] = sr["route_to_incident"], sr["route_to_hospital"]
        d["estimated_ambulance_time_s"] = sr["route_to_incident"]["travel_time_s"]
        d["estimated_transport_time_s"] = sr["route_to_hospital"]["travel_time_s"]
        d["elapsed_s"], d["blocked"] = 0.0, False
        d["phase"] = self._progress(d)[0]
        d["suggested_reroute"], d["review_required"], d["alerts"] = None, False, []
        self.log("approval", f"Dispatcher accepted reroute for approved {decision_id}")
        self.replan(f"reroute accepted {decision_id}")
        return d

    def complete(self, decision_id: str) -> dict:
        d = self._get_decision(decision_id)
        if d["status"] != "approved":
            raise PermissionError("only approved decisions can be completed")
        d["status"] = "completed"
        self.incidents[d["incident_id"]]["status"] = "resolved"
        amb = self.ambulances[d["ambulance_id"]]
        amb["status"], amb["node"] = "available", self.hospitals[d["hospital_id"]]["node"]
        self.log("approval", f"{decision_id} marked complete; {amb['id']} available at {d['hospital_id']} (simulated)")
        self.replan(f"completion {decision_id}")
        return d

    # ------------------------------------------------------------------ simulation clock
    def _progress(self, d: dict) -> tuple[str, str, list[str], list[str]]:
        """(phase, last node passed, edges still ahead to incident, edges still ahead to hospital)."""
        e = d.get("elapsed_s", 0.0)
        r1, r2 = d["route_to_incident"]["edge_ids"], d["route_to_hospital"]["edge_ids"]
        t = 0.0
        for idx, k in enumerate(r1):
            te = self.graph.edges[k]["travel_time_s"]
            if t + te > e:
                return "to_incident", self.graph.edges[k]["u"], r1[idx:], r2
            t += te
        for idx, k in enumerate(r2):
            te = self.graph.edges[k]["travel_time_s"]
            if t + te > e:
                return "to_hospital", self.graph.edges[k]["u"], [], r2[idx:]
            t += te
        return "at_hospital", self.hospitals[d["hospital_id"]]["node"], [], []

    def _block_time(self, d: dict) -> float | None:
        """Elapsed time at which the unit reaches the start of the first closed edge still AHEAD of it
        (edges already fully driven are ignored). None if the route ahead is open."""
        t, e = 0.0, d.get("elapsed_s", 0.0)
        for k in d["route_to_incident"]["edge_ids"] + d["route_to_hospital"]["edge_ids"]:
            te = self.graph.edges[k]["travel_time_s"]
            if k in self.graph.closed and t + te > e:
                return t
            t += te
        return None

    def _last_divert_time(self, d: dict, block_t: float) -> float | None:
        """Latest node-arrival time in [current position, closure] from which the remaining destination is still
        reachable on open roads. None if no such point (destination cut off)."""
        e = d.get("elapsed_s", 0.0)
        r1, r2 = d["route_to_incident"]["edge_ids"], d["route_to_hospital"]["edge_ids"]
        inc_node = self.incidents[d["incident_id"]]["node"]
        to_inc = self.graph.times_to(inc_node)
        to_hosp = self.graph.times_to(self.hospitals[d["hospital_id"]]["node"])
        cands, t = [], 0.0
        for idx, k in enumerate(r1 + r2):
            te = self.graph.edges[k]["travel_time_s"]
            if t > block_t:
                break
            if t + te > e or t >= e:  # current edge start or any node ahead (up to the closure)
                reach = to_inc if idx < len(r1) else to_hosp
                if self.graph.edges[k]["u"] in reach:
                    cands.append(t)
            t += te
        return max(cands) if cands else None

    def advance(self, seconds: float) -> dict:
        """Move approved units along their approved routes. Units never drive onto a closed edge: they hold
        before it (BLOCKED) until the dispatcher accepts a reroute. Handover still needs the dispatcher."""
        if not 0 < seconds <= 3600:
            raise ValueError("seconds must be in (0, 3600]")
        self.sim_time_s += seconds
        for d in sorted(self.decisions.values(), key=lambda x: x["id"]):
            if d["status"] != "approved":
                continue
            before = d.get("phase")
            target = d.get("elapsed_s", 0.0) + seconds
            bt = self._block_time(d)
            if bt is not None:
                hold = self._last_divert_time(d, bt)  # don't pass the last point where a detour still exists
                cap = hold if hold is not None else bt
                d["blocked"] = target > cap
                d["elapsed_s"] = max(d.get("elapsed_s", 0.0), min(target, cap))
            else:
                d["blocked"] = False
                d["elapsed_s"] = target
            phase, node, _, _ = self._progress(d)
            d["phase"] = phase
            self.ambulances[d["ambulance_id"]]["node"] = node
            if phase != before:
                self.log("clock", f"{d['ambulance_id']} ({d['id']}): {before} -> {phase}"
                                  + (", awaiting dispatcher handover confirmation" if phase == "at_hospital" else ""))
            if d["blocked"]:
                self.log("alert", f"{d['ambulance_id']} ({d['id']}) holding before a closed road; reroute needs approval")
        self.log("clock", f"Simulation clock advanced {int(seconds)} s -> T+{int(self.sim_time_s // 60)}:{int(self.sim_time_s % 60):02d}")
        self.replan("clock advance")
        return {"sim_time_s": self.sim_time_s}

    # ------------------------------------------------------------------ planning
    def _get_incident(self, iid: str) -> dict:
        if iid not in self.incidents:
            raise KeyError(iid)
        return self.incidents[iid]

    def _get_decision(self, did: str) -> dict:
        if did not in self.decisions:
            raise KeyError(did)
        return self.decisions[did]

    def build_problem(self, incidents: list[dict] | None = None, ambulances: dict | None = None,
                      hospitals: dict | None = None) -> tuple[Problem, dict, dict]:
        incs = incidents if incidents is not None else self.active_incidents()
        ambs = ambulances if ambulances is not None else self.ambulances
        hosps = hospitals if hospitals is not None else self.hospitals
        avail = sorted(a for a, v in ambs.items() if v["status"] == "available")
        t_resp, t_trans = {}, {}
        amb_times = {a: self.graph.times_from(ambs[a]["node"]) for a in avail}
        inc_times = {}
        for i in incs:
            inc_times[i["id"]] = self.graph.times_from(i["node"])
            for a in avail:
                t = amb_times[a].get(i["node"])
                if t is not None:
                    t_resp[(a, i["id"])] = round(t, 1)
            for h, hd in hosps.items():
                t = inc_times[i["id"]].get(hd["node"])
                if t is not None:
                    t_trans[(i["id"], h)] = round(t, 1)
        p = Problem(
            incidents=[{"id": i["id"], "priority": i["priority"], "type": i["type"], "seq": i["seq"]} for i in incs],
            ambulances=avail,
            hospitals={h: {"beds": max(0, hd["beds_available"]), "eligible_types": hd["eligible_types"]}
                       for h, hd in hosps.items()},
            t_resp=t_resp, t_trans=t_trans)
        return p, amb_times, inc_times

    def active_incidents(self) -> list[dict]:
        act = [i for i in self.incidents.values() if i["status"] in ACTIVE]
        return sorted(act, key=lambda i: (-i["priority"], i["seq"]))

    def _validate(self, d: dict) -> list[str]:
        probs = []
        if d["status"] == "approved":
            _, _, ahead1, ahead2 = self._progress(d)
            edges = ahead1 + ahead2  # edges already driven cannot invalidate the dispatch
        else:
            edges = d["route_to_incident"]["edge_ids"] + d["route_to_hospital"]["edge_ids"]
        closed = [k for k in edges if k in self.graph.closed]
        if closed:
            names = sorted({self.graph.edges[k]["name"] or "unnamed road" for k in closed})
            probs.append(f"route uses closed road(s): {', '.join(names)}")
        h = self.hospitals[d["hospital_id"]]
        if d["status"] == "recommended" and h["beds_available"] <= 0:
            probs.append(f"{h['id']} reports no available beds")
        if d["status"] == "approved" and h["beds_available"] <= 0 and h.get("full_after_approval"):
            probs.append(f"{h['id']} reported full after approval; confirm bed with facility")
        if d["status"] == "recommended" and self.ambulances[d["ambulance_id"]]["status"] != "available":
            probs.append(f"{d['ambulance_id']} no longer available")
        return probs

    def replan(self, trigger: str) -> None:
        """Recompute recommendations for all unapproved active incidents from current server state."""
        t0 = time.perf_counter()
        self.plan_version += 1
        window = self.active_incidents()[:PLANNING_WINDOW]
        overflow = self.active_incidents()[PLANNING_WINDOW:]
        p, amb_times, _ = self.build_problem(window)
        plan = solve(p)
        old_by_inc = {d["incident_id"]: d for d in self.decisions.values() if d["status"] == "recommended"}
        taken_by = {ah[0]: iid for iid, ah in plan.assignment.items() if ah}
        hosp_load: dict[str, list[str]] = {}
        for iid, ah in plan.assignment.items():
            if ah:
                hosp_load.setdefault(ah[1], []).append(iid)
        changes = []
        for inc in window:
            iid = inc["id"]
            ah = plan.assignment.get(iid)
            old = old_by_inc.get(iid)
            if ah is None:
                inc["status"], inc["reason"], inc["decision_id"] = "infeasible", plan.infeasible_reasons.get(iid), None
                if old:
                    self._supersede(old, trigger, plan.infeasible_reasons.get(iid))
                    changes.append(f"{iid}: recommendation withdrawn: {plan.infeasible_reasons.get(iid)}")
                continue
            a, h = ah
            r1 = self.graph.route(self.ambulances[a]["node"], inc["node"])
            r2 = self.graph.route(inc["node"], self.hospitals[h]["node"])
            if (old and old["ambulance_id"] == a and old["hospital_id"] == h
                    and old["route_to_incident"]["edge_ids"] == r1["edge_ids"]
                    and old["route_to_hospital"]["edge_ids"] == r2["edge_ids"]):
                old["reason"] = self._reasons(p, inc, a, h, taken_by, hosp_load)
                inc["status"], inc["decision_id"], inc["reason"] = "recommended", old["id"], None
                continue
            dec = self._new_decision(inc, a, h, r1, r2, trigger, self._reasons(p, inc, a, h, taken_by, hosp_load))
            if old:
                why = self._invalidation(old, a, h, taken_by, trigger)
                self._supersede(old, trigger, why, dec["id"])
                changes.append(f"{iid}: {old['id']} -> {dec['id']} ({why})")
            inc["status"], inc["decision_id"], inc["reason"] = "recommended", dec["id"], None
        for inc in overflow:
            inc["status"], inc["decision_id"] = "infeasible", None
            inc["reason"] = f"Queued: beyond exact planning window of {PLANNING_WINDOW} simultaneous incidents"
            if inc["id"] in old_by_inc:
                self._supersede(old_by_inc[inc["id"]], trigger, inc["reason"])
        # approved decisions are immutable: validate and flag only
        for d in self.decisions.values():
            if d["status"] != "approved":
                continue
            probs = self._validate(d)
            if not probs:
                if d.get("review_required"):
                    d["review_required"], d["alerts"], d["suggested_reroute"] = False, [], None
                    self.log("alert", f"APPROVED {d['id']}: issue resolved (route ahead open again); review flag cleared")
                continue
            # suggestion is always recomputed from the unit's CURRENT position (it may have moved)
            phase, amb_node, _, _ = self._progress(d)
            inc = self.incidents[d["incident_id"]]
            hnode = self.hospitals[d["hospital_id"]]["node"]
            if phase == "to_incident":
                r1, r2 = self.graph.route(amb_node, inc["node"]), self.graph.route(inc["node"], hnode)
            else:  # patient on board: only the leg to hospital remains
                r1, r2 = self.graph.route(amb_node, amb_node), self.graph.route(amb_node, hnode)
            d["suggested_reroute"] = {"route_to_incident": r1, "route_to_hospital": r2} if r1 and r2 else None
            if not d.get("review_required") or d.get("alerts") != probs:
                d["review_required"], d["alerts"] = True, probs
                msg = f"APPROVED {d['id']} needs operator review: {'; '.join(probs)}. Not changed automatically."
                if d["suggested_reroute"] is None:
                    msg += " No open alternative route found."
                self.alerts.append({"t": now_iso(), "decision_id": d["id"], "message": msg})
                self.log("alert", msg)
        for c in changes:
            self.log("replan", c)
        if not plan.proven_optimal:
            self.log("replan", "Search limit reached: showing best feasible plan found; optimality NOT proven")
        self.last_plan = {"version": self.plan_version, "trigger": trigger, "nodes_explored": plan.nodes_explored,
                          "proven_optimal": plan.proven_optimal,
                          "compute_ms": round((time.perf_counter() - t0) * 1000, 1), "score": list(plan.score[:4]) if plan.score else [],
                          "at": now_iso(), "changes": changes}
        self.evacuation = {oid: self.evacuation_plan(oid, log=False) for oid in self.evac_origins}
        self.clinic = self.clinic_plan()
        self.position = self.positioning()

    def _new_decision(self, inc, a, h, r1, r2, trigger, reasons) -> dict:
        self.dec_seq += 1
        did = f"DEC-{self.dec_seq:04d}"
        d = {"id": did, "incident_id": inc["id"], "ambulance_id": a, "hospital_id": h,
             "route_to_incident": r1, "route_to_hospital": r2,
             "estimated_ambulance_time_s": r1["travel_time_s"], "estimated_transport_time_s": r2["travel_time_s"],
             "reason": reasons, "status": "recommended", "created_at": now_iso(), "trigger": trigger,
             "plan_version": self.plan_version, "review_required": False, "alerts": [], "suggested_reroute": None,
             "superseded_by": None, "invalidation": None}
        self.decisions[did] = d
        return d

    def _supersede(self, old: dict, trigger: str, why: str | None, new_id: str | None = None) -> None:
        old["status"], old["superseded_by"], old["invalidation"] = "superseded", new_id, why or trigger

    def _invalidation(self, old: dict, a: str, h: str, taken_by: dict, trigger: str) -> str:
        reasons = []
        closed = [k for k in old["route_to_incident"]["edge_ids"] + old["route_to_hospital"]["edge_ids"] if k in self.graph.closed]
        if closed:
            names = sorted({self.graph.edges[k]["name"] or "unnamed road" for k in closed})
            reasons.append(f"previous route used closed road(s): {', '.join(names)}")
        oh = self.hospitals[old["hospital_id"]]
        if old["hospital_id"] != h and oh["beds_available"] <= 0:
            reasons.append(f"{oh['id']} now reports no available beds")
        oa = old["ambulance_id"]
        if oa != a:
            if self.ambulances[oa]["status"] != "available":
                reasons.append(f"{oa} no longer available")
            elif oa in taken_by:
                reasons.append(f"{oa} re-allocated to {taken_by[oa]} by joint optimisation")
        if not reasons:
            reasons.append(f"better joint plan after {trigger}")
        return "; ".join(reasons)

    def _reasons(self, p: Problem, inc: dict, a: str, h: str, taken_by: dict, hosp_load: dict) -> list[str]:
        iid = inc["id"]
        t1, t2 = p.t_resp[(a, iid)], p.t_trans[(iid, h)]
        out = [f"Priority {PRIORITY_LABEL[inc['priority']]}"
               + ("" if inc["priority_confirmed"] else " (default, dispatcher has not confirmed)")]
        near_a = min(((t, x) for (x, i), t in p.t_resp.items() if i == iid), default=None)
        if near_a and near_a[1] == a:
            out.append(f"{a} is the nearest available ambulance on open roads ({mins(t1)})")
        elif near_a:
            other = taken_by.get(near_a[1])
            out.append(f"{a} reaches in {mins(t1)}; nearest {near_a[1]} ({mins(near_a[0])}) is allocated to {other}"
                       if other else f"{a} reaches in {mins(t1)} (jointly optimal; nearest {near_a[1]} {mins(near_a[0])})")
        hd = self.hospitals[h]
        out.append(f"{h} accepts '{inc['type']}', {hd['beds_available']} simulated bed(s) free, transport {mins(t2)}")
        elig = [(t, x) for (i, x), t in p.t_trans.items() if i == iid
                and p.hospitals[x]["beds"] > 0 and inc["type"] in p.hospitals[x]["eligible_types"]]
        near_h = min(elig, default=None)
        if near_h and near_h[1] != h:
            out.append(f"Nearest eligible {near_h[1]} ({mins(near_h[0])}) has its beds allocated to "
                       f"{', '.join(i for i in hosp_load.get(near_h[1], []) if i != iid) or 'other incidents'}")
        out.append("Route excludes all confirmed closed road edges; times = length / assumed speed (not live traffic)")
        return out

    # ------------------------------------------------------------------ metrics
    def metrics(self) -> dict:
        p, _, _ = self.build_problem(self.active_incidents()[:PLANNING_WINDOW])
        t0 = time.perf_counter(); opt = solve(p); t_opt = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter(); base = greedy_baseline(p); t_base = (time.perf_counter() - t0) * 1000
        base_p = greedy_baseline(p, "priority")
        current = {"optimizer": {**plan_metrics(p, opt), "compute_ms": round(t_opt, 2), "assignment": opt.assignment},
                   "baseline": {**plan_metrics(p, base), "compute_ms": round(t_base, 2), "assignment": base.assignment},
                   "baseline_priority": {**plan_metrics(p, base_p), "assignment": base_p.assignment},
                   "note": "Same unapproved incidents, available ambulances, bed counts, eligibility and closures for both."}
        return {"current": current, "benchmark": self.benchmark(),
                "definitions": {
                    "baseline": "Nearest-feasible greedy: incidents in arrival order (FIFO); nearest available reachable ambulance, then nearest eligible reachable hospital with a free bed.",
                    "baseline_priority": "Same greedy rule but incidents taken highest-priority first (stronger baseline).",
                    "optimizer": "Exact branch-and-bound: maximise served incidents by priority (HIGH first), then minimise sum(priority x (response + transport time)).",
                    "times": "Graph travel times from edge length / assumed free-flow speeds. Simulated scenario; not real-world outcomes."}}

    def benchmark(self) -> dict:
        key = frozenset(self.graph.closed)
        if getattr(self, "_bench_cache", (None,))[0] != key:
            self._bench_cache = (key, self._benchmark())
        return self._bench_cache[1]

    def _benchmark(self) -> dict:
        """Deterministic stress scenario: initial fleet/beds + all seed, extra and SOS-location incidents at once,
        under current road closures."""
        incs = []
        seq = 0
        specs = self.spec["seed_incidents"] + self.spec["extra_incidents"] + [
            {"type": "medical", "priority": 2, "lat": l["lat"], "lon": l["lon"]} for l in self.spec["sos_locations"]]
        for s in specs:
            seq += 1
            node = self.graph.nearest_node(s["lat"], s["lon"])
            incs.append({"id": f"B-{seq:02d}", "priority": s["priority"], "type": s["type"], "seq": seq, "node": node})
        ambs = {a["id"]: {"node": self.graph.nearest_node(a["lat"], a["lon"]), "status": a["status"]} for a in self.spec["ambulances"]}
        hosps = {h["id"]: {"node": self.graph.nearest_node(h["lat"], h["lon"]), "beds_available": h["beds_available"],
                           "eligible_types": h["eligible_types"]} for h in self.spec["hospitals"]}
        p, _, _ = self.build_problem(incs, ambs, hosps)
        t0 = time.perf_counter(); opt = solve(p); t_opt = (time.perf_counter() - t0) * 1000
        base = greedy_baseline(p)
        base_p = greedy_baseline(p, "priority")
        return {"description": f"{len(incs)} simultaneous simulated incidents, {len(p.ambulances)} available ambulances, "
                               f"{sum(h['beds'] for h in p.hospitals.values())} simulated beds, current closures",
                "optimizer": {**plan_metrics(p, opt), "compute_ms": round(t_opt, 2)},
                "baseline": plan_metrics(p, base), "baseline_priority": plan_metrics(p, base_p)}

    # ------------------------------------------------------------------ evacuation / clinic / positioning
    def evacuation_plan(self, origin_id: str, log: bool = True) -> dict:
        if origin_id not in self.evac_origins:
            raise KeyError(origin_id)
        o = self.evac_origins[origin_id]
        times = self.graph.times_from(o["node"])
        cands = sorted((round(times[s["node"]], 1), sid) for sid, s in self.shelters.items()
                       if s["node"] in times and s["capacity"] >= o["people"])
        if not cands:
            any_reach = any(s["node"] in times for s in self.shelters.values())
            why = ("No shelter with capacity >= %d people is reachable on open roads" % o["people"]) if any_reach else \
                "Origin is cut off from every shelter by confirmed closures. No road evacuation route; escalate for non-road rescue assessment"
            res = {"origin_id": origin_id, "status": "infeasible", "route": None, "shelter_id": None, "reason": why}
        else:
            t, sid = cands[0]
            route = self.graph.route(o["node"], self.shelters[sid]["node"])
            res = {"origin_id": origin_id, "status": "ok", "shelter_id": sid, "route": route,
                   "reason": f"Fastest reachable shelter with capacity >= {o['people']} people ({mins(t)} by road); "
                             f"{len(cands)} feasible shelter(s); closed edges excluded",
                   "alternatives": [{"shelter_id": s, "time_s": tt} for tt, s in cands[1:]]}
        if log:
            self.log("evacuation", f"Evacuation plan {origin_id}: {res['status']} {res.get('shelter_id') or ''}")
        return res

    def demand_points(self, include_approved: bool = True) -> list[dict]:
        statuses = ACTIVE + ("approved",) if include_approved else ACTIVE
        pts = [{"id": i["id"], "node": i["node"], "weight": i["priority"], "kind": "incident"}
               for i in self.incidents.values() if i["status"] in statuses]
        pts += [{"id": o["id"], "node": o["node"], "weight": round(o["people"] / 50, 1), "kind": "evacuation_cluster"}
                for o in self.evac_origins.values()]
        return pts

    def clinic_plan(self) -> dict:
        pts = self.demand_points()
        table = []
        for sid, s in self.clinic_sites.items():
            to_site = self.graph.times_to(s["node"])
            covered = [d for d in pts if d["node"] in to_site and to_site[d["node"]] <= CLINIC_COVER_S]
            w = round(sum(d["weight"] for d in covered), 1)
            reach = [to_site[d["node"]] for d in pts if d["node"] in to_site]
            mean_t = round(sum(reach) / len(reach), 1) if reach else None
            table.append({"site_id": sid, "covered_weight": w, "covered_ids": [d["id"] for d in covered],
                          "mean_time_s": mean_t, "unreachable": len(pts) - len(reach)})
        table.sort(key=lambda r: (-r["covered_weight"], r["mean_time_s"] if r["mean_time_s"] is not None else 1e9, r["site_id"]))
        best = table[0] if table and table[0]["covered_weight"] > 0 else None
        total = round(sum(d["weight"] for d in pts), 1)
        return {"status": "ok" if best else "infeasible", "site_id": best["site_id"] if best else None, "table": table,
                "total_demand_weight": total,
                "rule": f"Demand = unresolved incidents (weight = priority 1-3) + evacuation clusters (people/50). "
                        f"A site covers demand reachable within {CLINIC_COVER_S // 60} min on open roads. Pick max covered "
                        f"weight, then lowest mean travel time, then ID. Heuristic; not a full medical-logistics model.",
                "reason": (f"{best['site_id']} covers {best['covered_weight']} of {total} demand weight within "
                           f"{CLINIC_COVER_S // 60} min" if best else "No candidate site covers any demand on open roads")}

    def positioning(self) -> dict:
        pts = self.demand_points(include_approved=False)  # approved incidents already have a unit
        busy = {d["ambulance_id"] for d in self.decisions.values() if d["status"] in ("recommended", "approved")}
        avail = {a: v for a, v in self.ambulances.items() if v["status"] == "available"}
        idle = sorted(a for a in avail if a not in busy)
        amb_times = {a: self.graph.times_from(v["node"]) for a, v in avail.items()}

        def coverage(times_by_unit: dict[str, dict]) -> tuple[float, list[str]]:
            gaps, w = [], 0.0
            for d in pts:
                best = min((t[d["node"]] for t in times_by_unit.values() if d["node"] in t), default=None)
                if best is not None and best <= POSITION_COVER_S:
                    w += d["weight"]
                else:
                    gaps.append(d["id"])
            return round(w, 1), gaps

        base_w, gaps = coverage(amb_times)
        best = None
        stg_times = {sid: self.graph.times_from(s["node"]) for sid, s in self.staging_sites.items()}
        for a in idle:
            for sid in sorted(self.staging_sites):
                trial = dict(amb_times)
                trial[a] = stg_times[sid]
                w, g = coverage(trial)
                key = (-w, len(g), a, sid)
                if best is None or key < best[0]:
                    best = (key, a, sid, w, g)
        rec = None
        if best and best[3] > base_w:
            rec = {"ambulance_id": best[1], "staging_site_id": best[2], "covered_weight_after": best[3],
                   "remaining_gaps": best[4],
                   "reason": f"Moving idle {best[1]} to {self.staging_sites[best[2]]['name']} raises demand weight covered "
                             f"within {POSITION_COVER_S // 60} min from {base_w} to {best[3]}"}
        return {"covered_weight": base_w, "total_weight": round(sum(d["weight"] for d in pts), 1), "gaps": gaps,
                "idle_ambulances": idle, "recommendation": rec,
                "rule": f"Demand covered if any available ambulance can reach it within {POSITION_COVER_S // 60} min on open "
                        f"roads. Try each idle unit at each predefined staging site; pick largest covered weight."}

    def deploy_clinic(self, site_id: str, beds: int = 4) -> dict:
        """Dispatcher approves a temporary medical post at a predefined candidate site. It becomes a SIMULATED
        facility accepting only 'medical' cases (stabilisation), usable by the optimiser like any facility."""
        site = self.clinic_sites.get(site_id)
        if site is None:
            raise KeyError(site_id)
        if not 1 <= beds <= 20:
            raise ValueError("beds must be 1..20")
        hid = f"TMP-{site_id}"
        if hid in self.hospitals:
            raise PermissionError(f"temporary post already deployed at {site_id}")
        self.hospitals[hid] = {"id": hid, "name": f"Temporary medical post: {site['name']}", "node": site["node"],
                               "beds_total": beds, "beds_available": beds, "eligible_types": ["medical"],
                               "osm_mapped": False, "temporary": True}
        self.log("clinic", f"Dispatcher deployed temporary medical post {hid} ({beds} simulated beds, 'medical' cases only)")
        self.replan(f"temporary post {hid} deployed")
        return self.hospitals[hid]

    def apply_positioning(self, ambulance_id: str, site_id: str) -> dict:
        a = self.ambulances.get(ambulance_id)
        s = self.staging_sites.get(site_id)
        if a is None or s is None:
            raise KeyError(ambulance_id if a is None else site_id)
        if a["status"] != "available":
            raise PermissionError(f"{ambulance_id} is not available")
        a["node"] = s["node"]
        self.log("positioning", f"Dispatcher approved repositioning {ambulance_id} -> {s['name']} (simulated)")
        self.replan(f"repositioning {ambulance_id}")
        return a

    # ------------------------------------------------------------------ snapshot
    def snapshot(self) -> dict:
        g = self.graph
        closed = [{"edge_id": k, "name": g.edges[k]["name"], "geometry": g.edges[k]["geometry"]} for k in sorted(g.closed)]

        def pos(x):
            lat, lon = g.nodes[x["node"]]
            return {**x, "lat": lat, "lon": lon}

        return {
            "server_time": now_iso(),
            "sim_time_s": self.sim_time_s,
            "plan": self.last_plan,
            "graph": {"meta": g.meta, "nodes": len(g.nodes), "edges": len(g.edges), "label": g.meta.get("type")},
            "sources": self.sources(),
            "sos_locations": list(self.sos_locations.values()),
            "incidents": sorted(self.incidents.values(), key=lambda i: i["seq"]),
            "ambulances": [pos(a) for a in self.ambulances.values()],
            "hospitals": [pos(h) for h in self.hospitals.values()],
            "decisions": sorted(self.decisions.values(), key=lambda d: d["id"]),
            "closed_edges": closed,
            "shelters": [pos(x) for x in self.shelters.values()],
            "evacuation_origins": [pos(x) for x in self.evac_origins.values()],
            "evacuation": self.evacuation,
            "clinic": self.clinic,
            "positioning": self.position,
            "clinic_sites": [pos(x) for x in self.clinic_sites.values()],
            "staging_sites": [pos(x) for x in self.staging_sites.values()],
            "flood_zones": self.spec["flood_zones"],
            "weather": weather.cached(),
            "alerts": self.alerts[-20:],
            "events": self.events[-60:][::-1],
        }

    def _rain_source(self) -> dict:
        w = weather.cached()
        if w["status"] == "ok":
            return {"layer": "Rainfall", "label": w["label"], "source": w["source"], "observed_at": w["observed_at"], "simulated": False}
        return {"layer": "Rainfall", "label": "UNKNOWN / NOT CONNECTED", "source": w.get("reason", ""), "observed_at": None, "simulated": True}

    def sources(self) -> list[dict]:
        m = self.graph.meta
        hosp_osm = any(h["osm_mapped"] for h in self.hospitals.values())
        return [
            {"layer": "Road network", "label": m.get("type"), "source": m.get("source"), "observed_at": m.get("retrieved_at"),
             "simulated": m.get("type") != "REAL MAP GEOMETRY", "license": m.get("license")},
            {"layer": "Hospital locations", "label": "OSM-MAPPED LOCATION" if hosp_osm else "SCENARIO / SIMULATED",
             "source": "OpenStreetMap amenity=hospital" if hosp_osm else "Scenario file", "observed_at": None, "simulated": not hosp_osm},
            {"layer": "Hospital beds & eligibility", "label": "SCENARIO / SIMULATED", "source": "Scenario file", "observed_at": None, "simulated": True},
            {"layer": "Ambulance positions & availability", "label": "SCENARIO / SIMULATED", "source": "Scenario file", "observed_at": None, "simulated": True},
            {"layer": "Incidents / SOS", "label": "SCENARIO / SIMULATED", "source": "Demo SOS page & dispatcher simulation", "observed_at": None, "simulated": True},
            {"layer": "Road closures", "label": "SCENARIO / SIMULATED", "source": "Dispatcher simulation controls", "observed_at": None, "simulated": True},
            {"layer": "Flood zones", "label": "SCENARIO / SIMULATED", "source": "Hypothetical rule-based zones (not a forecast)", "observed_at": None, "simulated": True},
            self._rain_source(),
            {"layer": "Tide", "label": "UNKNOWN / NOT CONNECTED", "source": "No verified tide feed integrated", "observed_at": None, "simulated": True},
        ]


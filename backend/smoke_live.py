"""Live HTTP smoke test against a running backend (default http://127.0.0.1:8000).
Flow: reset -> SOS -> optimize -> close edge -> re-optimize -> fill hospital -> approve -> metrics -> reset.
Exit code 0 only if every check passes. Usage: .venv/bin/python smoke_live.py [base_url]"""
import sys
import requests

B = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000") + "/api"
ok = True


def check(cond, msg):
    global ok
    print(("PASS " if cond else "FAIL ") + msg)
    ok &= bool(cond)


def st():
    return requests.get(f"{B}/state", timeout=10).json()


def rec(s, iid):
    return next((d for d in s["decisions"] if d["status"] == "recommended" and d["incident_id"] == iid), None)


requests.post(f"{B}/reset", timeout=10)
s0 = st()
check(s0["graph"]["label"] == "REAL MAP GEOMETRY", f"graph label {s0['graph']['label']} ({s0['graph']['nodes']} nodes)")
r = requests.post(f"{B}/sos", json={"location_id": "kurla", "emergency_type": "medical", "client_token": "smoke"}, timeout=10).json()
rid = r["request_id"]
check(rid == "INC-0003" and not r["duplicate"], f"SOS accepted -> {rid}")
r2 = requests.post(f"{B}/sos", json={"location_id": "kurla", "emergency_type": "medical", "client_token": "smoke"}, timeout=10).json()
check(r2["request_id"] == rid and r2["duplicate"], "duplicate SOS suppressed")
s = requests.post(f"{B}/optimize", timeout=10).json()
d1 = rec(s, rid)
check(d1 is not None, f"recommendation {d1 and d1['id']}: {d1 and d1['ambulance_id']} -> {rid} -> {d1 and d1['hospital_id']} "
                      f"({d1 and d1['estimated_ambulance_time_s']} s + {d1 and d1['estimated_transport_time_s']} s)")
closed = set(requests.post(f"{B}/simulate/close-road", json={"decision_id": d1["id"]}, timeout=10).json()["closed_edge_ids"])
s = st()
d2 = rec(s, rid)
check(d2 is not None and not closed & set(d2["route_to_incident"]["edge_ids"] + d2["route_to_hospital"]["edge_ids"]),
      f"after closing {len(closed)} edges: new route {d2 and d2['id']} avoids them ({d2 and d2['estimated_ambulance_time_s']} s)")
requests.post(f"{B}/simulate/fill-hospital", json={"hospital_id": d2["hospital_id"]}, timeout=10)
d3 = rec(st(), rid)
check(d3 is not None and d3["hospital_id"] != d2["hospital_id"], f"{d2['hospital_id']} full -> now {d3 and d3['hospital_id']}")
a = requests.post(f"{B}/decisions/{d3['id']}/approve", timeout=10)
check(a.status_code == 200, f"approve {d3['id']} -> {a.status_code}")
m = requests.get(f"{B}/metrics", timeout=20).json()
bo, bb = m["benchmark"]["optimizer"], m["benchmark"]["baseline"]
check("weighted_chain_cost" in bo, f"benchmark optimiser weighted={bo['weighted_chain_cost']} baseline weighted={bb['weighted_chain_cost']}")
requests.post(f"{B}/reset", timeout=10)
s1 = st()
check([i["id"] for i in s1["incidents"]] == [i["id"] for i in s0["incidents"]] and not s1["closed_edges"], "reset restores initial state")
print("SMOKE", "PASSED" if ok else "FAILED")
sys.exit(0 if ok else 1)

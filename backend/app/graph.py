"""Directed road graph + closure-aware shortest paths (NetworkX Dijkstra).

Travel time = edge length / ASSUMED free-flow speed by OSM highway class.
These speeds are documented assumptions, NOT observed traffic.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import networkx as nx

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Assumed ambulance free-flow speeds (km/h) per OSM highway class. Documented assumption, not traffic data.
SPEED_KMH = {
    "motorway": 50, "motorway_link": 35,
    "trunk": 40, "trunk_link": 30,
    "primary": 35, "primary_link": 25,
    "secondary": 30, "secondary_link": 25,
    "tertiary": 25, "tertiary_link": 20,
    "unclassified": 20, "residential": 15,
}
DEFAULT_SPEED_KMH = 20


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


class RoadGraph:
    """MultiDiGraph keyed by stable edge IDs. `closed` holds closed directed edge IDs."""

    def __init__(self, nodes: dict[str, list[float]], edges: list[dict], meta: dict):
        self.meta = meta
        self.nodes: dict[str, tuple[float, float]] = {n: (float(c[0]), float(c[1])) for n, c in nodes.items()}
        self.edges: dict[str, dict] = {}
        self.G = nx.MultiDiGraph()
        self.G.add_nodes_from(self.nodes)
        self.closed: set[str] = set()
        for e in edges:
            eid = e.get("edge_id") or f"{e['u']}_{e['v']}_{e.get('key', 0)}"
            if "travel_time_s" in e:
                tt = float(e["travel_time_s"])
            else:
                speed = SPEED_KMH.get(e.get("highway"), DEFAULT_SPEED_KMH)
                tt = float(e["length_m"]) / (speed / 3.6)
            geom = e.get("geometry") or [list(self.nodes[e["u"]]), list(self.nodes[e["v"]])]
            self.edges[eid] = {
                "edge_id": eid, "u": e["u"], "v": e["v"], "length_m": float(e["length_m"]),
                "travel_time_s": round(tt, 3), "name": e.get("name"), "highway": e.get("highway"),
                "geometry": geom,
            }
            self.G.add_edge(e["u"], e["v"], key=eid)
        self._reverse = self._index_reverse_twins()

    # ---------- loading ----------
    @classmethod
    def load_osm(cls, path: Path | None = None) -> "RoadGraph":
        d = json.loads((path or DATA_DIR / "osm_graph.json").read_text())
        return cls(d["nodes"], d["edges"], d["meta"])

    @classmethod
    def synthetic_grid(cls, n: int = 8, spacing_m: float = 400.0) -> "RoadGraph":
        """Offline fallback: SYNTHETIC ROAD NETWORK (bidirectional grid). Never presented as Mumbai streets."""
        lat0, lon0 = 19.04, 72.86
        dlat = spacing_m / 111320
        dlon = spacing_m / (111320 * math.cos(math.radians(lat0)))
        nodes = {f"S{r}_{c}": [lat0 + r * dlat, lon0 + c * dlon] for r in range(n) for c in range(n)}
        edges = []
        for r in range(n):
            for c in range(n):
                for dr, dc in ((0, 1), (1, 0)):
                    r2, c2 = r + dr, c + dc
                    if r2 < n and c2 < n:
                        a, b = f"S{r}_{c}", f"S{r2}_{c2}"
                        edges.append({"u": a, "v": b, "length_m": spacing_m, "highway": "secondary", "name": f"Synthetic {a}-{b}"})
                        edges.append({"u": b, "v": a, "length_m": spacing_m, "highway": "secondary", "name": f"Synthetic {a}-{b}"})
        meta = {"source": "Generated offline grid", "type": "SYNTHETIC ROAD NETWORK", "retrieved_at": None,
                "license": "n/a", "note": "Fallback only — NOT Mumbai's street network"}
        return cls(nodes, edges, meta)

    def _index_reverse_twins(self) -> dict[str, str]:
        twins = {}
        for eid, e in self.edges.items():
            for k in self.G[e["v"]].get(e["u"], {}):
                if abs(self.edges[k]["length_m"] - e["length_m"]) <= max(2.0, 0.02 * e["length_m"]):
                    twins[eid] = k
                    break
        return twins

    def reverse_twin(self, eid: str) -> str | None:
        return self._reverse.get(eid)

    # ---------- geometry ----------
    def nearest_node(self, lat: float, lon: float) -> str:
        return min(self.nodes, key=lambda n: (haversine_m((lat, lon), self.nodes[n]), n))

    # ---------- routing ----------
    def _best_open_key(self, u: str, v: str) -> str | None:
        best = None
        for k in self.G[u][v]:
            if k in self.closed:
                continue
            if best is None or (self.edges[k]["travel_time_s"], k) < (self.edges[best]["travel_time_s"], best):
                best = k
        return best

    def _weight(self, u, v, keydict):
        times = [self.edges[k]["travel_time_s"] for k in keydict if k not in self.closed]
        return min(times) if times else None  # None => edge hidden (closed)

    def times_from(self, source: str) -> dict[str, float]:
        """Closure-aware travel time (s) from source to every reachable node."""
        return nx.single_source_dijkstra_path_length(self.G, source, weight=self._weight)

    def times_to(self, target: str) -> dict[str, float]:
        """Closure-aware travel time (s) from every node that can reach target."""
        R = self.G.reverse(copy=False)
        return nx.single_source_dijkstra_path_length(R, target, weight=self._weight)

    def route(self, source: str, target: str) -> dict | None:
        """Shortest open directed path. Returns None if unreachable. Same-node => zero-length route."""
        if source == target:
            return {"node_path": [source], "edge_ids": [], "polyline": [list(self.nodes[source])],
                    "travel_time_s": 0.0, "length_m": 0.0, "segments": []}
        try:
            path = nx.dijkstra_path(self.G, source, target, weight=self._weight)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
        edge_ids = []
        for u, v in zip(path, path[1:]):
            k = self._best_open_key(u, v)
            if k is None:  # defensive: Dijkstra never yields closed hop
                return None
            edge_ids.append(k)
        return self.describe_path(path, edge_ids)

    def describe_path(self, node_path: list[str], edge_ids: list[str]) -> dict:
        polyline: list[list[float]] = []
        for k in edge_ids:
            g = self.edges[k]["geometry"]
            polyline.extend(g if not polyline else g[1:])
        segments: list[dict] = []
        for k in edge_ids:
            e = self.edges[k]
            name = e["name"] or f"Unnamed {e['highway'] or 'road'}"
            if segments and segments[-1]["name"] == name:
                segments[-1]["edge_ids"].append(k)
                segments[-1]["length_m"] = round(segments[-1]["length_m"] + e["length_m"], 1)
            else:
                segments.append({"name": name, "edge_ids": [k], "length_m": e["length_m"]})
        return {
            "node_path": node_path, "edge_ids": edge_ids, "polyline": polyline,
            "travel_time_s": round(sum(self.edges[k]["travel_time_s"] for k in edge_ids), 1),
            "length_m": round(sum(self.edges[k]["length_m"] for k in edge_ids), 1),
            "segments": segments,
        }

    def path_is_open(self, edge_ids: list[str]) -> bool:
        return not any(k in self.closed for k in edge_ids)

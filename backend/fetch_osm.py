"""Fetch and cache a small directed OSM driving network for the Kurla–Sion–Chunabhatti pilot.
Run once: .venv/bin/python fetch_osm.py  -> writes data/osm_graph.json (+ retrieval metadata).
Data (c) OpenStreetMap contributors, ODbL 1.0."""
import json, datetime, sys
import osmnx as ox

BBOX = (72.855, 19.035, 72.905, 19.080)  # (west, south, east, north)
FILTER = '["highway"~"motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|unclassified"]'

def main():
    ox.settings.requests_timeout = 120
    G = ox.graph_from_bbox(BBOX, custom_filter=FILTER, simplify=True, retain_all=False, truncate_by_edge=True)
    G = ox.truncate.largest_component(G, strongly=True)
    nodes = {str(n): [round(d["y"], 6), round(d["x"], 6)] for n, d in G.nodes(data=True)}
    edges = []
    for u, v, k, d in G.edges(keys=True, data=True):
        if "geometry" in d:
            coords = [[round(y, 6), round(x, 6)] for x, y in d["geometry"].coords]
        else:
            coords = [nodes[str(u)], nodes[str(v)]]
        name = d.get("name")
        if isinstance(name, list): name = name[0]
        hw = d.get("highway")
        if isinstance(hw, list): hw = hw[0]
        edges.append({"u": str(u), "v": str(v), "key": int(k), "length_m": round(float(d["length"]), 1),
                      "highway": hw, "name": name, "geometry": coords})
    out = {"meta": {"source": "OpenStreetMap via OSMnx " + ox.__version__, "license": "ODbL 1.0, (c) OpenStreetMap contributors",
                    "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "bbox_wsen": BBOX,
                    "filter": FILTER, "type": "REAL MAP GEOMETRY", "note": "largest strongly connected component"},
           "nodes": nodes, "edges": edges}
    json.dump(out, open("data/osm_graph.json", "w"))
    print("nodes", len(nodes), "edges", len(edges))

if __name__ == "__main__":
    main()

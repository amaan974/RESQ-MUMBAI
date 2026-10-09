"""Fetch OSM-mapped hospital LOCATIONS (not capacity) inside the pilot bbox.
Run once: .venv/bin/python fetch_facilities.py -> data/osm_hospitals.json
Data (c) OpenStreetMap contributors, ODbL 1.0. Capacity/eligibility used by the app are SIMULATED."""
import json, datetime
import osmnx as ox

BBOX = (72.855, 19.035, 72.905, 19.080)

def main():
    ox.settings.requests_timeout = 60
    gdf = ox.features_from_bbox(BBOX, tags={"amenity": "hospital"})
    out = []
    for idx, row in gdf.iterrows():
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        c = row.geometry.centroid
        out.append({"osm_id": f"{idx[0]}/{idx[1]}", "name": name.strip(), "lat": round(c.y, 6), "lon": round(c.x, 6)})
    meta = {"source": "OpenStreetMap via OSMnx " + ox.__version__, "license": "ODbL 1.0 — (c) OpenStreetMap contributors",
            "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "bbox_wsen": BBOX,
            "note": "Mapped facility locations only. NOT live capacity, NOT verified service capability."}
    json.dump({"meta": meta, "hospitals": out}, open("data/osm_hospitals.json", "w"), indent=1)
    print(len(out), "named hospitals")
    for h in out: print(h)

if __name__ == "__main__":
    main()

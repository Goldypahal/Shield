"""Pack the synthetic graph into the compact structure used by web/engine.js and the explorer page.

    python web/build_web.py   ->  web/data.json and out/heimdal_route_explorer.html
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from heimdal_routing import synth  # noqa: E402
from heimdal_routing.geo import uv_to_latlon  # noqa: E402


def pack(doc: dict) -> dict:
    E = doc["edges"]
    codes = {k: sorted({e[k] for e in E}) for k in ("cls", "zone", "landuse", "lit")}
    codes["name"] = [""] + sorted({e["name"] for e in E if e["name"]})
    ix = {k: {v: i for i, v in enumerate(vals)} for k, vals in codes.items()}
    r = lambda x, n=1: round(x, n)  # noqa: E731
    edges = {
        "u": [e["u"] for e in E], "v": [e["v"] for e in E],
        "cls": [ix["cls"][e["cls"]] for e in E], "zone": [ix["zone"][e["zone"]] for e in E],
        "lu": [ix["landuse"][e["landuse"]] for e in E], "lit": [ix["lit"][e["lit"]] for e in E],
        "name": [ix["name"][e["name"]] for e in E],
        "len": [r(e["length_m"]) for e in E],
        "lamps": [-1 if e["lamps_per_100m"] is None else e["lamps_per_100m"] for e in E],
        "sw": [1 if e["sidewalk"] else 0 for e in E], "cams": [r(e["cctv_per_km"], 2) for e in E],
        "pol": [e["police_dist_m"] for e in E], "ffm": [e["footfall_mult"] for e in E],
        "conf": [e["confidence"] for e in E],
        "inc_day": [e["inc_day"] for e in E], "inc_evening": [e["inc_evening"] for e in E],
        "inc_night": [e["inc_night"] for e in E],
    }

    def poly(pts):
        return [[round(c, 5) for c in uv_to_latlon(u, v)] for u, v in pts]

    import math
    lake = poly([(2.5 + 0.62 * math.cos(t / 20 * 2 * math.pi), -2.45 + 0.5 * math.sin(t / 20 * 2 * math.pi)) for t in range(20)])
    overlays = {
        "lake": lake,
        "airport": poly([(3.7, 4.5), (6.3, 4.5), (6.3, 5.9), (3.7, 5.9)]),
        "railway": poly([(5.8, -4.3), (5.8, 4.5), (6.4, 7.5)]),
        "labels": [{"t": t, "p": [round(c, 5) for c in uv_to_latlon(u, v)]} for t, u, v in
                   [("CHANDIGARH", -1.0, 1.4), ("MOHALI", -1.4, 8.4), ("PANCHKULA", 8.6, 0.6),
                    ("ZIRAKPUR", 10.2, 6.8), ("Airport", 5.0, 5.2)]],
    }
    return {
        "meta": doc["meta"], "profiles": doc["footfall_profiles"], "codes": codes,
        "classLamps": synth.CLASS_LAMPS, "zoneLampMult": synth.ZONE_LAMP_MULT,
        "nodes": {"lat": [n["lat"] for n in doc["nodes"]], "lon": [n["lon"] for n in doc["nodes"]]},
        "edges": edges, "police": doc["police"], "landmarks": doc["landmarks"], "overlays": overlays,
        "incidents": [[i["lat"], i["lon"], i["period"]] for i in synth.generate().incidents],
    }


if __name__ == "__main__":
    doc = synth.to_graph_json(synth.generate())
    data = pack(doc)
    with open(os.path.join(HERE, "data.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    tpl = os.path.join(HERE, "explorer.template.html")
    if os.path.exists(tpl):
        css_path = os.environ.get("LEAFLET_CSS", os.path.join(HERE, "leaflet.css"))
        page = open(tpl).read()
        page = page.replace("/*LEAFLET_CSS*/", open(css_path).read())
        page = page.replace("/*ENGINE_JS*/", open(os.path.join(HERE, "engine.js")).read())
        page = page.replace("/*DATA_JSON*/", json.dumps(data, separators=(",", ":")).replace("</", "<\\/"))
        os.makedirs(os.path.join(HERE, "..", "out"), exist_ok=True)
        out = os.path.join(HERE, "..", "out", "heimdal_route_explorer.html")
        with open(out, "w") as f:
            f.write(page)
        print("wrote", os.path.relpath(out), f"{os.path.getsize(out) / 1024:.0f} KB")
    print("wrote web/data.json", f"{os.path.getsize(os.path.join(HERE, 'data.json')) / 1024:.0f} KB")

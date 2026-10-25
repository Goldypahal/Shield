"""Build a SafetyGraph from REAL OpenStreetMap geometry, with synthetic safety overlays.

Geometry, road class, names, `lit=*`, `sidewalk=*` and police stations come
from OpenStreetMap through OSMnx. Attributes OSM does not carry (footfall,
CCTV, incident history, data confidence) are filled from the same synthetic
model as synth.py, keyed by location. Replace those overlays with real
sources (municipal streetlight GIS, police open data, consented reports)
before any real-world use.

Requires network access to the Overpass API:  pip install osmnx
"""
from __future__ import annotations

import hashlib
import math

import numpy as np

from .geo import latlon_to_uv
from .synth import (CLASS_FOOTFALL_MULT, CLASS_LAMPS, LANDMARKS, FOOTFALL, ZONE_CONFIDENCE, ZONE_LAMP_MULT,
                    hotspot_intensity, landuse_at, make_hotspots, simulate_incidents, zone_at)

# west, south, east, north - Chandigarh, Mohali, Panchkula and Zirakpur
TRICITY_BBOX = (76.66, 30.62, 76.93, 30.80)

HIGHWAY_CLASS = {
    "motorway": "hwy", "trunk": "hwy", "motorway_link": "hwy", "trunk_link": "hwy",
    "primary": "V2", "primary_link": "V2", "secondary": "V2", "secondary_link": "V2",
    "tertiary": "V3", "tertiary_link": "V3",
    "residential": "V5", "living_street": "V5", "unclassified": "V5", "service": "V5", "road": "V5",
    "footway": "park_path", "path": "park_path", "pedestrian": "V4", "track": "park_path",
    "steps": "park_path", "cycleway": "park_path", "bridleway": "park_path", "corridor": "park_path",
}


def _first(x):
    return x[0] if isinstance(x, list) else x


def _det_random(*parts) -> float:
    """Deterministic pseudo-random number in [0, 1) from edge identity, so rebuilds are stable."""
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


def build_from_osm(bbox=TRICITY_BBOX, network_type: str = "walk", seed: int = 2026) -> dict:
    import osmnx as ox

    G = ox.graph_from_bbox(bbox, network_type=network_type, simplify=True)
    G = ox.convert.to_undirected(G)
    try:
        pol = ox.features_from_bbox(bbox, tags={"amenity": "police"})
        pts = pol.geometry.representative_point()
        police = [{"lat": float(p.y), "lon": float(p.x), "kind": "Police (OSM)"} for p in pts]
    except Exception:  # no police features returned
        police = []

    idx = {n: i for i, n in enumerate(G.nodes)}
    nodes = []
    for n, d in G.nodes(data=True):
        u, v = latlon_to_uv(d["y"], d["x"])
        nodes.append({"id": idx[n], "lat": round(d["y"], 6), "lon": round(d["x"], 6), "zone": zone_at(u, v) or "chd"})

    rng = np.random.default_rng(seed)
    hotspots = make_hotspots(rng)
    plat = np.array([p["lat"] for p in police]) if police else None
    plon = np.array([p["lon"] for p in police]) if police else None

    edges, seen = [], set()
    for a, b, k, d in G.edges(keys=True, data=True):
        key = (min(idx[a], idx[b]), max(idx[a], idx[b]))
        if key in seen:
            continue
        seen.add(key)
        hw = _first(d.get("highway", "unclassified"))
        cls = HIGHWAY_CLASS.get(hw, "V5")
        la, lo = (nodes[idx[a]]["lat"] + nodes[idx[b]]["lat"]) / 2, (nodes[idx[a]]["lon"] + nodes[idx[b]]["lon"]) / 2
        mu, mv = latlon_to_uv(la, lo)
        zone = zone_at(mu, mv) or "chd"
        lu = "highway" if cls == "hwy" else ("park" if cls == "park_path" else landuse_at(mu, mv, zone))
        length_m = float(d.get("length", 0.0)) or 1.0
        r = lambda tag: _det_random(a, b, k, tag)  # noqa: E731

        prior = CLASS_LAMPS[cls] * ZONE_LAMP_MULT.get(zone, 0.8)
        lit_tag = str(_first(d.get("lit", ""))).lower()
        if lit_tag in ("yes", "24/7", "automatic", "sunset-sunrise"):
            lit, lamps = "yes", round(max(prior, 1.5), 2)
        elif lit_tag in ("no", "disused"):
            lit, lamps = "no", 0.2
        elif lit_tag == "limited":
            lit, lamps = "limited", 0.7
        else:
            lit, lamps = "unknown", None

        sw = str(_first(d.get("sidewalk", ""))).lower()
        if sw in ("both", "left", "right", "yes", "separate"):
            sidewalk = True
        elif sw in ("no", "none"):
            sidewalk = False
        else:
            sidewalk = cls in ("park_path", "V4") or r("sw") < {"V2": .8, "V3": .7, "V5": .4, "hwy": .1}.get(cls, .5)

        foot_mult = CLASS_FOOTFALL_MULT[cls] * math.exp(0.25 * (r("ff") - 0.5) * 2)
        base_cam = {"commercial": 8, "transit": 10, "hospital": 7, "office": 6, "institutional": 4,
                    "industrial": 2, "residential": 1.2, "park": 0.5, "forest": 0.1, "highway": 1.5}[lu]
        cams = base_cam * (0.6 + 0.8 * r("cam"))
        if plat is not None:
            police_d = float(np.min(np.hypot((plat - la) * 110950, (plon - lo) * 95660)))
        else:
            police_d = 1500.0
        conf = ZONE_CONFIDENCE.get(zone, 0.6) + (0.1 if lit != "unknown" else -0.1)
        counts = simulate_incidents(lamps if lamps is not None else prior, lu, foot_mult, police_d, length_m,
                                    hotspot_intensity(mu, mv, hotspots), rng)
        name = _first(d.get("name", "")) or ""
        edges.append({
            "u": idx[a], "v": idx[b], "cls": cls, "name": str(name), "length_m": round(length_m, 1),
            "zone": zone, "landuse": lu, "lit": lit, "lamps_per_100m": lamps, "sidewalk": bool(sidewalk),
            "cctv_per_km": round(cams, 2), "police_dist_m": round(police_d), "footfall_mult": round(foot_mult, 3),
            "confidence": round(min(0.98, max(0.2, conf)), 3),
            "inc_day": counts["day"], "inc_evening": counts["evening"], "inc_night": counts["night"],
            "osm_highway": hw,
        })

    return {
        "meta": {"name": "Heimdal Tricity graph (OSM geometry + synthetic overlays)", "synthetic": True,
                 "warning": "Geometry from OpenStreetMap (ODbL). Safety attributes partly synthetic.",
                 "bbox": bbox, "network_type": network_type},
        "footfall_profiles": FOOTFALL,
        "nodes": nodes, "edges": edges, "police": police,
        "landmarks": [{"name": n, "lat": la, "lon": lo, "kind": k} for n, la, lo, k in LANDMARKS],
    }

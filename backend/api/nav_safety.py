"""
Safety scoring for any route in India.

For each candidate route (from Google or OSRM) this pulls OpenStreetMap data along the
route from Overpass and combines it with SHIELD's own incident data:

  lighting   OSM `lit=yes/no` on the roads the route uses, plus street lamps within 35 m
  activity   road class (main roads have more people around than footpaths and tracks)
  incidents  community hazard reports (last 30 days) and police hotspots for this hour
  help       police stations, emergency hospitals and anything tagged open 24/7 near the route

Nothing is invented: where OSM has no lighting tag the stretch is reported as "unknown",
and if Overpass cannot be reached the score uses the remaining components and is marked
partial. Long routes (> 60 km) are analysed for the first and last 10 km, where walking,
waiting and last-mile risk concentrate.
"""
import logging
import math
import os
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from nav_geo import LatLon, Projector, SegmentIndex, haversine, path_length, resample, simplify, slice_by_distance
from nav_providers import USER_AGENT

logger = logging.getLogger("shield-nav-safety")

OVERPASS_URLS = [u.strip() for u in os.environ.get(
    "OVERPASS_URLS", "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter").split(",") if u.strip()]
SAMPLE_M = 25.0
LONG_ROUTE_M = 60000.0
LONG_ROUTE_ENDS_M = 10000.0
ROAD_MATCH_M = 20.0
LAMP_RADIUS_M = 35.0
HELP_COVER_M = 500.0
PLACE_NEAR_M = 200.0
INCIDENT_RADIUS_M = 75.0
CACHE_TTL_S = 3600

OPEN_247 = "^(24/7|Mo-Su 00:00-24:00|00:00-24:00|Mo-Su 0:00-24:00)$"
_OPEN_247_RE = re.compile(OPEN_247.replace("^(", "^\\s*(").replace(")$", ")\\s*$"), re.IGNORECASE)

# How many people are usually around, by OSM road class (0..1)
ROAD_ACTIVITY = {
    "trunk": 1.0, "primary": 1.0, "secondary": 1.0, "tertiary": 0.9,
    "trunk_link": 0.9, "primary_link": 0.9, "secondary_link": 0.9, "tertiary_link": 0.8,
    "pedestrian": 0.8, "living_street": 0.6, "residential": 0.6, "unclassified": 0.5,
    "service": 0.4, "cycleway": 0.35, "footway": 0.3, "path": 0.25, "steps": 0.25, "track": 0.15,
    "motorway": 0.5, "motorway_link": 0.5,
}
ISOLATED_CLASSES = {"footway", "path", "steps", "track", "cycleway"}

# Score weights by time of day: lighting, incidents, help nearby, road activity
WEIGHTS = {
    "day":     {"lighting": 0.10, "incidents": 0.40, "help": 0.20, "activity": 0.30},
    "evening": {"lighting": 0.30, "incidents": 0.30, "help": 0.20, "activity": 0.20},
    "night":   {"lighting": 0.40, "incidents": 0.30, "help": 0.15, "activity": 0.15},
}
HAZARD_WEIGHT = {"blocked_path": 1.0, "harassment_spot": 1.0, "unsafe_zone": 0.8,
                 "dark_alley": 0.6, "broken_light": 0.4, "other": 0.3}


def period_for(hour: float) -> str:
    h = hour % 24
    return "day" if 6 <= h < 18 else "evening" if 18 <= h < 22 else "night"


# ---------------------------------------------------------------- Overpass

_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}


def _poly(coords: Sequence[LatLon]) -> str:
    return ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in coords)


def overpass_query(parts: List[List[LatLon]]) -> str:
    roads, lamps, help_ = [], [], []
    for part in parts:
        p = _poly(simplify(part, 120))
        roads.append(f'way["highway"](around:{ROAD_MATCH_M + 5:.0f},{p});')
        lamps.append(f'node["highway"="street_lamp"](around:{LAMP_RADIUS_M:.0f},{p});')
        help_.append(f'nwr["opening_hours"~"{OPEN_247}"](around:{PLACE_NEAR_M:.0f},{p});'
                     f'nwr["amenity"="police"](around:{PLACE_NEAR_M + 100:.0f},{p});'
                     f'nwr["amenity"="hospital"]["emergency"="yes"](around:{PLACE_NEAR_M + 100:.0f},{p});')
    # geom (road shapes) and center (one point per building) are separate output modes
    return ("[out:json][timeout:25];"
            f"({''.join(roads)})->.roads;({''.join(lamps)})->.lamps;({''.join(help_)})->.help;"
            ".roads out tags geom;.lamps out;.help out tags center;")


async def fetch_osm(parts: List[List[LatLon]]) -> Optional[Dict[str, Any]]:
    """OSM features along the given route parts, or None when Overpass is unavailable."""
    key = tuple(tuple((round(a, 4), round(b, 4)) for a, b in simplify(p, 40)) for p in parts)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    query = overpass_query(parts)
    # Budget for all mirrors together: the app waits at most 90 s for a whole plan, and
    # safety data is optional (routes are still returned without it).
    deadline = time.time() + 35.0
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0), headers={"User-Agent": USER_AGENT}) as client:
        for url in OVERPASS_URLS:
            if time.time() > deadline:
                break
            try:
                res = await client.post(url, data={"data": query})
                if res.status_code == 200:
                    data = res.json()
                    _cache[key] = (time.time(), data)
                    if len(_cache) > 500:
                        _cache.pop(next(iter(_cache)))
                    return data
                logger.warning("Overpass %s returned %s", url, res.status_code)
            except (httpx.HTTPError, ValueError) as e:
                logger.warning("Overpass %s failed: %s", url, e)
    return None


# ---------------------------------------------------------------- features

def _place_kind(tags: Dict[str, str]) -> str:
    a = tags.get("amenity", "")
    if a in ("pharmacy", "hospital", "police", "fuel", "atm"):
        return a
    if a == "clinic" or a == "doctors":
        return "hospital"
    if tags.get("shop"):
        return "convenience"
    return "other"


def parse_osm(data: Dict[str, Any]):
    roads, lamps, places = [], [], []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "way" and "highway" in tags and "geometry" in el:
            roads.append({"coords": [(g["lat"], g["lon"]) for g in el["geometry"]],
                          "cls": tags["highway"], "lit": tags.get("lit"), "name": tags.get("name", "")})
        elif el["type"] == "node" and tags.get("highway") == "street_lamp":
            lamps.append((el["lat"], el["lon"]))
        if tags.get("amenity") in ("police", "hospital") or "opening_hours" in tags:
            if "highway" in tags and tags.get("highway") != "services":
                continue
            lat = el.get("lat", el.get("center", {}).get("lat"))
            lon = el.get("lon", el.get("center", {}).get("lon"))
            if lat is None or lon is None:
                continue
            places.append({
                "id": f"{el['type']}/{el['id']}", "name": tags.get("name") or tags.get("brand") or "",
                "kind": _place_kind(tags), "lat": lat, "lon": lon,
                "phone": tags.get("phone") or tags.get("contact:phone") or "",
                "open_247": bool(_OPEN_247_RE.match(tags.get("opening_hours", ""))),
            })
    return roads, lamps, places


# ---------------------------------------------------------------- scoring

def score_route(coords: List[LatLon], distance_m: float, osm: Optional[Dict[str, Any]],
                incidents: List[Dict[str, Any]], period: str) -> Dict[str, Any]:
    """Safety breakdown for one route. `incidents`: dicts with lat, lon, weight, radius_m, public."""
    long_trip = distance_m > LONG_ROUTE_M
    parts = analysed_parts(coords, distance_m)
    proj = Projector(coords[len(coords) // 2][0])

    samples: List[Tuple[LatLon, float]] = []
    for part in parts:
        offset = 0.0 if part is parts[0] else distance_m - path_length(part)
        samples.extend((p, d + offset) for p, d in resample(part, SAMPLE_M))
    n = max(1, len(samples))

    roads, lamps, places = parse_osm(osm) if osm else ([], [], [])
    road_idx, lamp_idx = SegmentIndex(proj), SegmentIndex(proj, cell_m=50)
    for r in roads:
        road_idx.add_line(r["coords"], r)
    for lamp in lamps:
        lamp_idx.add_point(lamp, True)

    # Help places: those near the route, with where along the route they are
    route_idx = SegmentIndex(proj, cell_m=150)
    for i in range(len(coords) - 1):
        route_idx.add_line(coords[i:i + 2], i)
    help_idx = SegmentIndex(proj, cell_m=250)
    near_places = []
    seen = set()
    for pl in places:
        d, _ = route_idx.nearest((pl["lat"], pl["lon"]), PLACE_NEAR_M + 100)
        if d is None:
            continue
        help_idx.add_point((pl["lat"], pl["lon"]), True)
        if not pl["open_247"] and pl["kind"] not in ("police", "hospital"):
            continue
        dedupe = (pl["name"].lower(), pl["kind"], round(pl["lat"], 3), round(pl["lon"], 3))
        if dedupe in seen:
            continue
        seen.add(dedupe)
        along = min(samples, key=lambda s: haversine(s[0], (pl["lat"], pl["lon"])))[1]
        near_places.append({**pl, "distance_from_route_m": round(d), "along_m": round(along)})
    near_places.sort(key=lambda p: p["along_m"])

    # Incidents near the route (police hotspots are counted but never returned)
    inc_idx = SegmentIndex(proj, cell_m=150)
    for inc in incidents:
        inc_idx.add_point((inc["lat"], inc["lon"]), inc)

    lit = unlit = unknown = 0
    activity_sum, matched, busy = 0.0, 0, 0
    inc_search_m = max([INCIDENT_RADIUS_M] + [float(i.get("radius_m") or 0) for i in incidents])
    covered = 0
    flags: List[Optional[str]] = []
    hit_incidents: Dict[int, Dict[str, Any]] = {}
    for p, _ in samples:
        _, road = road_idx.nearest(p, ROAD_MATCH_M) if roads else (None, None)
        lamp_d, _ = lamp_idx.nearest(p, LAMP_RADIUS_M) if lamps else (None, None)
        if road is not None:
            activity_sum += ROAD_ACTIVITY.get(road["cls"], 0.5)
            matched += 1
            busy += ROAD_ACTIVITY.get(road["cls"], 0.5) >= 0.9
        if (road is not None and road["lit"] == "yes") or lamp_d is not None:
            lit += 1
            light_state = "lit"
        elif road is not None and road["lit"] == "no":
            unlit += 1
            light_state = "unlit"
        else:
            unknown += 1
            light_state = "unknown"
        if help_idx.nearest(p, HELP_COVER_M)[0] is not None:
            covered += 1
        d_inc, inc = inc_idx.nearest(p, inc_search_m) if incidents else (None, None)
        if inc is not None and d_inc <= max(INCIDENT_RADIUS_M, inc.get("radius_m", 0)):
            hit_incidents[id(inc)] = inc
        flag = None
        if light_state == "unlit" and period != "day":
            flag = "unlit"
        elif road is not None and road["cls"] in ISOLATED_CLASSES and period == "night":
            flag = "isolated"
        if inc is not None and d_inc <= INCIDENT_RADIUS_M:
            flag = "incident"
        flags.append(flag)

    analysed_km = max(0.05, n * SAMPLE_M / 1000.0)
    incident_load = sum(i.get("weight", 1.0) for i in hit_incidents.values())
    have_osm = osm is not None
    components: Dict[str, Optional[float]] = {
        "lighting": (lit + 0.4 * unknown) / n if have_osm else None,
        "activity": (activity_sum / matched) if matched else None,
        "incidents": 1.0 / (1.0 + 2.0 * incident_load / analysed_km),
        "help": covered / n if have_osm else None,
    }
    w = WEIGHTS[period]
    avail = {k: v for k, v in components.items() if v is not None}
    total_w = sum(w[k] for k in avail)
    score = round(100 * sum(w[k] * v for k, v in avail.items()) / total_w) if total_w else None

    return {
        "score": score,
        "partial": not have_osm,
        "long_trip": long_trip,
        "period": period,
        "lit_pct": round(100 * lit / n) if have_osm else None,
        "unlit_pct": round(100 * unlit / n) if have_osm else None,
        "unknown_light_pct": round(100 * unknown / n) if have_osm else None,
        "busy_road_pct": round(100 * busy / matched) if matched else None,
        "help_coverage_pct": round(100 * covered / n) if have_osm else None,
        "incidents": len(hit_incidents),
        "incident_reports": [
            {"lat": i["lat"], "lon": i["lon"], "category": i.get("category", "other")}
            for i in hit_incidents.values() if i.get("public")
        ],
        "places_247": [
            {k: p[k] for k in ("id", "name", "kind", "lat", "lon", "phone", "distance_from_route_m", "along_m", "open_247")}
            for p in near_places
        ][:40],
        "caution": caution_stretches(samples, flags),
        "components": {k: (round(100 * v) if v is not None else None) for k, v in components.items()},
    }


def analysed_parts(coords: List[LatLon], distance_m: float) -> List[List[LatLon]]:
    if distance_m <= LONG_ROUTE_M:
        return [list(coords)]
    head = slice_by_distance(coords, 0, LONG_ROUTE_ENDS_M)
    tail = slice_by_distance(coords, distance_m - LONG_ROUTE_ENDS_M, distance_m + 1)
    return [p for p in (head, tail) if len(p) >= 2]


def caution_stretches(samples: List[Tuple[LatLon, float]], flags: List[Optional[str]], min_m: float = 100.0):
    """Runs of flagged samples at least `min_m` long, for highlighting on the map."""
    out, i = [], 0
    while i < len(flags):
        if not flags[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(flags) and flags[j + 1] == flags[i]:
            j += 1
        if samples[j][1] - samples[i][1] >= min_m:
            out.append({"reason": flags[i], "start_m": round(samples[i][1]), "end_m": round(samples[j][1]),
                        "coords": [[round(p[0], 6), round(p[1], 6)] for p, _ in samples[i:j + 1]]})
        i = j + 1
    return out[:30]


def assign_badges(routes: List[Dict[str, Any]]) -> None:
    """Marks the safest, shortest and fastest route (a route can hold several badges)."""
    for r in routes:
        r["badges"] = []
    if not routes:
        return
    scored = [r for r in routes if r["safety"]["score"] is not None]
    if len(scored) >= 1 and len(routes) > 1:
        best = max(scored, key=lambda r: (r["safety"]["score"], -r["distance_m"]))
        best["badges"].append("safest")
    min(routes, key=lambda r: r["distance_m"])["badges"].append("shortest")
    min(routes, key=lambda r: r["duration_s"])["badges"].append("fastest")
    if len(routes) == 1 and routes[0]["safety"]["score"] is not None:
        routes[0]["badges"].insert(0, "safest")

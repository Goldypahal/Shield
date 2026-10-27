"""
Road class along a route, in about a second, from Valhalla's map matching
(trace_attributes on the FOSSGIS server, or VALHALLA_URL for a self-hosted one).

Why: the safety score's road-activity and isolated-stretch parts used to come only from
Overpass, which often takes 30+ s or fails outright. Valhalla matches the route to the
OpenStreetMap road graph and returns each edge's class and use (footway, path, track...)
in well under a second, so every route gets a real activity score at once; Overpass only
adds lighting, lamps and 24x7 places when it answers in time.
"""
import logging
import os
from bisect import bisect_left
from typing import List, Optional, Tuple

import httpx

from nav_geo import LatLon, haversine, simplify
from nav_providers import USER_AGENT

logger = logging.getLogger("shield-nav-roadclass")

VALHALLA_URL = os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de").rstrip("/")
COSTING = {"walk": "pedestrian", "bicycle": "bicycle", "two_wheeler": "motor_scooter", "car": "auto", "transit": "pedestrian"}
USE_AS_CLASS = {"footway": "footway", "path": "path", "steps": "steps", "track": "track", "cycleway": "cycleway",
                "pedestrian": "pedestrian", "living_street": "living_street", "sidewalk": "footway",
                "pedestrian_crossing": "footway", "alley": "service", "driveway": "service", "parking_aisle": "service"}
ROAD_CLASS = {"motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary",
              "tertiary": "tertiary", "unclassified": "unclassified", "residential": "residential", "service_other": "service"}


class EdgeProfile:
    """Road class by distance along the route: `at(d)` -> OSM-style highway class."""

    def __init__(self, ends_m: List[float], classes: List[str], sidewalk: List[bool]):
        self.ends, self.classes, self.sidewalk = ends_m, classes, sidewalk

    def at(self, d: float) -> Optional[str]:
        if not self.ends:
            return None
        i = min(bisect_left(self.ends, d), len(self.ends) - 1)
        return self.classes[i]

    def has_sidewalk(self, d: float) -> Optional[bool]:
        if not self.ends:
            return None
        return self.sidewalk[min(bisect_left(self.ends, d), len(self.ends) - 1)]


def parse_edges(edges: List[dict], route_len_m: float) -> Optional[EdgeProfile]:
    ends, classes, walk = [], [], []
    total = 0.0
    for e in edges:
        total += float(e.get("length", 0.0)) * 1000.0
        use = e.get("use", "road")
        cls = USE_AS_CLASS.get(use) or ROAD_CLASS.get(e.get("road_class", ""), "unclassified")
        ends.append(total)
        classes.append(cls)
        walk.append(e.get("sidewalk") not in (None, "none") or use in ("footway", "sidewalk", "pedestrian"))
    if not ends or total <= 0:
        return None
    # matched length can differ slightly from the router's; stretch to the route length
    k = route_len_m / total if route_len_m > 0 else 1.0
    return EdgeProfile([x * k for x in ends], classes, walk)


async def edge_profile(coords: List[LatLon], distance_m: float, mode: str, timeout_s: float = 6.0) -> Optional[EdgeProfile]:
    """Road classes along `coords`, or None when Valhalla is unreachable (score stays partial)."""
    pts = simplify(coords, 400)
    body = {
        "shape": [{"lat": round(a, 6), "lon": round(b, 6)} for a, b in pts],
        "costing": COSTING.get(mode, "pedestrian"),
        "shape_match": "map_snap",
        "filters": {"attributes": ["edge.length", "edge.road_class", "edge.use", "edge.sidewalk"], "action": "include"},
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=4.0), headers={"User-Agent": USER_AGENT}) as client:
            res = await client.post(f"{VALHALLA_URL}/trace_attributes", json=body)
        if res.status_code != 200:
            logger.warning("Valhalla trace_attributes %s: %s", res.status_code, res.text[:200])
            return None
        return parse_edges(res.json().get("edges", []), distance_m)
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Valhalla unreachable: %s", e)
        return None


def detour_vias(origin: LatLon, dest: LatLon) -> List[LatLon]:
    """Two via points left and right of the straight line, for extra route alternatives
    when the router returns fewer than four. Offset: 25 % of the trip, 250 m - 3 km."""
    d = haversine(origin, dest)
    off = max(250.0, min(3000.0, 0.25 * d))
    mid = ((origin[0] + dest[0]) / 2, (origin[1] + dest[1]) / 2)
    # unit perpendicular in metres -> degrees
    import math
    ky = 111320.0
    kx = 111320.0 * math.cos(math.radians(mid[0]))
    vx, vy = (dest[1] - origin[1]) * kx, (dest[0] - origin[0]) * ky
    n = math.hypot(vx, vy) or 1.0
    px, py = -vy / n, vx / n
    return [(mid[0] + s * py * off / ky, mid[1] + s * px * off / kx) for s in (1, -1)]


def overlap(a: List[LatLon], b: List[LatLon], tol_m: float = 25.0) -> float:
    """Share of route b's points lying within tol_m of route a (0..1)."""
    from nav_geo import Projector, SegmentIndex, path_length, resample
    if len(a) < 2 or len(b) < 2:
        return 0.0
    proj = Projector(a[len(a) // 2][0])
    idx = SegmentIndex(proj, cell_m=100)
    idx.add_line(a, True)
    # points evenly spaced along b (its vertices alone can be far apart)
    pts = simplify([p for p, _ in resample(b, max(10.0, path_length(b) / 60))], 60)
    near = sum(1 for p in pts if idx.nearest(p, tol_m)[0] is not None)
    return near / len(pts)


Edge = Tuple[float, str]

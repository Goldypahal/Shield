"""Synthetic Tricity (Chandigarh - Mohali - Panchkula - Zirakpur) safety dataset.

EVERYTHING GENERATED HERE IS SYNTHETIC. The road network follows the real
orientation and approximate extent of the Tricity sector grid, and a handful
of landmarks sit at their approximate real coordinates so the map is easy to
read. Lighting, footfall, CCTV, police posts, incidents and data confidence
are simulated. Nothing in this dataset says anything about how safe a real
street is. Use it to build and test the engine, never to advise real users.

Generation pipeline
-------------------
1. Lattice: a 400 m lattice in the rotated sector-grid frame (see geo.py).
2. Zones: each lattice point is assigned a zone (Chandigarh, Mohali,
   Panchkula, Zirakpur, industrial belt, IT Park/Manimajra) or dropped
   (Sukhna Lake, airport, railway corridor).
3. Edges: 4-neighbour lattice links, sector-park diagonals (walk-only
   shortcuts), Leisure Valley path, railway over-bridges and highways.
4. Attributes: road class, land use, lamp density, lit tag, sidewalk,
   CCTV density, distance to the nearest police post, hourly footfall
   multiplier, data confidence.
5. Incidents: a hidden hazard field (darkness x isolation x land use x
   hotspots) drives a Poisson process over 3 simulated years, recorded
   per edge for day / evening / night and as point records.
"""
from __future__ import annotations

import csv
import json
import math
import os
from dataclasses import dataclass, field

import numpy as np

from .geo import latlon_to_uv, uv_to_latlon

SEED = 2026
STEP = 0.4  # km
U0, V0 = -4.8, -4.2
NI, NJ = 42, 35  # lattice size: u in [-4.8, 11.6], v in [-4.2, 9.4]
SIM_YEARS = 3.0

# ---------------------------------------------------------------- landmarks
# Approximate public coordinates, used only to anchor and label the map.
LANDMARKS = [
    ("Sector 17 Plaza", 30.7398, 76.7827, "commercial"),
    ("PGIMER", 30.7649, 76.7757, "hospital"),
    ("Panjab University", 30.7600, 76.7680, "institutional"),
    ("Sukhna Lake", 30.7421, 76.8188, "park"),
    ("Rock Garden", 30.7525, 76.8101, "park"),
    ("ISBT Sector 43", 30.7225, 76.7517, "transit"),
    ("Elante Mall", 30.7056, 76.8013, "commercial"),
    ("Chandigarh Railway Station", 30.7025, 76.8222, "transit"),
    ("GMCH Sector 32", 30.7050, 76.7750, "hospital"),
    ("IT Park", 30.7290, 76.8460, "office"),
    ("PCA Stadium, Mohali", 30.6908, 76.7376, "institutional"),
    ("Fortis Hospital, Mohali", 30.6946, 76.7311, "hospital"),
    ("Mohali Phase 3B2 Market", 30.7060, 76.7230, "commercial"),
    ("Panchkula Sector 5", 30.6942, 76.8606, "commercial"),
    ("Mansa Devi Complex", 30.7330, 76.8590, "residential"),
    ("Zirakpur VIP Road", 30.6425, 76.8173, "commercial"),
]

ZONES = ["chd", "moh", "pkl", "zkp", "ind", "itp", "hwy"]
ZONE_NAMES = {
    "chd": "Chandigarh", "moh": "Mohali", "pkl": "Panchkula", "zkp": "Zirakpur",
    "ind": "Industrial Area", "itp": "IT Park / Manimajra", "hwy": "Highway",
}
LANDUSES = ["residential", "commercial", "institutional", "industrial", "office",
            "park", "forest", "transit", "hospital", "highway"]
CLASSES = ["V2", "V3", "V4", "V5", "park_path", "hwy", "bridge"]

# Hourly footfall profiles (0..1) by land use, hours 0..23. Hand-shaped.
FOOTFALL = {
    "residential":   [.10,.06,.04,.04,.05,.15,.35,.50,.55,.45,.40,.40,.40,.40,.40,.45,.55,.65,.70,.70,.60,.45,.30,.18],
    "commercial":    [.06,.04,.03,.03,.03,.06,.12,.25,.40,.55,.70,.80,.85,.85,.80,.80,.85,.90,.95,.95,.85,.60,.35,.15],
    "institutional": [.04,.03,.02,.02,.02,.04,.10,.35,.65,.75,.75,.75,.70,.70,.70,.65,.55,.40,.25,.15,.10,.07,.05,.04],
    "industrial":    [.05,.04,.03,.03,.04,.08,.25,.55,.65,.65,.60,.60,.55,.60,.60,.60,.55,.40,.20,.10,.07,.05,.05,.05],
    "office":        [.12,.10,.08,.08,.08,.10,.15,.30,.60,.80,.80,.80,.75,.80,.80,.80,.75,.65,.50,.40,.30,.25,.20,.15],
    "park":          [.02,.01,.01,.01,.05,.35,.65,.55,.30,.20,.15,.12,.10,.10,.12,.20,.40,.65,.70,.55,.30,.12,.05,.03],
    "forest":        [.01,.00,.00,.00,.01,.08,.20,.25,.25,.25,.25,.25,.25,.25,.25,.25,.25,.20,.10,.03,.01,.01,.01,.01],
    "transit":       [.35,.30,.30,.30,.35,.50,.65,.80,.90,.85,.80,.80,.80,.80,.80,.80,.85,.90,.90,.85,.75,.65,.55,.45],
    "hospital":      [.40,.35,.35,.35,.35,.45,.60,.80,.90,.90,.90,.90,.85,.85,.85,.85,.80,.75,.70,.65,.60,.55,.50,.45],
    "highway":       [.03,.02,.02,.02,.03,.05,.08,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.10,.08,.06,.05,.04,.03],
}
CLASS_FOOTFALL_MULT = {"V2": 1.0, "V3": 0.85, "V4": 1.15, "V5": 0.65, "park_path": 0.75, "hwy": 0.5, "bridge": 0.6}
CLASS_LAMPS = {"V2": 3.2, "V3": 2.6, "V4": 2.2, "V5": 1.3, "park_path": 0.45, "hwy": 2.4, "bridge": 2.8}  # lamps / 100 m
ZONE_LAMP_MULT = {"chd": 1.0, "moh": 0.9, "pkl": 0.92, "zkp": 0.6, "ind": 0.7, "itp": 0.85, "hwy": 0.9}
ZONE_CONFIDENCE = {"chd": 0.86, "moh": 0.72, "pkl": 0.75, "zkp": 0.45, "ind": 0.6, "itp": 0.7, "hwy": 0.7}

ROAD_NAMES = {  # approximate placement, for orientation only
    ("v", -3.0): "Uttar Marg (approx.)",
    ("v", -1.8): "Madhya Marg (approx.)",
    ("v", 0.6): "Udyog Path (approx.)",
    ("v", 3.0): "Dakshin Marg (approx.)",
    ("u", 0.4): "Jan Marg (approx.)",
    ("u", -2.8): "Himalaya Marg (approx.)",
    ("u", 4.4): "Purv Marg (approx.)",
    ("v", 6.6): "Airport Road (approx.)",
    ("u", 8.4): "Panchkula Main Road (approx.)",
}
ARTERIAL_V = {-1.8, 0.6, 3.0, 6.6}
ARTERIAL_U = {-2.8, 0.4, 4.4, -2.0, 8.4}


# ----------------------------------------------------------------- spatial
def zone_at(u: float, v: float) -> str | None:
    """Zone for a point in the sector-grid frame, or None for no-road areas."""
    if 3.6 <= u <= 6.4 and 4.4 <= v <= 6.0:
        return None  # airport
    if 1.9 <= u <= 3.1 and -3.05 <= v <= -1.9:
        return None  # Sukhna Lake
    if 5.5 < u < 6.1 and -4.3 <= v <= 4.5:
        return None  # railway corridor (crossed only by over-bridges)
    if -3.6 <= u <= 4.4 and -3.0 <= v <= 4.2:
        return "chd"
    if 4.4 < u <= 5.5 and -0.6 <= v <= 4.0:
        return "ind"
    if 4.4 < u <= 5.5 and -4.2 <= v < -0.6:
        return "itp"
    if -4.8 <= u <= 3.2 and 4.2 < v <= 9.4:
        return "moh"
    if 6.1 <= u <= 11.2 and -4.2 <= v <= 2.6:
        return "pkl"
    if 7.6 <= u <= 11.6 and 3.4 <= v <= 7.6:
        return "zkp"
    return None


_LM_UV = [(name, *latlon_to_uv(lat, lon), kind) for name, lat, lon, kind in LANDMARKS]


def _near_landmark(u: float, v: float, kinds: set[str], radius: float) -> bool:
    for _, lu, lv, kind in _LM_UV:
        if kind in kinds and (u - lu) ** 2 + (v - lv) ** 2 <= radius ** 2:
            return True
    return False


def _sector_index(u: float, v: float) -> tuple[int, int]:
    return math.floor((u + 3.6) / 0.8), math.floor((v + 3.0) / 1.2)


# Sector-grid cells (si, sj) designated commercial; Sector 17 is (4, 2).
COMMERCIAL_SECTORS = {(4, 2), (4, 3), (3, 3), (4, 4), (5, 4), (2, 5), (6, 3), (1, 2)}
COMMERCIAL_SECTORS_MOH = {(1, 7), (2, 8), (-1, 9), (3, 7)}
COMMERCIAL_SECTORS_PKL = {(15, 1), (14, 2), (17, 2)}


def landuse_at(u: float, v: float, zone: str | None = None) -> str:
    zone = zone or zone_at(u, v) or "hwy"
    if zone == "hwy":
        return "highway"
    if _near_landmark(u, v, {"hospital"}, 0.55):
        return "hospital"
    if _near_landmark(u, v, {"transit"}, 0.5):
        return "transit"
    if zone == "chd":
        if 0.75 <= u <= 1.9 and -3.0 <= v <= -2.2:
            return "forest"  # Rock Garden / forest edge
        if v < -1.8 and -0.4 <= u <= 1.9:
            return "institutional"  # Capitol Complex
        if _near_landmark(u, v, {"institutional"}, 0.7):
            return "institutional"
        if 1.85 <= u <= 3.3 and -3.0 <= v <= -1.7:
            return "park"  # lake promenade
    if zone == "ind":
        return "commercial" if _near_landmark(u, v, {"commercial"}, 0.6) else "industrial"
    if zone == "itp":
        return "office" if _near_landmark(u, v, {"office"}, 0.9) else "residential"
    si, sj = _sector_index(u, v)
    if zone == "chd" and (si, sj) in COMMERCIAL_SECTORS:
        return "commercial"
    if zone == "moh" and (si, sj) in COMMERCIAL_SECTORS_MOH:
        return "commercial"
    if zone == "pkl" and (si, sj) in COMMERCIAL_SECTORS_PKL:
        return "commercial"
    if _near_landmark(u, v, {"commercial"}, 0.5):
        return "commercial"
    if zone == "moh" and _near_landmark(u, v, {"institutional"}, 0.5):
        return "institutional"
    return "residential"


def darkness(hour: float) -> float:
    """0 in daylight, 1 at night. Tricity in late October: sunset ~17:40, sunrise ~06:35."""
    h = hour % 24
    if 7.0 <= h <= 17.0:
        return 0.0
    if 17.0 < h < 18.5:
        return (h - 17.0) / 1.5
    if 5.5 < h < 7.0:
        return (7.0 - h) / 1.5
    return 1.0


def period_of(hour: float) -> str:
    h = hour % 24
    if 7 <= h < 17:
        return "day"
    if 17 <= h < 21:
        return "evening"
    return "night"


PERIOD_HOURS = {"day": 12, "evening": 19, "night": 23}


def make_hotspots(rng: np.random.Generator, n: int = 9) -> list[tuple[float, float, float, float]]:
    return [(rng.uniform(-3.5, 11), rng.uniform(-4, 9), rng.uniform(0.3, 0.7), rng.uniform(0.8, 2.0))
            for _ in range(n)]


def hotspot_intensity(u: float, v: float, hotspots) -> float:
    return sum(s * math.exp(-((u - hu) ** 2 + (v - hv) ** 2) / (2 * r * r)) for hu, hv, r, s in hotspots)


def simulate_incidents(lamps: float, landuse: str, foot_mult: float, police_d: float, length_m: float,
                       hot: float, rng: np.random.Generator) -> dict[str, int]:
    """Poisson incident counts per period over SIM_YEARS from the hidden hazard field."""
    L = min(1.0, lamps / 2.5)
    counts = {}
    for per, hr in PERIOD_HOURS.items():
        d = darkness(hr)
        f = min(1.0, FOOTFALL[landuse][hr] * foot_mult)
        lu_f = ({"park": 1.7, "forest": 2.0, "industrial": 1.5, "commercial": 1.1}.get(landuse, 1.0) if d > 0.5
                else {"commercial": 1.4, "transit": 1.4}.get(landuse, 1.0))
        hazard = 0.18 * (1 + 2.2 * (1 - L) * d) * (1 + 1.6 * (1 - f)) * lu_f * (1 + hot) \
            * math.exp(-police_d / 2500)  # deterrence
        share = {"day": 10 / 24, "evening": 4 / 24, "night": 10 / 24}[per]
        counts[per] = int(rng.poisson(hazard * (length_m / 1000) * SIM_YEARS * share))
    return counts


# ------------------------------------------------------------- generation
@dataclass
class Dataset:
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    police: list[dict] = field(default_factory=list)
    incidents: list[dict] = field(default_factory=list)
    landmarks: list[dict] = field(default_factory=list)


class _Builder:
    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        self.nodes: list[dict] = []
        self.node_uv: list[tuple[float, float]] = []
        self.edges: list[dict] = []
        self.edge_keys: set[tuple[int, int]] = set()

    def add_node(self, u: float, v: float, zone: str) -> int:
        nid = len(self.nodes)
        lat, lon = uv_to_latlon(u, v)
        self.nodes.append({"id": nid, "lat": round(lat, 6), "lon": round(lon, 6), "zone": zone})
        self.node_uv.append((u, v))
        return nid

    def add_edge(self, a: int, b: int, cls: str, name: str = "") -> None:
        key = (min(a, b), max(a, b))
        if a == b or key in self.edge_keys:
            return
        self.edge_keys.add(key)
        self.edges.append({"u": a, "v": b, "cls": cls, "name": name})

    def nearest(self, u: float, v: float, zones: set[str] | None = None) -> int:
        best, bd = -1, 1e18
        for i, (nu, nv) in enumerate(self.node_uv):
            if zones and self.nodes[i]["zone"] not in zones:
                continue
            d = (nu - u) ** 2 + (nv - v) ** 2
            if d < bd:
                best, bd = i, d
        return best

    def chain(self, points: list[tuple[float, float]], cls: str, name: str,
              start_zones: set[str] | None, end_zones: set[str] | None) -> None:
        """Polyline road; endpoints snap to existing nodes, interior points become new nodes."""
        ids = [self.nearest(*points[0], start_zones)]
        for (u, v) in points[1:-1]:
            ids.append(self.add_node(u, v, "hwy"))
        ids.append(self.nearest(*points[-1], end_zones))
        for a, b in zip(ids, ids[1:]):
            self.add_edge(a, b, cls, name)


def _lattice_class(zone: str, along: str, i: int, j: int) -> tuple[str, str]:
    """Road class and name for a lattice edge. along='u' means the edge runs along u (constant v)."""
    u = round(U0 + STEP * i, 3)
    v = round(V0 + STEP * j, 3)
    if along == "u":
        line, coord = ("v", v), v
        boundary = (j - 3) % 3 == 0
        market = (j - 3) % 3 == 1
    else:
        line, coord = ("u", u), u
        boundary = (i - 3) % 2 == 0
        market = False
    name = ROAD_NAMES.get(line, "")
    if zone == "zkp":
        if boundary and ((along == "u" and (j - 3) % 6 == 0) or (along == "v" and (i - 3) % 4 == 0)):
            return "V3", name
        return "V5", name
    arterial = (along == "u" and coord in ARTERIAL_V) or (along == "v" and coord in ARTERIAL_U)
    if boundary:
        return ("V2" if arterial else "V3"), name
    return ("V4" if market else "V5"), name


def generate(seed: int = SEED) -> Dataset:
    b = _Builder(seed)
    rng = b.rng
    grid: dict[tuple[int, int], int] = {}

    # 1-2. lattice nodes
    for i in range(NI):
        for j in range(NJ):
            u, v = U0 + STEP * i, V0 + STEP * j
            z = zone_at(u, v)
            if z is None:
                continue
            ju = jv = 0.0
            if z == "zkp":
                ju, jv = rng.normal(0, 0.07, 2)
            elif z in ("moh", "pkl"):
                ju, jv = rng.normal(0, 0.015, 2)
            grid[(i, j)] = b.add_node(u + ju, v + jv, z)

    # 3a. lattice edges
    for (i, j), a in grid.items():
        za = b.nodes[a]["zone"]
        for di, dj, along in ((1, 0, "u"), (0, 1, "v")):
            nb = grid.get((i + di, j + dj))
            if nb is None:
                continue
            zb = b.nodes[nb]["zone"]
            zone = za if za == zb else ("chd" if "chd" in (za, zb) else za)
            cls, name = _lattice_class(zone, along, i, j)
            if zone == "zkp" and cls == "V5" and rng.random() < 0.22:
                continue  # irregular street pattern
            if zone in ("ind",) and cls == "V5" and rng.random() < 0.15:
                continue
            b.add_edge(a, nb, cls, name)

    # 3b. Leisure Valley: continuous park path along u = -1.6 through Chandigarh
    lv_i = round((-1.6 - U0) / STEP)
    for j in range(NJ):
        a, nb = grid.get((lv_i, j)), grid.get((lv_i, j + 1))
        if a is not None and nb is not None and b.nodes[a]["zone"] == b.nodes[nb]["zone"] == "chd":
            for e in b.edges:
                if {e["u"], e["v"]} == {a, nb}:
                    e["cls"], e["name"] = "park_path", "Leisure Valley path"

    # 3c. neighbourhood-park diagonals: walk-only shortcuts (~29% shorter than going around)
    for (i, j), a in grid.items():
        z = b.nodes[a]["zone"]
        if z not in ("chd", "moh", "pkl"):
            continue
        p = 0.22 if z == "chd" else 0.14
        if rng.random() < p:
            di = 1 if rng.random() < 0.5 else -1
            nb = grid.get((i + di, j + 1))
            if nb is not None and b.nodes[nb]["zone"] == z:
                b.add_edge(a, nb, "park_path", "Neighbourhood park path")

    # 3d. lake promenade around Sukhna (park path ring, lit only near the entry)
    ring = [(1.8, -3.0), (1.8, -1.85), (2.5, -1.75), (3.2, -1.85), (3.2, -2.6)]
    b.chain(ring, "park_path", "Sukhna Lake promenade", {"chd"}, {"chd"})

    # 3e. railway over-bridges and highways
    b.chain([(5.2, -1.8), (5.8, -1.8), (6.4, -1.8)], "bridge", "Manimajra ROB (approx.)", {"itp"}, {"pkl"})
    b.chain([(5.2, 0.6), (5.8, 0.55), (6.4, 0.6)], "bridge", "Housing Board ROB (approx.)", {"ind"}, {"pkl"})
    b.chain([(5.2, 3.2), (5.8, 3.4), (6.6, 3.4), (7.6, 3.6)], "hwy", "Chandigarh-Zirakpur Road (approx.)", {"ind"}, {"zkp"})
    b.chain([(2.8, 6.6), (3.6, 6.5), (4.6, 6.4), (5.6, 6.3), (6.6, 6.1), (7.6, 6.0)], "hwy",
            "Airport Road (approx.)", {"moh"}, {"zkp"})
    b.chain([(9.6, 2.6), (9.6, 3.0), (9.6, 3.4)], "hwy", "Panchkula-Zirakpur Road (approx.)", {"pkl"}, {"zkp"})
    b.chain([(4.4, 4.0), (4.0, 4.6), (3.2, 5.0)], "V2", "Airport link (approx.)", {"chd", "ind"}, {"moh"})

    # 4. attributes ---------------------------------------------------
    nodes = b.nodes
    uv = np.array(b.node_uv)

    # police posts: every ~2-3 sectors plus PCR points on arterial junctions (synthetic)
    police_uv = []
    for si in range(-1, 19, 2):
        for sj in range(-1, 11, 2):
            u = -3.6 + 0.8 * si + 0.4 + rng.normal(0, 0.15)
            v = -3.0 + 1.2 * sj + 0.6 + rng.normal(0, 0.2)
            z = zone_at(u, v)
            keep = {"chd": 0.85, "moh": 0.6, "pkl": 0.6, "zkp": 0.35, "ind": 0.5, "itp": 0.6}.get(z or "", 0)
            if rng.random() < keep:
                police_uv.append((u, v, "Police post (synthetic)"))
    for _, lu, lv, kind in _LM_UV:
        if kind in ("transit", "commercial") and rng.random() < 0.7:
            police_uv.append((lu + 0.1, lv - 0.1, "PCR point (synthetic)"))
    police_arr = np.array([(p[0], p[1]) for p in police_uv])

    hotspots = make_hotspots(rng)

    for e in b.edges:
        a, c = e["u"], e["v"]
        (ua, va), (uc, vc) = b.node_uv[a], b.node_uv[c]
        mu, mv = (ua + uc) / 2, (va + vc) / 2
        length_m = math.hypot(uc - ua, vc - va) * 1000
        za, zc = nodes[a]["zone"], nodes[c]["zone"]
        zone = za if za == zc else (zc if za == "hwy" else za)
        cls = e["cls"]
        if cls in ("hwy",):
            lu = "highway"
        elif cls == "park_path":
            lu = "park" if zone != "chd" or landuse_at(mu, mv, zone) != "forest" else "forest"
        else:
            lu = landuse_at(mu, mv, zone)
            if cls == "V4" and lu == "residential":
                lu = "commercial" if rng.random() < 0.55 else lu  # sector shopping streets
        if e["name"] == "Sukhna Lake promenade":
            lu = "park"

        # lighting
        lamps = CLASS_LAMPS[cls] * ZONE_LAMP_MULT.get(zone, 0.8) * rng.lognormal(0, 0.18)
        if e["name"] == "Sukhna Lake promenade":
            lamps *= 2.2
        outage = rng.random() < (0.07 if zone != "zkp" else 0.14)
        if outage:
            lamps *= 0.2
        conf = float(np.clip(ZONE_CONFIDENCE.get(zone, 0.6) + rng.normal(0, 0.08), 0.2, 0.98))
        if rng.random() < (1 - conf) * 0.8:
            lit, lamp_obs = "unknown", None
        else:
            lit = "yes" if lamps >= 1.0 else ("limited" if lamps >= 0.5 else "no")
            lamp_obs = round(lamps, 2)

        # footfall multiplier (applied to the land-use hourly profile)
        foot_mult = CLASS_FOOTFALL_MULT[cls] * rng.lognormal(0, 0.25)
        if zone == "zkp":
            foot_mult *= 0.85

        # CCTV cameras / km
        base_cam = {"commercial": 8, "transit": 10, "hospital": 7, "office": 6, "institutional": 4,
                    "industrial": 2, "residential": 1.2, "park": 0.5, "forest": 0.1, "highway": 1.5}[lu]
        if cls == "V2":
            base_cam += 3
        cams = base_cam * rng.lognormal(0, 0.4) * (0.4 if zone == "zkp" else 1.0)

        # sidewalk
        sw_p = {"V2": 0.95, "V3": 0.9, "V4": 0.85, "V5": 0.5, "park_path": 1.0, "hwy": 0.15, "bridge": 0.8}[cls]
        if zone in ("zkp", "ind"):
            sw_p *= 0.6
        sidewalk = bool(rng.random() < sw_p)

        police_d = float(np.min(np.hypot(police_arr[:, 0] - mu, police_arr[:, 1] - mv))) * 1000

        # 5. incidents from a hidden hazard field (per km per year)
        hot = hotspot_intensity(mu, mv, hotspots)
        counts = simulate_incidents(lamps, lu, foot_mult, police_d, length_m, hot, rng)

        e.update({
            "length_m": round(length_m, 1), "zone": zone, "landuse": lu,
            "lit": lit, "lamps_per_100m": lamp_obs, "sidewalk": sidewalk,
            "cctv_per_km": round(cams, 2), "police_dist_m": round(police_d),
            "footfall_mult": round(foot_mult, 3), "confidence": round(conf, 3),
            "inc_day": counts["day"], "inc_evening": counts["evening"], "inc_night": counts["night"],
            "_true_lamps": round(lamps, 2),  # hidden ground truth, used only for evaluation
        })

    # incident point records
    types = ["theft / snatching", "harassment", "suspicious activity", "assault", "vehicle-related"]
    incidents = []
    for k, e in enumerate(b.edges):
        a, c = nodes[e["u"]], nodes[e["v"]]
        for per in ("day", "evening", "night"):
            for _ in range(e[f"inc_{per}"]):
                t = rng.random()
                incidents.append({
                    "edge": k, "period": per,
                    "lat": round(a["lat"] + t * (c["lat"] - a["lat"]), 6),
                    "lon": round(a["lon"] + t * (c["lon"] - a["lon"]), 6),
                    "type": types[int(rng.choice(len(types), p=[.35, .25, .2, .1, .1]))],
                    "synthetic": True,
                })

    police = []
    for (u, v, kind) in police_uv:
        lat, lon = uv_to_latlon(u, v)
        police.append({"lat": round(lat, 6), "lon": round(lon, 6), "kind": kind})
    landmarks = [{"name": n, "lat": la, "lon": lo, "kind": k} for n, la, lo, k in LANDMARKS]
    for e in b.edges:
        for key in ("u", "v"):
            e[key] = int(e[key])
    return Dataset(nodes=nodes, edges=b.edges, police=police, incidents=incidents, landmarks=landmarks)


# ------------------------------------------------------------------ export
def to_graph_json(ds: Dataset) -> dict:
    """Self-contained graph document consumed by engine.SafetyGraph and the web explorer."""
    return {
        "meta": {
            "name": "Heimdal synthetic Tricity safety graph",
            "synthetic": True,
            "warning": "Synthetic data for engine development. Not real safety information.",
            "seed": SEED, "sim_years": SIM_YEARS,
        },
        "footfall_profiles": FOOTFALL,
        "nodes": ds.nodes,
        "edges": [{k: v for k, v in e.items() if not k.startswith("_")} for e in ds.edges],
        "police": ds.police,
        "landmarks": ds.landmarks,
    }


def write_all(out_dir: str, seed: int = SEED) -> Dataset:
    os.makedirs(out_dir, exist_ok=True)
    ds = generate(seed)
    with open(os.path.join(out_dir, "tricity_graph.json"), "w") as f:
        json.dump(to_graph_json(ds), f, separators=(",", ":"))

    def dump_csv(name: str, rows: list[dict]) -> None:
        with open(os.path.join(out_dir, name), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    dump_csv("nodes.csv", ds.nodes)
    dump_csv("edges.csv", ds.edges)
    dump_csv("police_posts.csv", ds.police)
    dump_csv("incidents.csv", ds.incidents)
    dump_csv("landmarks.csv", ds.landmarks)

    feats = []
    for e in ds.edges:
        a, c = ds.nodes[e["u"]], ds.nodes[e["v"]]
        props = {k: v for k, v in e.items() if k not in ("u", "v")}
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString", "coordinates": [[a["lon"], a["lat"]], [c["lon"], c["lat"]]]}})
    with open(os.path.join(out_dir, "edges.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    return ds


if __name__ == "__main__":
    import sys
    d = write_all(sys.argv[1] if len(sys.argv) > 1 else "data")
    print(f"nodes={len(d.nodes)} edges={len(d.edges)} police={len(d.police)} incidents={len(d.incidents)}")

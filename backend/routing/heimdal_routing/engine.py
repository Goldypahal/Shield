"""Heimdal safety-aware routing engine.

Finds the FASTEST, SAFEST and a BALANCED route between two points for a
given hour and travel mode, and explains the difference.

Model
-----
Every edge gets a time-dependent risk r(e, t) in [0, 1] (higher = riskier):

    r = w_light * dark(t) * (1 - L)        lighting matters only after dark
      + w_foot  * (1 - F(t))               fewer people around
      + w_cctv  * (1 - C)
      + w_pol   * (1 - P)                  distance to the nearest police post
      + w_inc   * I(period(t))             smoothed incident rate for that period
      + w_side  * (1 - S)                  no sidewalk (walking only)

Data uncertainty is kept separate from risk (U = 1 - confidence) and is
penalised, not hidden: unknown lighting uses a cautious class prior and the
route reports how much of it rests on unknown data.

Routes are found with A* on a generalised cost

    c_lambda(e) = time(e) * (1 + lambda * (r + mu * U + isolation_penalty))

swept over several lambda values. lambda = 0 is the fastest route. Among
the candidates within a detour budget (default 1.5x the fastest time) the
one with the lowest length-weighted risk is the SAFEST; the knee of the
time/risk Pareto front is the BALANCED route.

The engine never calls a route "safe". It reports a relative safety index
and the evidence behind it.
"""
from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass, field, asdict

import numpy as np

from .geo import haversine_m
from .synth import CLASS_LAMPS, ZONE_LAMP_MULT, darkness, period_of

PERIOD_SHARE = {"day": 10 / 24, "evening": 4 / 24, "night": 10 / 24}

WEIGHTS = {
    "walk":  {"light": 0.28, "foot": 0.22, "cctv": 0.08, "police": 0.12, "incident": 0.20, "sidewalk": 0.10},
    "drive": {"light": 0.30, "foot": 0.12, "cctv": 0.10, "police": 0.18, "incident": 0.30, "sidewalk": 0.00},
}
WALK_SPEED = {"park_path": 1.25}  # m/s, default below
WALK_DEFAULT = 1.33
DRIVE_KMH = {"V2": 45, "V3": 35, "V4": 20, "V5": 18, "hwy": 55, "bridge": 40}
LAMBDAS = (0.0, 0.5, 1.0, 2.0, 3.5, 5.0, 8.0, 12.0, 20.0)


def congestion(hour: float) -> float:
    h = int(hour) % 24
    if h in (9, 10, 17, 18, 19):
        return 0.62
    if h in (8, 11, 12, 13, 16, 20):
        return 0.8
    if h >= 23 or h <= 5:
        return 1.1
    return 0.95


def _interp_profile(profile: list[float], hour: float) -> float:
    h0 = int(math.floor(hour)) % 24
    h1 = (h0 + 1) % 24
    t = hour - math.floor(hour)
    return profile[h0] * (1 - t) + profile[h1] * t


@dataclass
class EdgeRisk:
    risk: float
    effective: float
    light: float
    footfall: float
    cctv: float
    police: float
    incident: float
    isolated: bool
    uncertainty: float


@dataclass
class Segment:
    from_node: int
    to_node: int
    edge: int
    length_m: float
    time_s: float
    risk: float
    name: str
    cls: str
    lit: str
    isolated: bool


@dataclass
class Route:
    label: str
    lam: float
    nodes: list[int]
    coords: list[tuple[float, float]]
    segments: list[Segment]
    distance_m: float = 0
    duration_s: float = 0
    safety_index: int = 0
    mean_risk: float = 0
    max_risk: float = 0
    lit_pct: float = 0
    unknown_light_pct: float = 0
    isolated_m: float = 0
    park_path_m: float = 0
    police_near: int = 0
    incidents: int = 0
    confidence: float = 0
    main_roads: list[str] = field(default_factory=list)
    highlights: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["segments"] = [asdict(s) for s in self.segments]
        return d


class SafetyGraph:
    """Undirected road graph with safety attributes (schema of synth.to_graph_json)."""

    def __init__(self, doc: dict):
        self.meta = doc.get("meta", {})
        self.profiles: dict[str, list[float]] = doc["footfall_profiles"]
        self.nodes = doc["nodes"]
        self.edges = doc["edges"]
        self.police = doc.get("police", [])
        self.landmarks = doc.get("landmarks", [])
        self.lat = np.array([n["lat"] for n in self.nodes])
        self.lon = np.array([n["lon"] for n in self.nodes])
        self.adj: list[list[tuple[int, int]]] = [[] for _ in self.nodes]
        for k, e in enumerate(self.edges):
            self.adj[e["u"]].append((e["v"], k))
            self.adj[e["v"]].append((e["u"], k))
        self.drivable_node = np.zeros(len(self.nodes), bool)
        for e in self.edges:
            if e["cls"] != "park_path":
                self.drivable_node[e["u"]] = self.drivable_node[e["v"]] = True
        self.police_lat = np.array([p["lat"] for p in self.police]) if self.police else np.zeros(0)
        self.police_lon = np.array([p["lon"] for p in self.police]) if self.police else np.zeros(0)

    @classmethod
    def load(cls, path: str) -> "SafetyGraph":
        with open(path) as f:
            return cls(json.load(f))

    def nearest_node(self, lat: float, lon: float, mode: str = "walk") -> int:
        d2 = (self.lat - lat) ** 2 + ((self.lon - lon) * math.cos(math.radians(lat))) ** 2
        if mode == "drive":
            d2 = np.where(self.drivable_node, d2, np.inf)
        return int(np.argmin(d2))

    def find_place(self, name: str) -> tuple[float, float]:
        q = name.lower()
        for lm in self.landmarks:
            if q in lm["name"].lower():
                return lm["lat"], lm["lon"]
        raise KeyError(f"Unknown place {name!r}. Known: {[l['name'] for l in self.landmarks]}")


class RiskModel:
    def __init__(self, graph: SafetyGraph, mode: str = "walk", unknown_penalty: float = 0.15,
                 isolation_penalty: float = 0.25, incident_scale: float = 1.2):
        self.g = graph
        self.mode = mode
        self.w = WEIGHTS[mode]
        self.mu = unknown_penalty
        self.iso = isolation_penalty
        self.inc_scale = incident_scale
        self._cache: dict[tuple[int, float], EdgeRisk] = {}

    def lighting_score(self, e: dict) -> float:
        if e.get("lamps_per_100m") is not None:
            return min(1.0, e["lamps_per_100m"] / 2.5)
        prior = CLASS_LAMPS.get(e["cls"], 1.2) * ZONE_LAMP_MULT.get(e.get("zone", ""), 0.8)
        return min(1.0, 0.8 * prior / 2.5)  # cautious prior when lighting is unknown

    def edge_risk(self, k: int, hour: float) -> EdgeRisk:
        key = (k, round(hour, 2))
        hit = self._cache.get(key)
        if hit:
            return hit
        e = self.g.edges[k]
        d = darkness(hour)
        L = self.lighting_score(e)
        F = min(1.0, _interp_profile(self.g.profiles[e["landuse"]], hour) * e["footfall_mult"])
        C = 1 - math.exp(-e["cctv_per_km"] / 4.0)
        P = math.exp(-e["police_dist_m"] / 700.0)
        per = period_of(hour)
        km_years = e["length_m"] / 1000 * 3.0 * PERIOD_SHARE[per]
        rate = (e[f"inc_{per}"] + 0.5) / (km_years + 1.0)  # empirical-Bayes shrinkage, per km-year
        I = 1 - math.exp(-rate / self.inc_scale)
        S = 1.0 if e["sidewalk"] else 0.0
        w = self.w
        r = (w["light"] * d * (1 - L) + w["foot"] * (1 - F) + w["cctv"] * (1 - C)
             + w["police"] * (1 - P) + w["incident"] * I + w["sidewalk"] * (1 - S))
        r = min(1.0, max(0.0, r))
        isolated = d > 0.5 and F < 0.15 and L < 0.4
        U = 1 - e["confidence"]
        eff = r + self.mu * U + (self.iso if isolated else 0.0)
        out = EdgeRisk(r, eff, L, F, C, P, I, isolated, U)
        self._cache[key] = out
        return out

    def travel_time(self, k: int, hour: float) -> float:
        e = self.g.edges[k]
        if self.mode == "walk":
            return e["length_m"] / WALK_SPEED.get(e["cls"], WALK_DEFAULT)
        if e["cls"] == "park_path":
            return math.inf
        return e["length_m"] / (DRIVE_KMH[e["cls"]] / 3.6 * congestion(hour))


class SafeRouter:
    def __init__(self, graph: SafetyGraph):
        self.g = graph

    # -- core search ---------------------------------------------------
    def _astar(self, src: int, dst: int, model: RiskModel, hour: float, lam: float) -> list[tuple[int, int]] | None:
        g = self.g
        vmax = (WALK_DEFAULT if model.mode == "walk" else max(DRIVE_KMH.values()) / 3.6 * 1.1) * 1.02
        tlat, tlon = g.lat[dst], g.lon[dst]

        def h(n: int) -> float:
            return 0.97 * haversine_m(g.lat[n], g.lon[n], tlat, tlon) / vmax

        best = {src: 0.0}
        prev: dict[int, tuple[int, int]] = {}
        pq = [(h(src), 0.0, src)]
        closed = set()
        while pq:
            _, cost, n = heapq.heappop(pq)
            if n in closed:
                continue
            if n == dst:
                path = []
                while n != src:
                    p, k = prev[n]
                    path.append((p, k))
                    n = p
                return path[::-1]
            closed.add(n)
            for m, k in g.adj[n]:
                t = model.travel_time(k, hour)
                if not math.isfinite(t):
                    continue
                c = t if lam == 0 else t * (1 + lam * model.edge_risk(k, hour).effective)
                nc = cost + c
                if nc < best.get(m, math.inf):
                    best[m] = nc
                    prev[m] = (n, k)
                    heapq.heappush(pq, (nc + h(m), nc, m))
        return None

    # -- route assembly ------------------------------------------------
    def _build(self, label: str, lam: float, path: list[tuple[int, int]], model: RiskModel, hour: float) -> Route:
        g = self.g
        segs: list[Segment] = []
        nodes = [path[0][0]] if path else []
        for (a, k) in path:
            e = g.edges[k]
            b = e["v"] if e["u"] == a else e["u"]
            er = model.edge_risk(k, hour)
            segs.append(Segment(a, b, k, e["length_m"], model.travel_time(k, hour), round(er.risk, 4),
                                e.get("name", ""), e["cls"], e["lit"], er.isolated))
            nodes.append(b)
        r = Route(label, lam, nodes, [(float(g.lat[n]), float(g.lon[n])) for n in nodes], segs)
        L = sum(s.length_m for s in segs) or 1.0
        r.distance_m = round(L)
        r.duration_s = round(sum(s.time_s for s in segs))
        r.mean_risk = round(sum(s.risk * s.length_m for s in segs) / L, 4)
        r.max_risk = round(max((s.risk for s in segs), default=0), 4)
        r.safety_index = int(round(100 * (1 - r.mean_risk)))
        r.lit_pct = round(100 * sum(s.length_m for s in segs if s.lit == "yes") / L, 1)
        r.unknown_light_pct = round(100 * sum(s.length_m for s in segs if s.lit == "unknown") / L, 1)
        r.isolated_m = round(sum(s.length_m for s in segs if s.isolated))
        r.park_path_m = round(sum(s.length_m for s in segs if s.cls == "park_path"))
        r.confidence = round(sum(g.edges[s.edge]["confidence"] * s.length_m for s in segs) / L, 3)
        per = period_of(hour)
        r.incidents = sum(g.edges[s.edge][f"inc_{per}"] for s in segs)
        if len(g.police_lat):
            near = set()
            for la, lo in r.coords:
                d = np.hypot((g.police_lat - la) * 110950, (g.police_lon - lo) * 95660)
                near.update(np.nonzero(d < 300)[0].tolist())
            r.police_near = len(near)
        by_name: dict[str, float] = {}
        for s in segs:
            if s.name:
                by_name[s.name] = by_name.get(s.name, 0) + s.length_m
        r.main_roads = [n for n, _ in sorted(by_name.items(), key=lambda x: -x[1])[:3]]
        return r

    @staticmethod
    def _explain(fast: Route, other: Route) -> list[str]:
        out = []
        dt = (other.duration_s - fast.duration_s) / 60
        if abs(dt) >= 0.5:
            out.append(f"{'+' if dt > 0 else ''}{dt:.0f} min vs fastest ({other.distance_m - fast.distance_m:+,} m)")
        if fast.isolated_m - other.isolated_m >= 100:
            out.append(f"Avoids {fast.isolated_m - other.isolated_m:,.0f} m of dark, isolated stretches")
        if fast.park_path_m - other.park_path_m >= 150:
            out.append(f"Uses {fast.park_path_m - other.park_path_m:,.0f} m less park/footpath")
        if other.lit_pct - fast.lit_pct >= 5:
            out.append(f"{other.lit_pct:.0f}% on recorded lit roads (fastest: {fast.lit_pct:.0f}%)")
        if other.police_near > fast.police_near:
            out.append(f"Passes {other.police_near} police posts within 300 m (fastest: {fast.police_near})")
        if fast.incidents > other.incidents:
            out.append(f"{fast.incidents - other.incidents} fewer recorded incidents on the way for this time of day")
        return out

    # -- public API ----------------------------------------------------
    def plan(self, origin: tuple[float, float], destination: tuple[float, float], hour: float,
             mode: str = "walk", max_detour: float = 1.5, lambdas=LAMBDAS) -> dict:
        model = RiskModel(self.g, mode)
        src = self.g.nearest_node(*origin, mode)
        dst = self.g.nearest_node(*destination, mode)
        if src == dst:
            raise ValueError("Origin and destination snap to the same point.")

        cands: list[Route] = []
        seen = set()
        for lam in lambdas:
            path = self._astar(src, dst, model, hour, lam)
            if path is None:
                raise ValueError("No route found for this mode.")
            sig = tuple(k for _, k in path)
            if sig in seen:
                continue
            seen.add(sig)
            cands.append(self._build("candidate", lam, path, model, hour))

        fastest = cands[0]
        within = [c for c in cands if c.duration_s <= max_detour * fastest.duration_s] or [fastest]

        def eff(c: Route) -> float:  # objective used for the "safest" choice
            segs = c.segments
            L = sum(s.length_m for s in segs) or 1.0
            return sum(model.edge_risk(s.edge, hour).effective * s.length_m for s in segs) / L

        safest = min(within, key=lambda c: (eff(c), c.duration_s))
        # Pareto front on (duration, effective risk) and its knee
        pts = sorted(within, key=lambda c: c.duration_s)
        front, best_r = [], math.inf
        for c in pts:
            if eff(c) < best_r - 1e-9:
                front.append(c)
                best_r = eff(c)
        t0, t1 = fastest.duration_s, safest.duration_s
        r0, r1 = eff(fastest), eff(safest)
        balanced = fastest
        if len(front) > 2 and t1 > t0 and r0 > r1:
            balanced = min(front, key=lambda c: math.hypot((c.duration_s - t0) / (t1 - t0),
                                                           (eff(c) - r1) / (r0 - r1)))
        else:
            balanced = safest

        fastest.label, safest.label = "fastest", "safest"
        result = {"fastest": fastest, "safest": safest}
        distinct = all(abs(eff(balanced) - eff(o)) > 0.005 or abs(balanced.duration_s - o.duration_s) > 30
                       for o in (fastest, safest))
        if balanced is not fastest and balanced is not safest and distinct:
            balanced.label = "balanced"
            result["balanced"] = balanced
        for r in result.values():
            r.highlights = self._explain(fastest, r) if r is not fastest else []
        notes = []
        if safest is fastest:
            notes.append("The fastest route is also the lowest-risk option found within the detour budget.")
        notes.append(f"Synthetic data. Risk estimated for {int(hour):02d}:{int(round((hour % 1) * 60)):02d}, "
                     f"{period_of(hour)} period, mode={mode}.")
        return {
            "origin_node": src, "destination_node": dst, "hour": hour, "mode": mode,
            "routes": {k: v.to_dict() for k, v in result.items()},
            "candidates_considered": len(cands),
            "notes": notes,
        }

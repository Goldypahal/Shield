"""Small geometry helpers for all-India route planning (lat/lon in degrees, metres)."""
import math
from typing import Dict, Iterable, List, Sequence, Tuple

LatLon = Tuple[float, float]
EARTH_R = 6371000.0


def haversine(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def path_length(coords: Sequence[LatLon]) -> float:
    return sum(haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def decode_polyline(encoded: str, precision: int = 5) -> List[LatLon]:
    """Google encoded-polyline algorithm (used by Google Routes and OSRM polyline6)."""
    coords, index, lat, lon, factor = [], 0, 0, 0, 10 ** precision
    while index < len(encoded):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / factor, lon / factor))
    return coords


def resample(coords: Sequence[LatLon], step_m: float) -> List[Tuple[LatLon, float]]:
    """Points every `step_m` along the path, each with its distance from the start."""
    if not coords:
        return []
    out = [(coords[0], 0.0)]
    travelled, next_at = 0.0, step_m
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        seg = haversine(a, b)
        while seg > 0 and travelled + seg >= next_at:
            f = (next_at - travelled) / seg
            out.append(((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), next_at))
            next_at += step_m
        travelled += seg
    if out[-1][1] < travelled:
        out.append((coords[-1], travelled))
    return out


def simplify(coords: Sequence[LatLon], max_points: int) -> List[LatLon]:
    """Evenly thins a path (keeps both ends) so external queries stay small."""
    if len(coords) <= max_points:
        return list(coords)
    step = (len(coords) - 1) / (max_points - 1)
    return [coords[round(i * step)] for i in range(max_points)]


def slice_by_distance(coords: Sequence[LatLon], start_m: float, end_m: float) -> List[LatLon]:
    """Part of the path between two distances from its start."""
    out, travelled = [], 0.0
    for i in range(len(coords) - 1):
        seg = haversine(coords[i], coords[i + 1])
        if travelled + seg >= start_m and travelled <= end_m:
            if not out:
                out.append(coords[i])
            out.append(coords[i + 1])
        travelled += seg
    return out


class Projector:
    """Local equirectangular projection around a reference latitude (accurate to well under
    1 m over tens of km), so point-to-segment distances are plain 2-D maths."""

    def __init__(self, ref_lat: float):
        self.kx = math.cos(math.radians(ref_lat)) * math.pi * EARTH_R / 180.0
        self.ky = math.pi * EARTH_R / 180.0

    def xy(self, p: LatLon) -> Tuple[float, float]:
        return p[1] * self.kx, p[0] * self.ky


def point_segment_distance(p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - ax, p[1] - ay)
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


class SegmentIndex:
    """Grid index of line segments (or points) for 'nearest feature within R metres' lookups."""

    def __init__(self, proj: Projector, cell_m: float = 100.0):
        self.proj, self.cell = proj, cell_m
        self.grid: Dict[Tuple[int, int], List[Tuple[Tuple[float, float], Tuple[float, float], object]]] = {}

    def _cells(self, a, b):
        x0, x1 = sorted((a[0], b[0]))
        y0, y1 = sorted((a[1], b[1]))
        for cx in range(int(x0 // self.cell), int(x1 // self.cell) + 1):
            for cy in range(int(y0 // self.cell), int(y1 // self.cell) + 1):
                yield cx, cy

    def add_line(self, coords: Iterable[LatLon], payload: object):
        pts = [self.proj.xy(c) for c in coords]
        if len(pts) == 1:
            pts = pts * 2
        for a, b in zip(pts, pts[1:]):
            for cell in self._cells(a, b):
                self.grid.setdefault(cell, []).append((a, b, payload))

    def add_point(self, p: LatLon, payload: object):
        self.add_line([p], payload)

    def nearest(self, p: LatLon, radius_m: float):
        """(distance, payload) of the nearest feature within radius_m, else (None, None)."""
        xy = self.proj.xy(p)
        r = int(math.ceil(radius_m / self.cell))
        cx, cy = int(xy[0] // self.cell), int(xy[1] // self.cell)
        best, best_payload = None, None
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for a, b, payload in self.grid.get((i, j), ()):
                    d = point_segment_distance(xy, a, b)
                    if d <= radius_m and (best is None or d < best):
                        best, best_payload = d, payload
        return best, best_payload

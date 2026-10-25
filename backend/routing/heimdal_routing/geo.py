"""Geometry helpers for the Tricity sector-grid frame.

Chandigarh (and Mohali, which continues its grid) is laid out on a rotated
grid. We work in a local planar frame measured in kilometres:

    u  -> along the "row" axis, bearing ~132 deg (towards SE, parallel to Madhya Marg)
    v  -> along the "column" axis, bearing ~222 deg (towards SW, parallel to Jan Marg)

The origin is the centre of Sector 17. Conversions are accurate to a few
tens of metres over the Tricity extent, which is plenty for synthetic data.
"""
from __future__ import annotations

import math

ORIGIN_LAT = 30.7398  # Sector 17 Plaza (approx.)
ORIGIN_LON = 76.7827
KM_PER_DEG_LAT = 110.95
KM_PER_DEG_LON = 111.32 * math.cos(math.radians(ORIGIN_LAT))

_ROW_BEARING = math.radians(132.0)  # u axis
_COL_BEARING = math.radians(222.0)  # v axis
# unit vectors (east, north)
_UE, _UN = math.sin(_ROW_BEARING), math.cos(_ROW_BEARING)
_VE, _VN = math.sin(_COL_BEARING), math.cos(_COL_BEARING)
_DET = _UE * _VN - _VE * _UN


def uv_to_en(u: float, v: float) -> tuple[float, float]:
    return u * _UE + v * _VE, u * _UN + v * _VN


def en_to_uv(e: float, n: float) -> tuple[float, float]:
    u = (e * _VN - n * _VE) / _DET
    v = (n * _UE - e * _UN) / _DET
    return u, v


def uv_to_latlon(u: float, v: float) -> tuple[float, float]:
    e, n = uv_to_en(u, v)
    return ORIGIN_LAT + n / KM_PER_DEG_LAT, ORIGIN_LON + e / KM_PER_DEG_LON


def latlon_to_uv(lat: float, lon: float) -> tuple[float, float]:
    e = (lon - ORIGIN_LON) * KM_PER_DEG_LON
    n = (lat - ORIGIN_LAT) * KM_PER_DEG_LAT
    return en_to_uv(e, n)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

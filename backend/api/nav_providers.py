"""
Route and place-search providers for all-India navigation.

Free by default (OpenStreetMap):
  * routing  - OSRM. Defaults to the FOSSGIS servers (routing.openstreetmap.de), which allow
               light use only; for production run your own OSRM with the India extract and
               set OSRM_CAR_URL / OSRM_BIKE_URL / OSRM_FOOT_URL.
  * search   - Photon (photon.komoot.io, fair use) restricted to India; PHOTON_URL to self-host.
Google Maps Platform, when GOOGLE_MAPS_API_KEY is set (no code change needed):
  * routing  - Routes API computeRoutes: Google's own routes and alternatives, live traffic
               for car and two-wheeler, and public transit.
  * search   - Places API (New) autocomplete + place details.
"""
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from nav_geo import LatLon, decode_polyline, path_length

logger = logging.getLogger("shield-nav")

USER_AGENT = os.environ.get("NAV_USER_AGENT", "SHIELD-safety-app/1.1 (+https://github.com/Goldypahal/Shield)")
TIMEOUT = httpx.Timeout(20.0, connect=8.0)

MODES = ("walk", "bicycle", "two_wheeler", "car", "transit")
# India's bounding box (incl. islands) for search biasing: min lon, min lat, max lon, max lat
INDIA_BBOX = (68.0, 6.5, 97.5, 37.2)


class ProviderError(Exception):
    """The routing or search service could not be reached or refused the request."""


@dataclass
class Step:
    instruction: str
    distance_m: float
    duration_s: float
    lat: float
    lon: float
    maneuver: str = ""
    road: str = ""


@dataclass
class RouteOption:
    coords: List[LatLon]
    distance_m: float
    duration_s: float
    summary: str = ""
    steps: List[Step] = field(default_factory=list)
    duration_note: str = ""  # 'car_profile' when a two-wheeler route uses the car profile


@dataclass
class Place:
    name: str
    address: str
    lat: Optional[float]
    lon: Optional[float]
    place_id: Optional[str] = None  # Google: coordinates come from a details lookup


# ---------------------------------------------------------------- routing

class OsrmProvider:
    name = "openstreetmap"
    modes = ("walk", "bicycle", "two_wheeler", "car")

    def __init__(self):
        self.urls = {
            "car": os.environ.get("OSRM_CAR_URL", "https://routing.openstreetmap.de/routed-car/route/v1/driving"),
            "bicycle": os.environ.get("OSRM_BIKE_URL", "https://routing.openstreetmap.de/routed-bike/route/v1/bike"),
            "walk": os.environ.get("OSRM_FOOT_URL", "https://routing.openstreetmap.de/routed-foot/route/v1/foot"),
        }

    async def routes(self, origin: LatLon, dest: LatLon, mode: str, language: str = "en",
                     via: Optional[LatLon] = None) -> List[RouteOption]:
        profile = "car" if mode in ("car", "two_wheeler") else mode
        points = [origin] + ([via] if via else []) + [dest]
        url = f"{self.urls[profile]}/" + ";".join(f"{p[1]:.6f},{p[0]:.6f}" for p in points)
        params = {"alternatives": "false" if via else "3", "overview": "full", "geometries": "geojson", "steps": "true"}
        if via:
            params["continue_straight"] = "true"  # no U-turn at the via point
        data = await _get_json(url, params)
        if data.get("code") != "Ok":
            if data.get("code") in ("NoRoute", "NoSegment"):
                return []
            raise ProviderError(f"OSRM: {data.get('code')} {data.get('message', '')}")
        out = []
        for r in data.get("routes", []):
            coords = [(lat, lon) for lon, lat in r["geometry"]["coordinates"]]
            steps, roads = [], []
            legs = r.get("legs", [])
            for li, leg in enumerate(legs):
                for s in leg.get("steps", []):
                    m = s.get("maneuver", {})
                    if m.get("type") == "arrive" and li < len(legs) - 1:
                        continue  # the via point is not a destination
                    road = s.get("name") or s.get("ref") or ""
                    if road and road not in roads and s.get("distance", 0) > 200:
                        roads.append(road)
                    steps.append(Step(
                        instruction=_osrm_instruction(m, road), distance_m=s.get("distance", 0.0),
                        duration_s=s.get("duration", 0.0), lat=m.get("location", [0, 0])[1],
                        lon=m.get("location", [0, 0])[0], maneuver=f"{m.get('type', '')} {m.get('modifier', '')}".strip(),
                        road=road))
            duration, note = r["duration"], ""
            if mode == "two_wheeler":
                # No free two-wheeler profile: car route and car travel time, labelled as such
                note = "car_profile"
            out.append(RouteOption(coords=coords, distance_m=r["distance"], duration_s=duration,
                                   summary=", ".join(roads[:2]), steps=steps, duration_note=note))
        return out


def _osrm_instruction(m: Dict[str, Any], road: str) -> str:
    kind, mod = m.get("type", ""), m.get("modifier", "")
    onto = f" onto {road}" if road else ""
    if kind == "depart":
        return f"Head {_bearing_word(m.get('bearing_after', 0))}{onto}"
    if kind == "arrive":
        return "Arrive at your destination"
    if kind in ("roundabout", "rotary"):
        return f"At the roundabout take exit {m.get('exit', 1)}{onto}"
    if kind in ("turn", "end of road", "fork", "on ramp", "off ramp", "merge", "new name", "continue"):
        if mod in ("straight", "") or kind in ("new name", "continue"):
            return f"Continue{onto or ' straight'}"
        return f"{'Keep' if kind == 'fork' else 'Turn'} {mod}{onto}"
    return f"{kind.capitalize()} {mod}{onto}".strip()


def _bearing_word(b: float) -> str:
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][int(((b + 22.5) % 360) // 45)]


class GoogleRoutesProvider:
    name = "google"
    modes = MODES
    URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
    TRAVEL_MODE = {"walk": "WALK", "bicycle": "BICYCLE", "two_wheeler": "TWO_WHEELER", "car": "DRIVE", "transit": "TRANSIT"}
    FIELDS = ",".join([
        "routes.distanceMeters", "routes.duration", "routes.description", "routes.polyline.encodedPolyline",
        "routes.legs.steps.distanceMeters", "routes.legs.steps.staticDuration", "routes.legs.steps.startLocation",
        "routes.legs.steps.navigationInstruction", "routes.legs.steps.transitDetails.transitLine.nameShort",
    ])

    def __init__(self, api_key: str):
        self.key = api_key

    async def routes(self, origin: LatLon, dest: LatLon, mode: str, language: str = "en",
                     via: Optional[LatLon] = None) -> List[RouteOption]:
        body: Dict[str, Any] = {
            "origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
            "destination": {"location": {"latLng": {"latitude": dest[0], "longitude": dest[1]}}},
            "travelMode": self.TRAVEL_MODE[mode],
            "computeAlternativeRoutes": mode != "transit" and via is None,
            "languageCode": language,
            "regionCode": "IN",
            "units": "METRIC",
        }
        if via is not None:
            body["intermediates"] = [{"via": True, "location": {"latLng": {"latitude": via[0], "longitude": via[1]}}}]
        if mode in ("car", "two_wheeler"):
            body["routingPreference"] = "TRAFFIC_AWARE"
        headers = {"X-Goog-Api-Key": self.key, "X-Goog-FieldMask": self.FIELDS}
        async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            try:
                res = await client.post(self.URL, json=body, headers=headers)  # noqa: E501
            except httpx.HTTPError as e:
                raise ProviderError(f"Google Routes unreachable: {e}") from e
        if res.status_code != 200:
            raise ProviderError(f"Google Routes {res.status_code}: {res.text[:200]}")
        out = []
        for r in res.json().get("routes", []):
            coords = decode_polyline(r["polyline"]["encodedPolyline"])
            steps = []
            for leg in r.get("legs", []):
                for s in leg.get("steps", []):
                    ni = s.get("navigationInstruction", {})
                    loc = s.get("startLocation", {}).get("latLng", {})
                    steps.append(Step(instruction=ni.get("instructions", ""), distance_m=s.get("distanceMeters", 0),
                                      duration_s=_seconds(s.get("staticDuration", "0s")), lat=loc.get("latitude", 0.0),
                                      lon=loc.get("longitude", 0.0), maneuver=ni.get("maneuver", "")))
            out.append(RouteOption(coords=coords, distance_m=r.get("distanceMeters", path_length(coords)),
                                   duration_s=_seconds(r.get("duration", "0s")), summary=r.get("description", ""), steps=steps))
        return out


def _seconds(d: str) -> float:
    try:
        return float(str(d).rstrip("s"))
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- search

class PhotonSearch:
    name = "openstreetmap"

    def __init__(self):
        self.url = os.environ.get("PHOTON_URL", "https://photon.komoot.io").rstrip("/")

    async def search(self, q: str, near: Optional[LatLon], language: str = "en") -> List[Place]:
        params: Dict[str, Any] = {"q": q, "limit": 8, "bbox": ",".join(map(str, INDIA_BBOX))}
        if language in ("en", "de", "fr"):
            params["lang"] = language  # Photon's supported UI languages; others get local names
        if near:
            params.update(lat=near[0], lon=near[1])
        data = await _get_json(f"{self.url}/api", params)
        return [_photon_place(f) for f in data.get("features", [])]

    async def reverse(self, p: LatLon, language: str = "en") -> Optional[Place]:
        data = await _get_json(f"{self.url}/reverse", {"lat": p[0], "lon": p[1], "limit": 1})
        feats = data.get("features", [])
        return _photon_place(feats[0]) if feats else None


def _photon_place(f: Dict[str, Any]) -> Place:
    pr = f.get("properties", {})
    lon, lat = f.get("geometry", {}).get("coordinates", [None, None])
    name = pr.get("name") or " ".join(filter(None, [pr.get("housenumber"), pr.get("street")])) or pr.get("city") or "Unnamed place"
    parts = [pr.get("street") if pr.get("name") else None, pr.get("district"), pr.get("city"), pr.get("state"), pr.get("postcode")]
    address = ", ".join(dict.fromkeys(p for p in parts if p and p != name))
    return Place(name=name, address=address, lat=lat, lon=lon)


class GooglePlacesSearch:
    name = "google"
    AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete"
    DETAILS = "https://places.googleapis.com/v1/places/{id}"

    def __init__(self, api_key: str):
        self.key = api_key

    async def search(self, q: str, near: Optional[LatLon], language: str = "en") -> List[Place]:
        body: Dict[str, Any] = {"input": q, "includedRegionCodes": ["in"], "languageCode": language}
        if near:
            body["locationBias"] = {"circle": {"center": {"latitude": near[0], "longitude": near[1]}, "radius": 50000.0}}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(self.AUTOCOMPLETE, json=body, headers={"X-Goog-Api-Key": self.key})
        if res.status_code != 200:
            raise ProviderError(f"Google Places {res.status_code}")
        out = []
        for s in res.json().get("suggestions", []):
            pp = s.get("placePrediction")
            if not pp:
                continue
            fmt = pp.get("structuredFormat", {})
            out.append(Place(name=fmt.get("mainText", {}).get("text") or pp.get("text", {}).get("text", ""),
                             address=fmt.get("secondaryText", {}).get("text", ""), lat=None, lon=None,
                             place_id=pp.get("placeId")))
        return out

    async def details(self, place_id: str) -> Optional[Place]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get(self.DETAILS.format(id=place_id),
                                   headers={"X-Goog-Api-Key": self.key, "X-Goog-FieldMask": "displayName,formattedAddress,location"})
        if res.status_code != 200:
            return None
        d = res.json()
        loc = d.get("location", {})
        return Place(name=d.get("displayName", {}).get("text", ""), address=d.get("formattedAddress", ""),
                     lat=loc.get("latitude"), lon=loc.get("longitude"), place_id=place_id)

    async def reverse(self, p: LatLon, language: str = "en") -> Optional[Place]:
        return None  # Geocoding API reverse lookups are billed separately; the app shows coordinates


async def _get_json(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        try:
            res = await client.get(url, params=params)
        except httpx.HTTPError as e:
            raise ProviderError(f"{url.split('/')[2]} unreachable: {e}") from e
    if res.status_code >= 500 or res.status_code in (403, 429):
        raise ProviderError(f"{url.split('/')[2]} returned {res.status_code}")
    try:
        return res.json()
    except ValueError as e:
        raise ProviderError(f"{url.split('/')[2]} returned non-JSON") from e


# ---------------------------------------------------------------- selection

def google_key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()


def routing_provider():
    key = google_key()
    return GoogleRoutesProvider(key) if key else OsrmProvider()


def search_provider():
    key = google_key()
    return GooglePlacesSearch(key) if key else PhotonSearch()

"""All-India navigation: provider parsing, safety scoring and the /api/v1/nav endpoints.

External services are not called: each test feeds the code a response in the real wire
format of OSRM, Photon, Google Routes or Overpass.
"""
import asyncio
import json

import httpx
import pytest

import nav_providers
import nav_router
import nav_safety
from nav_geo import decode_polyline, haversine, resample
from nav_providers import RouteOption, Step

# A ~1 km west-to-east walk in Chandigarh (Sector 17 area)
A = (30.7410, 76.7760)
B = (30.7410, 76.7864)
MID_LON = 76.7812


def line(lat, lon0, lon1, n=6):
    return [(lat, lon0 + (lon1 - lon0) * i / (n - 1)) for i in range(n)]


ROUTE = line(A[0], A[1], B[1], n=12)


def overpass_fixture():
    """West half: lit primary road. East half: unlit footway. Plus places around it."""
    west = line(A[0], A[1] - 0.0005, MID_LON)
    east = line(A[0], MID_LON, B[1] + 0.0005)
    return {"elements": [
        {"type": "way", "id": 1, "tags": {"highway": "primary", "lit": "yes", "name": "Madhya Marg"},
         "geometry": [{"lat": a, "lon": b} for a, b in west]},
        {"type": "way", "id": 2, "tags": {"highway": "footway", "lit": "no"},
         "geometry": [{"lat": a, "lon": b} for a, b in east]},
        {"type": "node", "id": 10, "lat": A[0] + 0.0004, "lon": A[1] + 0.001,
         "tags": {"amenity": "pharmacy", "name": "Apollo Pharmacy", "opening_hours": "24/7", "phone": "+91 172 000 0000"}},
        {"type": "way", "id": 11, "center": {"lat": B[0] - 0.0008, "lon": B[1] - 0.0005},
         "tags": {"amenity": "police", "name": "Sector 17 Police Station"}},
        {"type": "node", "id": 12, "lat": A[0] + 0.0003, "lon": MID_LON,
         "tags": {"shop": "convenience", "name": "Day Store", "opening_hours": "Mo-Sa 09:00-21:00"}},
        {"type": "node", "id": 13, "lat": A[0] + 0.0002, "lon": MID_LON + 0.002,
         "tags": {"amenity": "fuel", "name": "Indian Oil", "opening_hours": "24/7"}},
    ]}


# ---------------------------------------------------------------- geometry

def test_decode_polyline_reference_example():
    pts = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert [(round(a, 3), round(b, 3)) for a, b in pts] == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]


def test_resample_spacing_and_total():
    pts = resample(ROUTE, 25.0)
    total = haversine(A, B)
    assert abs(pts[-1][1] - total) < 1
    assert all(abs((pts[i + 1][1] - pts[i][1]) - 25.0) < 1e-6 for i in range(len(pts) - 2))


# ---------------------------------------------------------------- scoring

def test_night_score_reports_lighting_places_and_caution():
    s = nav_safety.score_route(ROUTE, haversine(A, B), overpass_fixture(), [], "night")
    assert 40 <= s["lit_pct"] <= 60 and 40 <= s["unlit_pct"] <= 60
    assert s["unknown_light_pct"] <= 5
    names = [p["name"] for p in s["places_247"]]
    # 24x7 pharmacy and fuel, and the police station; the 9-to-9 shop is not listed
    assert names == ["Apollo Pharmacy", "Indian Oil", "Sector 17 Police Station"]
    assert s["places_247"][0]["phone"] == "+91 172 000 0000"
    assert any(c["reason"] in ("unlit", "isolated") and c["start_m"] >= 400 for c in s["caution"])
    assert not s["partial"] and 0 <= s["score"] <= 100


def test_daytime_weighs_lighting_less():
    osm = overpass_fixture()
    night = nav_safety.score_route(ROUTE, 1000, osm, [], "night")["score"]
    day = nav_safety.score_route(ROUTE, 1000, osm, [], "day")["score"]
    assert day != night


def test_incidents_counted_and_hotspots_kept_private():
    report = {"lat": A[0], "lon": MID_LON + 0.002, "category": "harassment_spot", "weight": 1.0, "radius_m": 75, "public": True}
    hotspot = {"lat": A[0], "lon": A[1] + 0.001, "category": "police_hotspot", "weight": 1.0, "radius_m": 150, "public": False}
    far = {"lat": A[0] + 0.05, "lon": A[1], "category": "other", "weight": 1.0, "radius_m": 75, "public": True}
    clean = nav_safety.score_route(ROUTE, 1000, overpass_fixture(), [], "night")
    s = nav_safety.score_route(ROUTE, 1000, overpass_fixture(), [report, hotspot, far], "night")
    assert s["incidents"] == 2
    assert s["incident_reports"] == [{"lat": report["lat"], "lon": report["lon"], "category": "harassment_spot"}]
    assert s["score"] < clean["score"]


def test_without_overpass_score_is_partial_not_invented():
    s = nav_safety.score_route(ROUTE, 1000, None, [], "night")
    assert s["partial"] and s["lit_pct"] is None and s["places_247"] == []
    assert s["score"] == 100  # only the incident component is known, and it is clean


def test_long_trip_analyses_both_ends_only():
    long_route = line(28.6, 77.0, 82.0, n=200)  # ~490 km
    parts = nav_safety.analysed_parts(long_route, 490_000)
    assert len(parts) == 2
    assert all(9_000 < sum(haversine(p[i], p[i + 1]) for i in range(len(p) - 1)) < 15_000 for p in parts)


def test_badges():
    routes = [
        {"distance_m": 1200, "duration_s": 900, "safety": {"score": 80}},
        {"distance_m": 1000, "duration_s": 800, "safety": {"score": 60}},
        {"distance_m": 1100, "duration_s": 700, "safety": {"score": 70}},
    ]
    nav_safety.assign_badges(routes)
    assert [r["badges"] for r in routes] == [["safest"], ["shortest"], ["fastest"]]


# ---------------------------------------------------------------- providers

OSRM_RESPONSE = {
    "code": "Ok",
    "routes": [{
        "distance": 1005.2, "duration": 723.4,
        "geometry": {"type": "LineString", "coordinates": [[A[1], A[0]], [MID_LON, A[0]], [B[1], B[0]]]},
        "legs": [{"steps": [
            {"distance": 500, "duration": 360, "name": "Madhya Marg",
             "maneuver": {"type": "depart", "bearing_after": 90, "location": [A[1], A[0]]}},
            {"distance": 505, "duration": 363, "name": "",
             "maneuver": {"type": "turn", "modifier": "left", "location": [MID_LON, A[0]]}},
            {"distance": 0, "duration": 0, "name": "", "maneuver": {"type": "arrive", "location": [B[1], B[0]]}},
        ]}],
    }],
}


def test_osrm_parsing_and_two_wheeler_label(monkeypatch):
    calls = []

    async def fake_get(url, params):
        calls.append(url)
        return OSRM_RESPONSE

    monkeypatch.setattr(nav_providers, "_get_json", fake_get)
    p = nav_providers.OsrmProvider()
    walk = asyncio.run(p.routes(A, B, "walk"))[0]
    assert "routed-foot" in calls[-1] and f"{A[1]:.6f},{A[0]:.6f}" in calls[-1]
    assert walk.coords[0] == A and walk.distance_m == 1005.2 and walk.summary == "Madhya Marg"
    assert [s.instruction for s in walk.steps] == ["Head east onto Madhya Marg", "Turn left", "Arrive at your destination"]
    two = asyncio.run(p.routes(A, B, "two_wheeler"))[0]
    assert "routed-car" in calls[-1] and two.duration_note == "car_profile" and two.duration_s == 723.4


def test_photon_search_restricted_to_india(monkeypatch):
    seen = {}

    async def fake_get(url, params):
        seen.update(params)
        return {"features": [{"geometry": {"coordinates": [76.8013, 30.7056]},
                              "properties": {"name": "Elante Mall", "street": "Industrial Area Phase I",
                                             "city": "Chandigarh", "state": "Chandigarh", "postcode": "160002"}}]}

    monkeypatch.setattr(nav_providers, "_get_json", fake_get)
    places = asyncio.run(nav_providers.PhotonSearch().search("elante", (30.73, 76.78)))
    assert seen["bbox"] == "68.0,6.5,97.5,37.2" and seen["lat"] == 30.73
    assert places[0].name == "Elante Mall" and places[0].lat == 30.7056
    assert places[0].address == "Industrial Area Phase I, Chandigarh, 160002"


def test_google_routes_request_and_parsing(monkeypatch):
    captured = {}

    def handler(request: httpx.Request):
        captured["body"] = json.loads(request.content)
        captured["headers"] = request.headers
        return httpx.Response(200, json={"routes": [{
            "distanceMeters": 1234, "duration": "456s", "description": "via Madhya Marg",
            "polyline": {"encodedPolyline": "_p~iF~ps|U_ulLnnqC"},
            "legs": [{"steps": [{"distanceMeters": 1234, "staticDuration": "456s",
                                 "startLocation": {"latLng": {"latitude": 38.5, "longitude": -120.2}},
                                 "navigationInstruction": {"maneuver": "DEPART", "instructions": "Head east"}}]}],
        }]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(nav_providers.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    r = asyncio.run(nav_providers.GoogleRoutesProvider("test-key").routes(A, B, "two_wheeler", "hi"))[0]
    assert captured["body"]["travelMode"] == "TWO_WHEELER" and captured["body"]["computeAlternativeRoutes"] is True
    assert captured["body"]["routingPreference"] == "TRAFFIC_AWARE" and captured["body"]["languageCode"] == "hi"
    assert captured["headers"]["x-goog-api-key"] == "test-key"
    assert r.distance_m == 1234 and r.duration_s == 456 and r.summary == "via Madhya Marg"
    assert r.steps[0].instruction == "Head east" and len(r.coords) == 2


def test_provider_switches_on_google_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    assert nav_providers.routing_provider().name == "openstreetmap"
    assert "transit" not in nav_providers.routing_provider().modes
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "k")
    assert nav_providers.routing_provider().name == "google"
    assert nav_providers.search_provider().name == "google"


# ---------------------------------------------------------------- endpoints

class FakeRouter:
    name = "openstreetmap"
    modes = ("walk", "bicycle", "two_wheeler", "car")

    async def routes(self, origin, dest, mode, language="en"):
        direct = RouteOption(coords=ROUTE, distance_m=1000, duration_s=720, summary="Madhya Marg",
                             steps=[Step("Head east", 1000, 720, A[0], A[1])])
        detour = RouteOption(coords=[A, (A[0] - 0.004, A[1]), (B[0] - 0.004, B[1]), B], distance_m=1900,
                             duration_s=1400, summary="Dakshin Marg")
        return [direct, detour]


def test_plan_endpoint_scores_every_route(client, account, monkeypatch):
    user = account()
    monkeypatch.setattr(nav_router, "routing_provider", lambda: FakeRouter())

    async def fake_osm(parts):
        return overpass_fixture()

    monkeypatch.setattr(nav_router, "fetch_osm", fake_osm)
    res = client.post("/api/v1/nav/plan", headers=user.headers, json={
        "origin": {"lat": A[0], "lon": A[1]}, "destination": {"lat": B[0], "lon": B[1]},
        "mode": "walk", "depart_at": "2026-10-27T23:00:00+05:30"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["period"] == "night" and len(body["routes"]) == 2
    first, second = body["routes"]
    assert "shortest" in first["badges"] and "fastest" in first["badges"]
    assert all("safest" in r["badges"] or r["safety"]["score"] <= max(x["safety"]["score"] for x in body["routes"])
               for r in body["routes"])
    assert first["safety"]["places_247"] and first["steps"][0]["instruction"] == "Head east"


def test_plan_rejects_transit_without_google(client, account, monkeypatch):
    user = account()
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    res = client.post("/api/v1/nav/plan", headers=user.headers, json={
        "origin": {"lat": A[0], "lon": A[1]}, "destination": {"lat": B[0], "lon": B[1]}, "mode": "transit"})
    assert res.status_code == 400 and "Google" in res.json()["detail"]


def test_plan_rejects_points_outside_india(client, account):
    user = account()
    res = client.post("/api/v1/nav/plan", headers=user.headers, json={
        "origin": {"lat": 51.5, "lon": -0.12}, "destination": {"lat": B[0], "lon": B[1]}, "mode": "walk"})
    assert res.status_code == 422


def test_routing_outage_is_a_clear_503(client, account, monkeypatch):
    user = account()

    class Down(FakeRouter):
        async def routes(self, *a, **k):
            raise nav_providers.ProviderError("down")

    monkeypatch.setattr(nav_router, "routing_provider", lambda: Down())
    res = client.post("/api/v1/nav/plan", headers=user.headers, json={
        "origin": {"lat": A[0], "lon": A[1]}, "destination": {"lat": B[0], "lon": B[1]}, "mode": "car"})
    assert res.status_code == 503


def test_capabilities(client, account, monkeypatch):
    user = account()
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    body = client.get("/api/v1/nav/capabilities", headers=user.headers).json()
    assert body["provider"] == "openstreetmap" and body["two_wheeler_uses_car_profile"] is True
    assert "transit" in body["all_modes"] and "transit" not in body["modes"]

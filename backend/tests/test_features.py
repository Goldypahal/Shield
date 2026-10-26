"""Check-in timers, guardian tracking links, safe havens, community reports in routing,
the night heatmap, ride mode and PIN-protected trip ending."""
import re
import time
import uuid

import pytest

import notifier

ROUTE = [{"lat": 30.7333, "lon": 76.7794}, {"lat": 30.7400, "lon": 76.7850}]


@pytest.fixture
def sms(monkeypatch):
    """Captures SMS bodies instead of sending them."""
    sent = []

    async def fake_send(to, body):
        sent.append((to, body))
        return True

    monkeypatch.setattr(notifier, "_send_sms", fake_send)
    return sent


def _track_token(body: str) -> str:
    return re.search(r"/track/([A-Za-z0-9_-]+)", body).group(1)


# --- Check-in timer --------------------------------------------------------

def test_checkin_confirm_needs_pin(client, account):
    walker = account()
    timer = client.post("/api/v1/checkins", headers=walker.headers, json={"minutes": 20, "label": "Home"}).json()["checkin"]
    assert 0 < timer["seconds_left"] <= 20 * 60
    assert client.post(f"/api/v1/checkins/{timer['id']}/confirm", headers=walker.headers, json={"pin": "0000"}).status_code == 403
    assert client.post(f"/api/v1/checkins/{timer['id']}/confirm", headers=walker.headers, json={"pin": walker.pin}).status_code == 200
    assert client.get("/api/v1/checkins/active", headers=walker.headers).json()["checkin"] is None


def test_checkin_duress_confirm_looks_normal_but_alerts(client, account, sms):
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    timer = client.post("/api/v1/checkins", headers=walker.headers, json={"minutes": 20}).json()["checkin"]
    res = client.post(f"/api/v1/checkins/{timer['id']}/confirm", headers=walker.headers, json={"pin": walker.duress_pin})
    assert res.status_code == 200 and res.json() == {"status": "checkin_confirmed"}
    assert any(to == guardian.phone and "SHIELD ALERT" in body for to, body in sms)


def test_expired_checkin_opens_alert_server_side(client, account, sms):
    from checkin_router import expire_overdue_checkins
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    timer = client.post("/api/v1/checkins", headers=walker.headers,
                        json={"minutes": 1, "lat": 30.73, "lon": 76.78}).json()["checkin"]
    client.portal.call(_make_overdue, timer["id"])
    assert client.portal.call(expire_overdue_checkins) == 1
    alerts = client.get("/api/v1/guardian/alerts", headers=guardian.headers).json()["alerts"]
    assert any(a["trigger_type"] == "CHECKIN_TIMEOUT" for a in alerts)
    assert any(to == guardian.phone for to, _ in sms)


async def _make_overdue(timer_id):
    from db.storage import storage
    await storage.update_checkin(timer_id, due_at=time.time() - 1)


def test_cannot_touch_someone_elses_checkin(client, account):
    walker, stranger = account(), account()
    timer = client.post("/api/v1/checkins", headers=walker.headers, json={"minutes": 5}).json()["checkin"]
    assert client.post(f"/api/v1/checkins/{timer['id']}/confirm", headers=stranger.headers,
                       json={"pin": stranger.pin}).status_code == 404


# --- Guardian tracking link -------------------------------------------------

def test_alert_sms_carries_working_tracking_link(client, account, sms):
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    alert_id = str(uuid.uuid4())
    client.post("/api/v1/alerts/sync", headers=walker.headers,
                json={"id": alert_id, "trigger_type": "SOS_BUTTON", "lat": 30.73, "lon": 76.78})
    body = next(b for to, b in sms if to == guardian.phone)
    assert alert_id not in body  # the SMS never exposes the alert id
    token = _track_token(body)

    data = client.get(f"/api/v1/track/{token}").json()  # no account needed
    assert data["kind"] == "alert" and data["open"] and data["start"]["lat"] == 30.73
    assert "phone" not in str(data).lower()

    page = client.get(f"/track/{token}")
    assert page.status_code == 200 and "frame-ancestors 'none'" in page.headers["content-security-policy"]

    client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers, json={"state": "CANCELLED", "pin": walker.pin})
    closed = client.get(f"/api/v1/track/{token}").json()
    assert closed["open"] is False and closed["start"] is None and closed["trail"] == []


def test_bad_tracking_tokens_rejected(client):
    assert client.get("/api/v1/track/not-a-real-token").status_code == 404
    assert client.get("/api/v1/track/" + "a" * 200).status_code == 404


def test_shared_walk_texts_only_selected_guardians(client, account, sms):
    walker, g1, g2 = account(), account(), account()
    gid1 = walker.add_guardian(g1)
    walker.add_guardian(g2)
    client.post("/api/v1/walks", headers=walker.headers, json={
        "origin_name": "A", "destination_name": "Elante Mall", "chosen_route_id": "safest", "route_coords": ROUTE,
        "safety_score": 70, "fastest_time_seconds": 600, "shared_guardian_ids": [gid1]})
    recipients = {to for to, _ in sms}
    assert g1.phone in recipients and g2.phone not in recipients
    data = client.get(f"/api/v1/track/{_track_token(sms[0][1])}").json()
    assert data["kind"] == "walk" and data["destination"] == "Elante Mall" and len(data["route"]) == 2


# --- Rides and ending trips -------------------------------------------------

def test_ride_needs_plate_and_tolerates_parallel_roads(client, account):
    walker = account()
    base = {"origin_name": "A", "destination_name": "B", "chosen_route_id": "r", "route_coords": ROUTE,
            "safety_score": 70, "fastest_time_seconds": 600, "mode": "ride"}
    assert client.post("/api/v1/walks", headers=walker.headers, json=base).status_code == 422
    ride = client.post("/api/v1/walks", headers=walker.headers, json={**base, "vehicle_plate": "CH01AB1234"}).json()["walk"]
    assert ride["mode"] == "ride" and ride["vehicle_plate"] == "CH01AB1234"
    # ~200 m off the route: fine for a vehicle, a deviation for a walker
    off = {"points": [{"lat": 30.7333, "lon": 76.7815}]}
    assert client.post(f"/api/v1/walks/{ride['id']}/points", headers=walker.headers, json=off).json()["deviation_alert"] is False


def test_ending_trip_away_from_destination_needs_pin(client, account):
    walker = account()
    walk = client.post("/api/v1/walks", headers=walker.headers, json={
        "origin_name": "A", "destination_name": "B", "chosen_route_id": "r", "route_coords": ROUTE,
        "safety_score": 70, "fastest_time_seconds": 600}).json()["walk"]
    client.post(f"/api/v1/walks/{walk['id']}/points", headers=walker.headers, json={"points": [ROUTE[0]]})
    assert client.post(f"/api/v1/walks/{walk['id']}/end", headers=walker.headers).status_code == 403
    assert client.post(f"/api/v1/walks/{walk['id']}/end", headers=walker.headers, json={"pin": walker.pin}).status_code == 200

    arrived = client.post("/api/v1/walks", headers=walker.headers, json={
        "origin_name": "A", "destination_name": "B", "chosen_route_id": "r", "route_coords": ROUTE,
        "safety_score": 70, "fastest_time_seconds": 600}).json()["walk"]
    client.post(f"/api/v1/walks/{arrived['id']}/points", headers=walker.headers, json={"points": [ROUTE[1]]})
    assert client.post(f"/api/v1/walks/{arrived['id']}/end", headers=walker.headers).status_code == 200


# --- Safe havens, community reports, heatmap ---------------------------------

def test_safe_havens_nearest_first(client, account):
    res = client.get("/api/v1/safe-havens", headers=account().headers,
                     params={"lat": 30.7333, "lon": 76.7794, "radius_km": 5, "kind": ["police", "hospital"]})
    places = res.json()["places"]
    assert places and {p["kind"] for p in places} <= {"police", "hospital"}
    assert [p["distance_m"] for p in places] == sorted(p["distance_m"] for p in places)
    assert client.get("/api/v1/safe-havens", params={"lat": 30.7, "lon": 76.7}).status_code in (401, 403)


def test_hazard_reports_raise_route_risk(client, account):
    import route_router
    if route_router.TRICITY_ROUTER is None:
        pytest.skip("routing graph not available")
    walker = account()
    params = {"origin": "ISBT", "destination": "Elante", "hour": 22.5}
    before = client.get("/api/v1/routes/tricity/plan", headers=walker.headers, params=params).json()["plan"]
    fastest = before["routes"]["fastest"]
    mid = fastest["coords"][len(fastest["coords"]) // 2]
    for _ in range(3):
        assert client.post("/api/v1/hazards", headers=walker.headers,
                           json={"lat": mid[0], "lon": mid[1], "category": "harassment_spot"}).status_code == 201
    after = client.get("/api/v1/routes/tricity/plan", headers=walker.headers, params=params).json()["plan"]
    assert after["community_reports"]
    same_path = [r for r in after["routes"].values() if r["coords"] == fastest["coords"]]
    if same_path:  # the same streets now score worse; otherwise the engine routed around them
        assert same_path[0]["safety_index"] < fastest["safety_index"]


def test_heatmap_is_worse_at_night(client, account):
    import route_router
    if route_router.TRICITY_ROUTER is None:
        pytest.skip("routing graph not available")
    headers = account().headers
    day = client.get("/api/v1/routes/tricity/heatmap", headers=headers, params={"hour": 13}).json()
    night = client.get("/api/v1/routes/tricity/heatmap", headers=headers, params={"hour": 23}).json()
    mean = lambda d: sum(c["risk"] for c in d["cells"]) / len(d["cells"])  # noqa: E731
    assert len(day["cells"]) > 50 and mean(night) > mean(day)

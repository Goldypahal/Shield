"""Police integration: consent, station routing, 112 hand-off, control-room escalation,
staff two-factor sign-in, dispatcher status, FIR consent, police data and retention."""
import hashlib
import hmac
import json
import time
import uuid

import pytest

import notifier
import police
import settings
from db.storage import storage

ST_17 = (30.7398, 76.7827)     # near Sector 17
ST_MOHALI = (30.7046, 76.7179)


@pytest.fixture(autouse=True)
def quiet_sms(monkeypatch):
    async def fake_send(to, body):
        return True
    monkeypatch.setattr(notifier, "_send_sms", fake_send)


@pytest.fixture
def stations(client):
    # Fixed ids: re-adding replaces, so every test sees exactly these two stations here
    a = client.portal.call(lambda: storage.add_station("PS Sector 17 (test)", *ST_17, "+911722700001", station_id="test-st17"))
    b = client.portal.call(lambda: storage.add_station("PS Mohali (test)", *ST_MOHALI, "+911722700002", station_id="test-stmo"))
    return a, b


def _sos(client, acct, lat=ST_17[0] + 0.002, lon=ST_17[1]):
    alert_id = str(uuid.uuid4())
    res = client.post("/api/v1/alerts/sync", headers=acct.headers,
                      json={"id": alert_id, "trigger_type": "SOS_BUTTON", "lat": lat, "lon": lon})
    assert res.status_code == 201
    return alert_id


# --- 8. consent ---------------------------------------------------------------

def test_no_consent_no_police(client, account, stations):
    walker = account(police_sharing=False)
    control = account(role="responder")
    alert_id = _sos(client, walker)
    a = client.portal.call(storage.get_alert_by_id, alert_id)
    assert a["routed_at"] is None and a["station_id"] is None
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=control.headers).status_code == 404
    assert all(x["id"] != alert_id for x in client.get("/api/v1/dashboard/alerts/active", headers=control.headers).json()["alerts"])
    # Turning consent on applies to the next alert
    assert client.put("/api/v1/me/police-sharing", headers=walker.headers, json={"enabled": True}).json() == {"police_sharing": True}
    second = _sos(client, walker)
    assert client.get(f"/api/v1/alerts/{second}", headers=control.headers).status_code == 200


# --- 1 + 2. routing and 112 hand-off --------------------------------------------

def test_alert_routed_to_nearest_station_and_handed_to_112(client, account, stations):
    st17, stmo = stations
    walker = account()
    alert_id = _sos(client, walker)
    a = client.portal.call(storage.get_alert_by_id, alert_id)
    assert a["station_id"] == st17["id"] and a["police_status"] == "ROUTED"
    assert client.portal.call(police.process_erss_outbox) >= 1
    a = client.portal.call(storage.get_alert_by_id, alert_id)
    assert a["erss_incident_id"].startswith("MOCK-112-")
    # The walker sees where it went
    police_view = client.get(f"/api/v1/alerts/{alert_id}", headers=walker.headers).json()["police"]
    assert police_view["station"]["name"].startswith("PS Sector 17") and police_view["incident_112"]


def test_station_scoping_and_control_room_escalation(client, account, stations, monkeypatch):
    st17, stmo = stations
    walker = account()
    officer_17 = account(role="responder", station_id=st17["id"])
    officer_mo = account(role="responder", station_id=stmo["id"])
    alert_id = _sos(client, walker)
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=officer_17.headers).status_code == 200
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=officer_mo.headers).status_code == 404
    assert client.post(f"/api/v1/dashboard/alerts/{alert_id}/police-status", headers=officer_mo.headers,
                       json={"status": "ACKNOWLEDGED"}).status_code == 404
    # Nobody at the station acknowledges: it escalates to the control room, which every station can then see
    monkeypatch.setattr(settings, "POLICE_ACK_SECONDS", 0)
    assert client.portal.call(police.escalate_to_control_room) >= 1
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=officer_mo.headers).status_code == 200


# --- 3. staff sign-in and audit --------------------------------------------------

def test_staff_need_totp_and_codes_are_single_use(client, account):
    officer = account(role="responder")
    base = {"email": officer.email, "password": officer.password}
    no_code = client.post("/api/v1/auth/login", json=base)
    wrong = client.post("/api/v1/auth/login", json={**base, "totp_code": "000000"})
    assert no_code.status_code == wrong.status_code == 400
    assert no_code.json() == wrong.json()  # no hint that the password was right
    code = officer.totp(1)
    assert client.post("/api/v1/auth/login", json={**base, "totp_code": code}).status_code == 200
    assert client.post("/api/v1/auth/login", json={**base, "totp_code": code}).status_code == 400  # replay


def test_every_police_view_is_audited(client, account, stations):
    walker, admin = account(), account(role="admin")
    alert_id = _sos(client, walker)
    client.get(f"/api/v1/alerts/{alert_id}", headers=admin.headers)
    logs = client.get("/api/v1/dashboard/audit-logs", headers=admin.headers).json()["audit_logs"]
    assert any(l["action"] == "VIEW_ALERT" and l["target"] == f"alert/{alert_id}" for l in logs)


# --- 4. dispatcher status reaches walker and guardians ------------------------------

def test_police_status_shown_to_walker_and_on_tracking_link(client, account, stations, monkeypatch):
    st17, _ = stations
    sent = []

    async def capture(to, body):
        sent.append(body)
        return True
    monkeypatch.setattr(notifier, "_send_sms", capture)
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    officer = account(role="responder", station_id=st17["id"])
    alert_id = _sos(client, walker)
    token = next(b for b in sent if "/track/" in b).split("/track/")[1].split()[0]
    res = client.post(f"/api/v1/dashboard/alerts/{alert_id}/police-status", headers=officer.headers,
                      json={"status": "EN_ROUTE", "unit": "PCR-12", "eta_minutes": 6})
    assert res.status_code == 200 and res.json()["alert"]["state"] == "ACKNOWLEDGED"
    text = client.get(f"/api/v1/alerts/{alert_id}", headers=walker.headers).json()["police"]["text"]
    assert "PCR-12" in text and "6 min" in text
    assert "PCR-12" in client.get(f"/api/v1/track/{token}").json()["police"]
    client.post(f"/api/v1/dashboard/alerts/{alert_id}/police-status", headers=officer.headers, json={"status": "CLOSED_SAFE"})
    assert client.portal.call(storage.get_alert_by_id, alert_id)["state"] == "RESOLVED"


def test_erss_webhook_requires_valid_signature(client, account, stations, monkeypatch):
    monkeypatch.setattr(settings, "ERSS_WEBHOOK_SECRET", "s" * 40)
    walker = account()
    alert_id = _sos(client, walker)
    client.portal.call(police.process_erss_outbox)
    incident = client.portal.call(storage.get_alert_by_id, alert_id)["erss_incident_id"]
    body = json.dumps({"incident_id": incident, "status": "ON_SCENE", "unit": "PCR-7"}).encode()
    ts = str(int(time.time()))
    good = hmac.new(("s" * 40).encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    url = "/api/v1/integrations/erss/status"
    assert client.post(url, content=body, headers={"X-ERSS-Timestamp": ts, "X-ERSS-Signature": "0" * 64}).status_code == 401
    old = str(int(time.time()) - 3600)
    stale = hmac.new(("s" * 40).encode(), old.encode() + b"." + body, hashlib.sha256).hexdigest()
    assert client.post(url, content=body, headers={"X-ERSS-Timestamp": old, "X-ERSS-Signature": stale}).status_code == 401
    assert client.post(url, content=body, headers={"X-ERSS-Timestamp": ts, "X-ERSS-Signature": good}).status_code == 200
    assert client.portal.call(storage.get_alert_by_id, alert_id)["police_status"] == "ON_SCENE"


# --- 5. FIR evidence only with consent; 8. no location after closing -----------------

def test_fir_bundle_and_closed_location_need_consent(client, account, stations):
    st17, _ = stations
    walker = account()
    officer = account(role="responder", station_id=st17["id"])
    alert_id = _sos(client, walker)
    assert client.get(f"/api/v1/dashboard/alerts/{alert_id}/fir-bundle", headers=officer.headers).status_code == 403
    client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers, json={"state": "CANCELLED", "pin": walker.pin})
    closed = client.get(f"/api/v1/alerts/{alert_id}", headers=officer.headers).json()
    assert closed["alert"]["lat"] is None and closed["trail"] == []
    assert client.post(f"/api/v1/reports/incident/{alert_id}/pdf", headers=officer.headers).status_code == 403
    # Duress PIN looks like consent but records nothing
    assert client.post(f"/api/v1/alerts/{alert_id}/fir-consent", headers=walker.headers, json={"pin": walker.duress_pin}).status_code == 200
    assert client.get(f"/api/v1/dashboard/alerts/{alert_id}/fir-bundle", headers=officer.headers).status_code == 403
    assert client.post(f"/api/v1/alerts/{alert_id}/fir-consent", headers=walker.headers, json={"pin": walker.pin}).status_code == 200
    bundle = client.get(f"/api/v1/dashboard/alerts/{alert_id}/fir-bundle", headers=officer.headers).json()
    assert bundle["incident"]["lat"] and bundle["complainant"]["phone"] == walker.phone and bundle["timeline"]
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=officer.headers).json()["alert"]["lat"] is not None


# --- 6. police data in and out -------------------------------------------------------

def test_police_hotspots_raise_night_route_risk(client, account):
    import route_router
    if route_router.TRICITY_ROUTER is None:
        pytest.skip("routing graph not available")
    walker, officer = account(), account(role="responder")
    params = {"origin": "PGIMER", "destination": "Panjab University", "hour": 23}
    before = client.get("/api/v1/routes/tricity/plan", headers=walker.headers, params=params).json()["plan"]["routes"]["fastest"]
    mid = before["coords"][len(before["coords"]) // 2]
    assert client.post("/api/v1/dashboard/police-data/hotspots", headers=officer.headers, json={
        "hotspots": [{"lat": mid[0], "lon": mid[1], "radius_m": 200, "weight": 1, "period": "night"}]}).status_code == 200
    assert client.post("/api/v1/dashboard/police-data/hotspots", headers=walker.headers, json={
        "hotspots": [{"lat": mid[0], "lon": mid[1]}]}).status_code == 403
    after = client.get("/api/v1/routes/tricity/plan", headers=walker.headers, params=params).json()["plan"]["routes"]
    same = [r for r in after.values() if r["coords"] == before["coords"]]
    if same:
        assert same[0]["safety_index"] < before["safety_index"]
    by_day = client.get("/api/v1/routes/tricity/plan", headers=walker.headers, params={**params, "hour": 13}).json()
    assert "hotspot" not in json.dumps(by_day)  # hotspot locations are never published


def test_hazard_export_suppresses_small_cells(client, account):
    walker, officer = account(), account(role="responder")
    for _ in range(3):
        client.post("/api/v1/hazards", headers=walker.headers, json={"lat": 30.7600, "lon": 76.7900, "category": "broken_light"})
    client.post("/api/v1/hazards", headers=walker.headers, json={"lat": 30.6300, "lon": 76.6900, "category": "dark_alley"})
    cells = client.get("/api/v1/dashboard/exports/hazards", headers=officer.headers).json()["cells"]
    assert any(c["reports"] >= 3 and c.get("broken_light", 0) >= 3 for c in cells)
    assert all(c["reports"] >= 3 for c in cells)
    assert client.get("/api/v1/dashboard/exports/hazards", headers=walker.headers).status_code == 403


# --- 7. helplines and nearest police for walkers ---------------------------------------

def test_nearby_police_gives_distances_not_positions(client, account, stations):
    st17, _ = stations
    officer = account(role="responder", station_id=st17["id"])
    assert client.post("/api/v1/dashboard/patrol-units/PCR-12/position", headers=officer.headers,
                       json={"lat": ST_17[0] + 0.01, "lon": ST_17[1]}).status_code == 200
    walker = account()
    data = client.get("/api/v1/police/nearby", headers=walker.headers, params={"lat": ST_17[0], "lon": ST_17[1]}).json()
    assert [h["number"] for h in data["helplines"]] == ["112", "1091", "181"]
    assert data["station"]["name"].startswith("PS Sector 17")
    assert data["patrol_unit_km"] in (1.0, 1.5) and "lat" not in json.dumps(data["patrol_unit_km"])
    assert "PCR-12" not in json.dumps(data)


# --- retention ---------------------------------------------------------------------------

def test_retention_deletes_old_trails_but_keeps_fir_evidence(client, account, stations, monkeypatch):
    walker = account()
    keep, drop = _sos(client, walker), _sos(client, walker)
    for a in (keep, drop):
        client.post(f"/api/v1/alerts/{a}/location", headers=walker.headers, json={"lat": 30.74, "lon": 76.78})
        client.put(f"/api/v1/alerts/{a}/state", headers=walker.headers, json={"state": "CANCELLED", "pin": walker.pin})
    client.post(f"/api/v1/alerts/{keep}/fir-consent", headers=walker.headers, json={"pin": walker.pin})
    monkeypatch.setattr(settings, "RETENTION_DAYS", -1)  # everything closed counts as expired
    client.portal.call(police.apply_retention)
    assert client.portal.call(storage.get_alert_points, drop) == []
    # Trails go for every closed alert; FIR-consented evidence chunks stay on legal hold
    assert client.portal.call(storage.get_alert_by_id, keep)["fir_consent_at"]

"""SRS v1.0 acceptance criteria, exercised end to end through the HTTP API."""
import hashlib
import os
import time
import uuid

from conftest import backend_dir

GENESIS = "0" * 64


def _alert(client, acct, **extra):
    payload = {"id": str(uuid.uuid4()), "trigger_type": "SOS_BUTTON", "lat": 28.6910, "lon": 77.2120, **extra}
    res = client.post("/api/v1/alerts/sync", json=payload, headers=acct.headers)
    assert res.status_code == 201, res.text
    return payload["id"]


# Acceptance Criterion 1: Three scored routes returned, fastest and safest labelled
def test_criterion_1_route_comparison(client, account):
    walker = account()
    payload = {
        "origin": {"lat": 28.6910, "lon": 77.2120},
        "destination": {"lat": 28.7050, "lon": 77.2250},
        "walk_time": "2026-10-06T22:30:00",  # night weights: w_L=0.40, w_A=0.10, w_R=0.30, w_P=0.20
    }
    t0 = time.time()
    response = client.post("/api/v1/routes/compare", json=payload, headers=walker.headers)
    latency = time.time() - t0

    assert response.status_code == 200, response.text
    data = response.json()
    assert latency < 3.0, f"Route comparison took {latency:.2f}s, exceeding 3.0s target (NFR-1)"
    routes = data.get("routes", [])
    assert len(routes) >= 2, "Expected at least 2 to 3 route alternatives (ROUTE-2)"
    assert any(r.get("is_safest") for r in routes)
    assert any(r.get("is_fastest") for r in routes)
    for r in routes:
        assert 0.0 <= r["safety_score"] <= 100.0
        assert r["distance_meters"] > 0
        assert r["estimated_time_minutes"] > 0
    assert "higher safety score" in data.get("disclaimer", "").lower()
    assert "assistive tool" in data.get("disclaimer", "").lower()


# Acceptance Criterion 2: Walk tracking & 150m route deviation detection
def test_criterion_2_walk_tracking_and_deviation(client, account):
    walker = account()
    start = client.post("/api/v1/walks", headers=walker.headers, json={
        "origin_name": "Campus Gate", "destination_name": "Hostel 4", "chosen_route_id": "route_safest",
        "route_coords": [{"lat": 28.6910, "lon": 77.2120}, {"lat": 28.6930, "lon": 77.2140},
                         {"lat": 28.6960, "lon": 77.2170}],
        "safety_score": 84.5, "fastest_time_seconds": 900,
    })
    assert start.status_code == 201, start.text
    walk_id = start.json()["walk"]["id"]
    assert start.json()["ws_ticket"].startswith("wstk_"), "Expected one-time WebSocket ticket (NFR-10)"

    on_route = client.post(f"/api/v1/walks/{walk_id}/points", headers=walker.headers, json={"points": [
        {"lat": 28.6912, "lon": 77.2122, "speed": 1.2, "accuracy": 4.0},
        {"lat": 28.6920, "lon": 77.2130, "speed": 1.3, "accuracy": 3.5}]})
    assert on_route.status_code == 200
    assert on_route.json()["deviation_alert"] is False

    off_route = client.post(f"/api/v1/walks/{walk_id}/points", headers=walker.headers,
                            json={"points": [{"lat": 28.6950, "lon": 77.2080, "speed": 1.1, "accuracy": 5.0}]})
    assert off_route.status_code == 200
    assert off_route.json()["deviation_alert"] is True
    assert off_route.json()["deviation_distance_m"] > 150.0


# Acceptance Criterion 3 & 4: Offline alert sync with client UUID & idempotency
def test_criterion_3_and_4_alert_sync_idempotency(client, account):
    walker = account()
    payload = {"id": str(uuid.uuid4()), "trigger_type": "AUDIO_DISTRESS", "lat": 28.6925, "lon": 77.2140,
               "priority": "HIGH", "state": "ACTIVE"}
    res1 = client.post("/api/v1/alerts/sync", json=payload, headers=walker.headers)
    assert res1.status_code == 201, res1.text
    assert res1.json()["status"] == "synced"
    res2 = client.post("/api/v1/alerts/sync", json=payload, headers=walker.headers)
    assert res2.status_code == 201, res2.text
    assert res2.json()["status"] == "already_synced", "Duplicate UUID must be handled idempotently"


# Acceptance Criterion 5: Silent Duress PIN triggers covert high-priority alert
def test_criterion_5_duress_pin(client, account):
    walker = account(pin="1234", duress_pin="9999")
    # The app confirms the PIN before standing down an SOS countdown
    normal = client.post("/api/v1/me/pin/check", headers=walker.headers, json={"pin": "1234"})
    duress = client.post("/api/v1/me/pin/check", headers=walker.headers,
                         json={"pin": "9999", "lat": 30.7333, "lon": 76.7794})
    assert normal.status_code == duress.status_code == 200
    # DUR-3: nothing in the response may reveal which PIN was used
    assert normal.json() == duress.json()

    staff = account(role="responder")
    active = client.get("/api/v1/dashboard/alerts/active", headers=staff.headers).json()["alerts"]
    mine = [a for a in active if a["walker_phone"] == walker.phone]
    assert len(mine) == 1 and mine[0]["trigger_type"] == "DURESS_PIN" and mine[0]["priority"] == "HIGH"
    assert (mine[0]["lat"], mine[0]["lon"]) == (30.7333, 76.7794)


# Acceptance Criterion 6: Guardian Escalation Chain (60s ack timeout)
def test_criterion_6_escalation_chain(client, account):
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    alert_id = _alert(client, walker)

    esc = client.post(f"/api/v1/alerts/{alert_id}/escalate", headers=walker.headers)
    assert esc.status_code == 200, esc.text
    assert esc.json()["alert"]["state"] == "ESCALATED"

    ack = client.post(f"/api/v1/alerts/{alert_id}/ack", headers=guardian.headers, json={"action": "ACKNOWLEDGE"})
    assert ack.status_code == 200, ack.text
    assert ack.json()["alert"]["state"] == "ACKNOWLEDGED"


# Acceptance Criterion 7: Post-walk rating changes segment score
def test_criterion_7_rating_updates_segment_score(client, account):
    walker = account()
    res = client.post("/api/v1/ratings", headers=walker.headers, json={
        "segment_id": "seg_north_ridge_cutoff", "lit": True, "busy": True, "felt_safe": True,
        "gps_coverage_ratio": 0.85})
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "rating_accepted"
    assert res.json()["result"]["new_community_rating"] > 0.0


# Acceptance Criterion 8: Authority Dashboard active alerts, heatmap & CSV work list
def test_criterion_8_authority_dashboard(client, account):
    responder = account(role="responder")
    assert "alerts" in client.get("/api/v1/dashboard/alerts/active", headers=responder.headers).json()
    heat = client.get("/api/v1/dashboard/heatmap", headers=responder.headers)
    assert heat.status_code == 200 and len(heat.json()["heatmap"]) > 0
    csv_res = client.get("/api/v1/dashboard/gaps?format=csv", headers=responder.headers)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "lamp_density_per_100m" in csv_res.text


# Acceptance Criterion 9: Encrypted audio evidence & SHA-256 hash chaining
def test_criterion_9_evidence_encryption_and_chaining(client, account):
    walker = account()
    alert_id = _alert(client, walker)

    c0_text = "GCM_ENCRYPTED_CIPHERTEXT_BURST_000=="
    c0_hash = hashlib.sha256(c0_text.encode()).hexdigest()
    c0 = client.post("/api/v1/evidence/chunks", headers=walker.headers, json={
        "alert_id": alert_id, "seq": 0, "ciphertext_base64": c0_text, "sha256": c0_hash,
        "prev_sha256": GENESIS, "wrapped_keys": {"guardian_1": "RSA_OAEP_SEALED_KEY_1=="}})
    assert c0.status_code == 201, c0.text

    c1_text = "GCM_ENCRYPTED_CIPHERTEXT_BURST_001=="
    c1_hash = hashlib.sha256(c1_text.encode()).hexdigest()
    c1 = client.post("/api/v1/evidence/chunks", headers=walker.headers, json={
        "alert_id": alert_id, "seq": 1, "ciphertext_base64": c1_text, "sha256": c1_hash,
        "prev_sha256": c0_hash, "wrapped_keys": {"guardian_1": "RSA_OAEP_SEALED_KEY_2=="}})
    assert c1.status_code == 201, c1.text
    assert c1.json()["prev_sha256"] == c0_hash
    assert "cannot read" in c1.json()["privacy_notice"].lower()

    listing = client.get(f"/api/v1/evidence/chunks/{alert_id}", headers=walker.headers).json()
    assert listing["total_chunks"] == 2 and listing["chain_intact"] is True


# Acceptance Criterion 10: Audio model evaluation report generated
def test_criterion_10_audio_evaluation_report():
    report_file = os.path.join(backend_dir, "ml", "audio_model_evaluation_report.md")
    assert os.path.exists(report_file), "Audio model evaluation report must exist (DET-7, Criterion 10)"
    with open(report_file, "r", encoding="utf-8") as f:
        content = f.read()
    for needle in ("Scream Recall", "ESC-50", "glass_breaking", "crying_baby"):
        assert needle in content


def test_evidence_hash_rejection_on_mismatch(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    res = client.post("/api/v1/evidence/chunks", headers=walker.headers, json={
        "alert_id": alert_id, "seq": 0, "ciphertext_base64": "TAMPERED_CIPHERTEXT_BURST_DATA==",
        "sha256": GENESIS, "prev_sha256": GENESIS, "wrapped_keys": {"guardian_1": "RSA_OAEP_KEY=="}})
    assert res.status_code == 400
    assert "integrity violation" in res.json()["detail"].lower()


def test_nfr10_websocket_ticket_issuance(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    res = client.post("/api/v1/auth/ws-ticket", json={"channel_id": alert_id}, headers=walker.headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["ticket"].startswith("wstk_")
    assert data["channel_id"] == alert_id and data["channel_kind"] == "alert"
    assert data["expires_in_seconds"] == 60


def test_walk_monitoring_long_stop_and_checkin(client, account):
    walker = account()
    start = client.post("/api/v1/walks", headers=walker.headers, json={
        "origin_name": "Metro Station", "destination_name": "Hostel 9", "chosen_route_id": "route_safest",
        "route_coords": [{"lat": 28.6910, "lon": 77.2120}, {"lat": 28.6950, "lon": 77.2160}],
        "safety_score": 82.0, "fastest_time_seconds": 600})
    walk_id = start.json()["walk"]["id"]

    data = client.post(f"/api/v1/walks/{walk_id}/points", headers=walker.headers, json={"points": [
        {"lat": 28.7500, "lon": 77.1500, "speed": 0.05, "accuracy": 3.0, "battery_level": 0.12}]}).json()
    assert data["long_stop_detected"] is True
    assert data["checkin_required"] is True
    assert data["low_battery_mode"] is True
    assert data["sampling_rate_seconds"] == 30  # WALK-8 low battery conservation

    no_pin = client.post(f"/api/v1/walks/{walk_id}/checkin", headers=walker.headers,
                         json={"acknowledged": True, "safe": True})
    assert no_pin.status_code == 403  # someone holding the phone cannot dismiss the check
    ok = client.post(f"/api/v1/walks/{walk_id}/checkin", headers=walker.headers,
                     json={"acknowledged": True, "safe": True, "dismissal_latency_seconds": 4.5, "pin": walker.pin})
    assert ok.json()["status"] == "checkin_confirmed"

    # WALK-6: a missed check-in must open a real alert, not just log
    missed = client.post(f"/api/v1/walks/{walk_id}/checkin", headers=walker.headers,
                         json={"acknowledged": False, "safe": False})
    assert missed.json()["status"] == "escalation_triggered"
    alert = client.get(f"/api/v1/alerts/{missed.json()['alert_id']}", headers=walker.headers).json()["alert"]
    assert alert["trigger_type"] == "CHECKIN_TIMEOUT" and alert["walk_id"] == walk_id


def test_generalizable_coordinate_routing_and_route9_cache(client, account):
    walker = account()
    payload = {"origin": {"lat": 28.5355, "lon": 77.3910}, "destination": {"lat": 28.5480, "lon": 77.4080},
               "walk_time": "2026-10-06T20:00:00"}
    t0 = time.time()
    res1 = client.post("/api/v1/routes/compare", json=payload, headers=walker.headers)
    t_first = time.time() - t0
    assert res1.status_code == 200
    assert len(res1.json()["routes"]) >= 2
    assert any(r["is_safest"] for r in res1.json()["routes"])
    t1 = time.time()
    assert client.post("/api/v1/routes/compare", json=payload, headers=walker.headers).status_code == 200
    assert time.time() - t1 <= t_first + 0.1

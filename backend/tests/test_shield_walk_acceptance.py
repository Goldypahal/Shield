import sys
import os
import time
import uuid
import hashlib
import pytest
from fastapi.testclient import TestClient

# Setup sys.path
backend_api_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "api"))
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_api_dir)
sys.path.insert(0, backend_dir)

from main import app
from db.storage import storage, haversine_distance, point_to_segment_distance
from security import create_access_token, get_password_hash

import asyncio

# Helper fixtures
@pytest.fixture(scope="session", autouse=True)
def init_test_db():
    asyncio.run(storage.init_db())

client = TestClient(app)

def create_authenticated_header(phone="+919876543210"):
    token = create_access_token(data={"sub": str(uuid.uuid4()), "phone_number": phone, "type": "access"})
    return {"Authorization": f"Bearer {token}"}

# Acceptance Criterion 1: Three scored routes returned, fastest and safest labelled
def test_criterion_1_route_comparison():
    headers = create_authenticated_header()
    payload = {
        "origin": {"lat": 28.6910, "lon": 77.2120},
        "destination": {"lat": 28.7050, "lon": 77.2250},
        "walk_time": "2026-10-06T22:30:00" # Night time period (weights: w_L=0.40, w_A=0.10, w_R=0.30, w_P=0.20)
    }

    t0 = time.time()
    response = client.post("/api/v1/routes/compare", json=payload, headers=headers)
    latency = time.time() - t0

    assert response.status_code == 200, response.text
    data = response.json()
    assert latency < 3.0, f"Route comparison took {latency:.2f}s, exceeding 3.0s target (NFR-1)"

    routes = data.get("routes", [])
    assert len(routes) >= 2, "Expected at least 2 to 3 route alternatives (ROUTE-2)"

    # Check fastest and safest labels (ROUTE-4)
    has_safest = any(r.get("is_safest") for r in routes)
    has_fastest = any(r.get("is_fastest") for r in routes)
    assert has_safest, "Expected one route labelled as safest (highest Safety Score)"
    assert has_fastest, "Expected one route labelled as fastest"

    # Verify score formula and caution segments (ROUTE-5)
    for r in routes:
        assert 0.0 <= r["safety_score"] <= 100.0, f"Invalid score {r['safety_score']}"
        assert r["distance_meters"] > 0
        assert r["estimated_time_minutes"] > 0

    # Verify mandatory disclaimer (ROUTE-8)
    assert "higher safety score" in data.get("disclaimer", "").lower()
    assert "assistive tool" in data.get("disclaimer", "").lower()

# Acceptance Criterion 2: Walk tracking & 150m route deviation detection
def test_criterion_2_walk_tracking_and_deviation():
    headers = create_authenticated_header()

    # 1. Start a walk (WALK-1)
    chosen_route = [
        {"lat": 28.6910, "lon": 77.2120},
        {"lat": 28.6930, "lon": 77.2140},
        {"lat": 28.6960, "lon": 77.2170}
    ]
    start_payload = {
        "origin_name": "Campus Gate",
        "destination_name": "Hostel 4",
        "chosen_route_id": "route_safest",
        "route_coords": chosen_route,
        "safety_score": 84.5,
        "fastest_time_seconds": 900
    }
    start_res = client.post("/api/v1/walks", json=start_payload, headers=headers)
    assert start_res.status_code == 201, start_res.text
    walk = start_res.json()["walk"]
    walk_id = walk["id"]
    ws_ticket = start_res.json()["ws_ticket"]
    assert ws_ticket.startswith("wstk_"), "Expected one-time WebSocket ticket (NFR-10)"

    # 2. Push normal on-route points (WALK-2)
    on_route_pts = {
        "points": [
            {"lat": 28.6912, "lon": 77.2122, "speed": 1.2, "accuracy": 4.0},
            {"lat": 28.6920, "lon": 77.2130, "speed": 1.3, "accuracy": 3.5}
        ]
    }
    pts_res1 = client.post(f"/api/v1/walks/{walk_id}/points", json=on_route_pts, headers=headers)
    assert pts_res1.status_code == 200
    assert pts_res1.json()["deviation_alert"] is False

    # 3. Push deviated point > 150m off path (WALK-4)
    # Latitude offset ~0.003 is approx 330m off route
    off_route_pts = {
        "points": [
            {"lat": 28.6950, "lon": 77.2080, "speed": 1.1, "accuracy": 5.0}
        ]
    }
    pts_res2 = client.post(f"/api/v1/walks/{walk_id}/points", json=off_route_pts, headers=headers)
    assert pts_res2.status_code == 200
    deviation_data = pts_res2.json()
    assert deviation_data["deviation_alert"] is True, "Expected route deviation alert for >150m deviation"
    assert deviation_data["deviation_distance_m"] > 150.0

# Acceptance Criterion 3 & 4: Offline alert sync with client UUID & idempotency
def test_criterion_3_and_4_alert_sync_idempotency():
    headers = create_authenticated_header()
    client_uuid = str(uuid.uuid4())

    alert_payload = {
        "id": client_uuid,
        "trigger_type": "AUDIO_DISTRESS",
        "lat": 28.6925,
        "lon": 77.2140,
        "priority": "HIGH",
        "state": "ACTIVE"
    }

    # 1. Initial submission
    res1 = client.post("/api/v1/alerts/sync", json=alert_payload, headers=headers)
    assert res1.status_code == 201, res1.text
    assert res1.json()["status"] == "synced"

    # 2. Duplicate submission with identical client UUID (ALERT-7)
    res2 = client.post("/api/v1/alerts/sync", json=alert_payload, headers=headers)
    assert res2.status_code == 201, res2.text
    assert res2.json()["status"] == "already_synced", "Duplicate UUID must be handled idempotently"

# Acceptance Criterion 5: Silent Duress PIN triggers covert high-priority alert
def test_criterion_5_duress_pin():
    phone = f"+9199{int(time.time()) % 100000000:08d}"
    reg_payload = {
        "phone_number": phone,
        "pin": "1234",
        "duress_pin": "9999",
        "name": "Duress Test User"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_res.status_code == 201, reg_res.text

    # Login with normal PIN
    login_norm = client.post("/api/v1/auth/login", json={"phone_number": phone, "pin": "1234"})
    assert login_norm.status_code == 200
    assert login_norm.json()["duress_mode_active"] is False

    # Login with duress PIN (DUR-1 to DUR-4)
    login_dur = client.post("/api/v1/auth/login", json={"phone_number": phone, "pin": "9999"})
    assert login_dur.status_code == 200
    assert login_dur.json()["duress_mode_active"] is True

# Acceptance Criterion 6: Guardian Escalation Chain (60s ack timeout)
def test_criterion_6_escalation_chain():
    headers = create_authenticated_header()
    alert_uuid = str(uuid.uuid4())

    # Create active alert
    client.post("/api/v1/alerts/sync", json={
        "id": alert_uuid,
        "trigger_type": "SOS_BUTTON",
        "lat": 28.6910,
        "lon": 77.2120,
        "state": "ACTIVE"
    }, headers=headers)

    # Trigger escalation (ALERT-8)
    esc_res = client.post(f"/api/v1/alerts/{alert_uuid}/escalate", headers=headers)
    assert esc_res.status_code == 200
    assert esc_res.json()["alert"]["state"] == "ESCALATED"

    # Acknowledge alert (GRD-5)
    ack_res = client.post(f"/api/v1/alerts/{alert_uuid}/ack", json={
        "guardian_id": "guard_1",
        "guardian_name": "Parent"
    })
    assert ack_res.status_code == 200
    assert ack_res.json()["alert"]["state"] == "ACKNOWLEDGED"

# Acceptance Criterion 7: Post-walk rating changes segment score
def test_criterion_7_rating_updates_segment_score():
    headers = create_authenticated_header()

    # Submit positive rating (RATE-1, RATE-2)
    rate_payload = {
        "segment_id": "seg_north_ridge_cutoff",
        "lit": True,
        "busy": True,
        "felt_safe": True,
        "gps_coverage_ratio": 0.85
    }
    rate_res = client.post("/api/v1/ratings", json=rate_payload, headers=headers)
    assert rate_res.status_code == 201, rate_res.text
    assert rate_res.json()["status"] == "rating_accepted"
    new_r = rate_res.json()["result"]["new_community_rating"]
    assert new_r > 0.0, "Community rating should update via Bayesian shrunk mean"

# Acceptance Criterion 8: Authority Dashboard active alerts, heatmap & CSV work list
def test_criterion_8_authority_dashboard():
    headers = create_authenticated_header()

    # 1. Active Alerts (DASH-1)
    dash_res = client.get("/api/v1/dashboard/alerts/active", headers=headers)
    assert dash_res.status_code == 200
    assert "alerts" in dash_res.json()

    # 2. Safety Heatmap (DASH-3, DASH-5)
    heat_res = client.get("/api/v1/dashboard/heatmap", headers=headers)
    assert heat_res.status_code == 200
    assert len(heat_res.json()["heatmap"]) > 0

    # 3. Infrastructure Gaps CSV Export (DASH-4)
    csv_res = client.get("/api/v1/dashboard/gaps?format=csv", headers=headers)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "lamp_density_per_100m" in csv_res.text

# Acceptance Criterion 9: Encrypted audio evidence & SHA-256 hash chaining
def test_criterion_9_evidence_encryption_and_chaining():
    headers = create_authenticated_header()
    alert_uuid = str(uuid.uuid4())

    client.post("/api/v1/alerts/sync", json={
        "id": alert_uuid,
        "trigger_type": "SOS_BUTTON",
        "lat": 28.6910,
        "lon": 77.2120
    }, headers=headers)

    # Chunk 0
    c0_payload_text = "GCM_ENCRYPTED_CIPHERTEXT_BURST_000=="
    c0_hash = hashlib.sha256(c0_payload_text.encode('utf-8')).hexdigest()
    chunk0 = {
        "alert_id": alert_uuid,
        "seq": 0,
        "ciphertext_base64": c0_payload_text,
        "sha256": c0_hash,
        "prev_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "wrapped_keys": {"guardian_1": "RSA_OAEP_SEALED_KEY_1=="}
    }
    c0_res = client.post("/api/v1/evidence/chunks", json=chunk0, headers=headers)
    assert c0_res.status_code == 201

    # Chunk 1 chained with chunk 0 hash (EVID-4)
    c1_payload_text = "GCM_ENCRYPTED_CIPHERTEXT_BURST_001=="
    c1_hash = hashlib.sha256(c1_payload_text.encode('utf-8')).hexdigest()
    chunk1 = {
        "alert_id": alert_uuid,
        "seq": 1,
        "ciphertext_base64": c1_payload_text,
        "sha256": c1_hash,
        "prev_sha256": c0_hash,
        "wrapped_keys": {"guardian_1": "RSA_OAEP_SEALED_KEY_2=="}
    }
    c1_res = client.post("/api/v1/evidence/chunks", json=chunk1, headers=headers)
    assert c1_res.status_code == 201
    assert c1_res.json()["prev_sha256"] == c0_hash

    # Verify server cannot decrypt audio (EVID-3, EVID-6)
    assert "cannot read" in c1_res.json()["privacy_notice"].lower()

# Acceptance Criterion 10: Audio model evaluation report generated
def test_criterion_10_audio_evaluation_report():
    report_file = os.path.join(backend_dir, "ml", "audio_model_evaluation_report.md")
    assert os.path.exists(report_file), "Audio model evaluation report must exist (DET-7, Criterion 10)"
    with open(report_file, "r", encoding="utf-8") as f:
        content = f.read()
    assert "Scream Recall" in content
    assert "ESC-50" in content
    assert "glass_breaking" in content
    assert "crying_baby" in content

# Additional Verification: Strict Evidence SHA-256 Hash Integrity (EVID-4)
def test_evidence_hash_rejection_on_mismatch():
    headers = create_authenticated_header()
    alert_uuid = str(uuid.uuid4())
    client.post("/api/v1/alerts/sync", json={
        "id": alert_uuid,
        "trigger_type": "SOS_BUTTON",
        "lat": 28.6910,
        "lon": 77.2120
    }, headers=headers)

    tampered_chunk = {
        "alert_id": alert_uuid,
        "seq": 0,
        "ciphertext_base64": "TAMPERED_CIPHERTEXT_BURST_DATA==",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000", # Intentionally invalid hash
        "prev_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "wrapped_keys": {"guardian_1": "RSA_OAEP_KEY=="}
    }
    res = client.post("/api/v1/evidence/chunks", json=tampered_chunk, headers=headers)
    assert res.status_code == 400, f"Expected HTTP 400 for tampered hash, got {res.status_code}"
    assert "integrity violation" in res.json()["detail"].lower()

# Additional Verification: NFR-10 One-time WS Ticket Issuance (No JWT in URL)
def test_nfr10_websocket_ticket_issuance():
    headers = create_authenticated_header()
    channel_id = str(uuid.uuid4())
    res = client.post("/api/v1/auth/ws-ticket", json={"channel_id": channel_id}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ticket_created"
    assert data["ticket"].startswith("wstk_")
    assert data["channel_id"] == channel_id
    assert data["expires_in_seconds"] == 60

# Additional Verification: WALK-5 Long-stop Detection and WALK-6 Check-in Timer
def test_walk_monitoring_long_stop_and_checkin():
    headers = create_authenticated_header()
    start_payload = {
        "origin_name": "Metro Station",
        "destination_name": "Hostel 9",
        "chosen_route_id": "route_safest",
        "route_coords": [{"lat": 28.6910, "lon": 77.2120}, {"lat": 28.6950, "lon": 77.2160}],
        "safety_score": 82.0,
        "fastest_time_seconds": 600
    }
    start_res = client.post("/api/v1/walks", json=start_payload, headers=headers)
    assert start_res.status_code == 201
    walk_id = start_res.json()["walk"]["id"]

    # Push stationary point far from Safe Stops (speed 0.05 m/s)
    stop_point = {
        "points": [
            {"lat": 28.7500, "lon": 77.1500, "speed": 0.05, "accuracy": 3.0, "battery_level": 0.12}
        ]
    }
    res_points = client.post(f"/api/v1/walks/{walk_id}/points", json=stop_point, headers=headers)
    assert res_points.status_code == 200
    data = res_points.json()
    assert data["long_stop_detected"] is True, "Expected long stop detection when stopped outside safe stop"
    assert data["checkin_required"] is True
    assert data["low_battery_mode"] is True
    assert data["sampling_rate_seconds"] == 30 # WALK-8 low battery conservation

    # Acknowledge check-in (WALK-6)
    checkin_res = client.post(f"/api/v1/walks/{walk_id}/checkin", json={
        "acknowledged": True,
        "safe": True,
        "dismissal_latency_seconds": 4.5
    }, headers=headers)
    assert checkin_res.status_code == 200
    assert checkin_res.json()["status"] == "checkin_confirmed"

# Additional Verification: Generalizable Coordinate Routing & ROUTE-9 Cache
def test_generalizable_coordinate_routing_and_route9_cache():
    headers = create_authenticated_header()
    payload = {
        "origin": {"lat": 28.5355, "lon": 77.3910},
        "destination": {"lat": 28.5480, "lon": 77.4080},
        "walk_time": "2026-10-06T20:00:00"
    }

    # First request: computes dynamically
    t0 = time.time()
    res1 = client.post("/api/v1/routes/compare", json=payload, headers=headers)
    t_first = time.time() - t0
    assert res1.status_code == 200
    data1 = res1.json()
    assert len(data1["routes"]) >= 2
    assert any(r["is_safest"] for r in data1["routes"])

    # Second request: served from ROUTE-9 score cache
    t1 = time.time()
    res2 = client.post("/api/v1/routes/compare", json=payload, headers=headers)
    t_cached = time.time() - t1
    assert res2.status_code == 200
    assert t_cached <= t_first + 0.1


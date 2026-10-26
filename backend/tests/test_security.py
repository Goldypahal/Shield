"""Regression tests for the access-control and authentication fixes.

Each test pins down one hole that existed before the hardening pass, so it
cannot quietly reopen.
"""
import hashlib
import uuid
from datetime import timedelta

from security import create_access_token

GENESIS = "0" * 64


def _alert(client, acct):
    alert_id = str(uuid.uuid4())
    res = client.post("/api/v1/alerts/sync", headers=acct.headers,
                      json={"id": alert_id, "trigger_type": "SOS_BUTTON", "lat": 30.73, "lon": 76.78})
    assert res.status_code == 201, res.text
    return alert_id


def _walk(client, acct, shared=None):
    res = client.post("/api/v1/walks", headers=acct.headers, json={
        "origin_name": "A", "destination_name": "B", "chosen_route_id": "r",
        "route_coords": [{"lat": 30.73, "lon": 76.78}, {"lat": 30.74, "lon": 76.79}],
        "safety_score": 70, "fastest_time_seconds": 600, "shared_guardian_ids": shared or []})
    assert res.status_code == 201, res.text
    return res.json()["walk"]["id"]


# --- Authentication -------------------------------------------------------

def test_signup_codes_are_random_single_use_and_required(client):
    from conftest import PASSWORD, new_email, new_phone
    email, phone = new_email(), new_phone()
    codes = client.post("/api/v1/auth/register/start", json={"email": email, "phone_number": phone}).json()
    body = {"email": email, "phone_number": phone, "password": PASSWORD, "name": "N", "pin": "2468",
            "police_sharing": False}
    wrong = f"{(int(codes['demo_email_code']) + 1) % 10**6:06d}"
    assert client.post("/api/v1/auth/register/complete", json={
        **body, "email_code": wrong, "phone_code": codes["demo_phone_code"]}).status_code == 400
    # The phone code was burned by the failed attempt only if it was checked; ask again for fresh codes
    client.portal.call(storage_reset_resend, email, phone)
    codes = client.post("/api/v1/auth/register/start", json={"email": email, "phone_number": phone}).json()
    ok = {**body, "email_code": codes["demo_email_code"], "phone_code": codes["demo_phone_code"]}
    assert client.post("/api/v1/auth/register/complete", json=ok).status_code == 201
    assert client.post("/api/v1/auth/register/complete", json=ok).status_code == 400  # codes burned


async def storage_reset_resend(email, phone):
    """Test helper: skip the 30 s resend wait."""
    from db.storage import storage
    async with storage._connect() as db:
        await db.execute("DELETE FROM verification_codes WHERE code_key IN (?, ?)",
                         (f"email:signup:{email}", f"sms:signup:{phone}"))
        await db.commit()


def test_signup_does_not_reveal_registered_emails(client, account):
    from conftest import new_phone
    walker = account()
    res = client.post("/api/v1/auth/register/start", json={"email": walker.email, "phone_number": new_phone()})
    assert res.status_code == 200 and "demo_email_code" not in res.json()  # no code issued, same status


def test_weak_passwords_rejected(client):
    from conftest import new_email, new_phone, register
    for weak in ("short", "password123", "aaaaaaaaaaaa"):
        assert register(client, new_email(), new_phone(), password=weak).status_code == 400


def test_login_errors_do_not_reveal_which_part_was_wrong(client, account):
    walker = account()
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "whatever-123"})
    wrong = client.post("/api/v1/auth/login", json={"email": walker.email, "password": "whatever-123"})
    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


def test_refresh_token_is_not_an_access_token(client, account):
    walker = account()
    res = client.get("/api/v1/me", headers={"Authorization": f"Bearer {walker.refresh_token}"})
    assert res.status_code == 401


def test_refresh_tokens_rotate_and_reuse_revokes_everything(client, account):
    walker = account()
    first = walker.refresh_token
    rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert rotated.status_code == 200
    # Replaying the old token (as a thief would) kills every session, including the new one
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": first}).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": rotated.json()["refresh_token"]}).status_code == 401
    assert client.get("/api/v1/me", headers=walker.headers).status_code == 401


def test_logout_all_invalidates_access_tokens(client, account):
    walker = account()
    assert client.post("/api/v1/auth/logout-all", headers=walker.headers).status_code == 200
    assert client.get("/api/v1/me", headers=walker.headers).status_code == 401


def test_token_with_wrong_algorithm_or_issuer_rejected(client, account):
    import jwt
    walker = account()
    forged = jwt.encode({"sub": walker.user_id, "type": "access", "iss": "shield-api", "iat": 0, "exp": 9999999999},
                        key=None, algorithm="none")
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    import settings
    other_issuer = jwt.encode({"sub": walker.user_id, "type": "access", "iss": "evil", "iat": 0, "exp": 9999999999},
                              settings.JWT_SECRET, algorithm="HS256")
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {other_issuer}"}).status_code == 401


def test_token_for_unknown_or_deleted_user_rejected(client, account):
    ghost = create_access_token({"sub": str(uuid.uuid4()), "type": "access"}, timedelta(minutes=5))
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {ghost}"}).status_code == 401

    walker = account()
    assert client.request("DELETE", "/api/v1/me/account", headers=walker.headers,
                          json={"password": walker.password}).status_code == 200
    assert client.get("/api/v1/me", headers=walker.headers).status_code == 401


def test_account_deletion_requires_real_password(client, account):
    walker = account()
    for pw in ("wrong-password-1", walker.pin, walker.duress_pin):
        assert client.request("DELETE", "/api/v1/me/account", headers=walker.headers,
                              json={"password": pw}).status_code == 403
    assert client.get("/api/v1/me", headers=walker.headers).status_code == 200


def test_login_lockout_after_repeated_wrong_passwords(client, account):
    walker = account()
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"email": walker.email, "password": "wrong-password-1"})
    res = client.post("/api/v1/auth/login", json={"email": walker.email, "password": walker.password})
    assert res.status_code == 429


def test_password_reset_needs_emailed_code_and_signs_out(client, account):
    walker = account()
    assert client.post("/api/v1/auth/password/reset", json={
        "email": walker.email, "code": "123456", "new_password": "a brand new passphrase"}).status_code == 400
    code = client.post("/api/v1/auth/password/forgot", json={"email": walker.email}).json()["demo_email_code"]
    assert client.post("/api/v1/auth/password/reset", json={
        "email": walker.email, "code": code, "new_password": "a brand new passphrase"}).status_code == 200
    assert client.get("/api/v1/me", headers=walker.headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={
        "email": walker.email, "password": "a brand new passphrase"}).status_code == 200
    unknown = client.post("/api/v1/auth/password/forgot", json={"email": "nobody@example.com"})
    assert unknown.status_code == 200 and unknown.json()["status"] == "code_sent_if_account_exists"


def test_pin_change_requires_email_code_and_password(client, account):
    walker = account()
    new = {"pin": "1111", "duress_pin": "2222"}
    assert client.post("/api/v1/me/pins", headers=walker.headers,
                       json={**new, "email_code": "123456", "password": walker.password}).status_code == 400
    code = client.post("/api/v1/me/pins/code", headers=walker.headers).json()["demo_email_code"]
    assert client.post("/api/v1/me/pins", headers=walker.headers,
                       json={**new, "email_code": code, "password": "wrong-password-1"}).status_code == 403
    client.portal.call(_clear_code, f"email:change_pin:{walker.email}")
    code = client.post("/api/v1/me/pins/code", headers=walker.headers).json()["demo_email_code"]
    assert client.post("/api/v1/me/pins", headers=walker.headers,
                       json={**new, "email_code": code, "password": walker.password}).status_code == 200
    alert_id = _alert(client, walker)
    assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                      json={"state": "CANCELLED", "pin": "1111"}).status_code == 200


async def _clear_code(key):
    from db.storage import storage
    async with storage._connect() as db:
        await db.execute("DELETE FROM verification_codes WHERE code_key = ?", (key,))
        await db.commit()


def test_profile_never_returns_secrets(client, account):
    profile = client.get("/api/v1/me", headers=account().headers).json()
    for secret in ("hashed_pin", "duress_pin", "password_hash", "token_version"):
        assert secret not in profile


# --- Object-level authorization ------------------------------------------

def test_stranger_cannot_read_or_drive_someone_elses_alert(client, account):
    walker, stranger = account(), account()
    alert_id = _alert(client, walker)
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=stranger.headers).status_code == 404
    assert client.post(f"/api/v1/alerts/{alert_id}/ack", headers=stranger.headers).status_code == 404
    assert client.post(f"/api/v1/alerts/{alert_id}/escalate", headers=stranger.headers).status_code == 404
    assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=stranger.headers,
                      json={"state": "CANCELLED", "pin": "1234"}).status_code == 404
    assert client.post(f"/api/v1/alerts/{alert_id}/false-alarm", headers=stranger.headers,
                       json={"reason": "x"}).status_code == 404
    assert client.post(f"/api/v1/reports/incident/{alert_id}/pdf", headers=stranger.headers).status_code == 404


def test_ack_and_escalate_require_authentication(client, account):
    alert_id = _alert(client, account())
    assert client.post(f"/api/v1/alerts/{alert_id}/ack", json={}).status_code in (401, 403)
    assert client.post(f"/api/v1/alerts/{alert_id}/escalate").status_code in (401, 403)


def test_unverified_guardian_has_no_access(client, account):
    walker, invited = account(), account()
    walker.add_guardian(invited, verify=False)
    alert_id = _alert(client, walker)
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=invited.headers).status_code == 404


def test_guardian_invite_only_accepted_by_invited_phone(client, account):
    walker, invited, stranger = account(), account(), account()
    gid = walker.add_guardian(invited, verify=False)
    assert client.post(f"/api/v1/guardians/{gid}/verify", headers=stranger.headers).status_code == 404
    assert client.post(f"/api/v1/guardians/{gid}/verify", headers=invited.headers).status_code == 200


def test_stranger_cannot_read_or_write_walk(client, account):
    walker, stranger = account(), account()
    walk_id = _walk(client, walker)
    assert client.get(f"/api/v1/walks/{walk_id}", headers=stranger.headers).status_code == 404
    pts = {"points": [{"lat": 30.73, "lon": 76.78}]}
    assert client.post(f"/api/v1/walks/{walk_id}/points", headers=stranger.headers, json=pts).status_code == 404
    assert client.post(f"/api/v1/walks/{walk_id}/end", headers=stranger.headers).status_code == 404


def test_walk_shared_only_with_selected_guardians(client, account):
    walker, g1, g2 = account(), account(), account()
    gid1 = walker.add_guardian(g1)
    walker.add_guardian(g2)
    walk_id = _walk(client, walker, shared=[gid1])
    assert client.get(f"/api/v1/walks/{walk_id}", headers=g1.headers).status_code == 200
    assert client.get(f"/api/v1/walks/{walk_id}", headers=g2.headers).status_code == 404


def test_ws_ticket_only_for_permitted_channels(client, account):
    walker, guardian, stranger = account(), account(), account()
    walker.add_guardian(guardian)
    walk_id = _walk(client, walker)
    assert client.post("/api/v1/auth/ws-ticket", headers=stranger.headers,
                       json={"channel_id": walk_id}).status_code == 404
    assert client.post("/api/v1/auth/ws-ticket", headers=guardian.headers,
                       json={"channel_id": walk_id}).status_code == 200


def test_guardian_receives_live_sos_location_over_websocket(client, account):
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    alert_id = _alert(client, walker)
    ticket = client.post("/api/v1/auth/ws-ticket", headers=guardian.headers,
                         json={"channel_id": alert_id}).json()["ticket"]
    with client.websocket_connect(f"/ws/alert/{alert_id}?ticket={ticket}") as ws:
        res = client.post(f"/api/v1/alerts/{alert_id}/location", headers=walker.headers,
                          json={"lat": 30.7401, "lon": 76.7802, "accuracy": 6})
        assert res.status_code == 200 and res.json()["subscribers"] == 1
        frame = ws.receive_json()
        assert frame["type"] == "location" and frame["lat"] == 30.7401


def test_ws_ticket_is_single_use(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    ticket = client.post("/api/v1/auth/ws-ticket", headers=walker.headers,
                         json={"channel_id": alert_id}).json()["ticket"]
    with client.websocket_connect(f"/ws/alert/{alert_id}?ticket={ticket}"):
        pass
    try:
        with client.websocket_connect(f"/ws/alert/{alert_id}?ticket={ticket}") as ws:
            ws.receive_text()
        reused = True
    except Exception:
        reused = False
    assert not reused


def test_alert_id_reuse_by_another_user_conflicts(client, account):
    a, b = account(), account()
    alert_id = _alert(client, a)
    res = client.post("/api/v1/alerts/sync", headers=b.headers,
                      json={"id": alert_id, "trigger_type": "SOS_BUTTON", "lat": 1, "lon": 1})
    assert res.status_code == 409


def test_dashboard_requires_staff_role(client, account):
    walker, responder, admin = account(), account(role="responder"), account(role="admin")
    for path in ("/api/v1/dashboard/alerts/active", "/api/v1/dashboard/heatmap", "/api/v1/dashboard/gaps"):
        assert client.get(path, headers=walker.headers).status_code == 403
        assert client.get(path, headers=responder.headers).status_code == 200
    assert client.get("/api/v1/dashboard/audit-logs", headers=responder.headers).status_code == 403
    assert client.get("/api/v1/dashboard/audit-logs", headers=admin.headers).status_code == 200


# --- Evidence ------------------------------------------------------------

def _chunk(alert_id, seq, text, prev):
    return {"alert_id": alert_id, "seq": seq, "ciphertext_base64": text,
            "sha256": hashlib.sha256(text.encode()).hexdigest(), "prev_sha256": prev, "wrapped_keys": {}}


def test_evidence_path_traversal_and_foreign_alert_rejected(client, account):
    walker, other = account(), account()
    for evil in ("../../api/main", "..\\..\\x", "not-a-real-alert"):
        assert client.post("/api/v1/evidence/chunks", headers=walker.headers,
                           json=_chunk(evil, 0, "abc", GENESIS)).status_code == 404
    foreign = _alert(client, other)
    assert client.post("/api/v1/evidence/chunks", headers=walker.headers,
                       json=_chunk(foreign, 0, "abc", GENESIS)).status_code == 404


def test_evidence_chain_must_be_continuous(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    first = _chunk(alert_id, 0, "chunk-zero", GENESIS)
    assert client.post("/api/v1/evidence/chunks", headers=walker.headers, json=first).status_code == 201
    # replaying seq 0 must not overwrite stored evidence
    assert client.post("/api/v1/evidence/chunks", headers=walker.headers,
                       json=_chunk(alert_id, 0, "forged", GENESIS)).status_code == 409
    # seq 1 pointing at the wrong parent breaks the chain
    assert client.post("/api/v1/evidence/chunks", headers=walker.headers,
                       json=_chunk(alert_id, 1, "chunk-one", GENESIS)).status_code == 409
    assert client.post("/api/v1/evidence/chunks", headers=walker.headers,
                       json=_chunk(alert_id, 1, "chunk-one", first["sha256"])).status_code == 201


# --- Alert state machine & duress ---------------------------------------

def test_closed_alert_cannot_be_reopened(client, account):
    walker, responder = account(), account(role="responder")
    alert_id = _alert(client, walker)
    assert client.post(f"/api/v1/dashboard/alerts/{alert_id}/resolve", headers=responder.headers,
                       json={"responder_name": "Unit 7", "resolution_notes": "Walker safe"}).status_code == 200
    assert client.post(f"/api/v1/alerts/{alert_id}/escalate", headers=responder.headers).status_code == 409


def test_every_stand_down_needs_pin_even_pre_alert(client, account):
    walker = account()
    for state in ("CANCELLED", "RESOLVED", "FALSE_ALARM"):
        alert_id = str(uuid.uuid4())
        client.post("/api/v1/alerts/sync", headers=walker.headers, json={
            "id": alert_id, "trigger_type": "SOS_BUTTON", "lat": 30.73, "lon": 76.78, "state": "PRE_ALERT"})
        assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                          json={"state": state}).status_code == 403


def test_wrong_pins_escalate_then_lock(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    for _ in range(3):
        assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                          json={"state": "CANCELLED", "pin": "0000"}).status_code == 403
    assert client.get(f"/api/v1/alerts/{alert_id}", headers=walker.headers).json()["alert"]["state"] == "ESCALATED"
    for _ in range(2):
        client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers, json={"state": "CANCELLED", "pin": "0000"})
    locked = client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                        json={"state": "CANCELLED", "pin": walker.pin})
    assert locked.status_code == 423  # even the right PIN waits out the lock


def test_cancelling_active_alert_needs_pin(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                      json={"state": "CANCELLED"}).status_code == 403
    assert client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                      json={"state": "CANCELLED", "pin": "0000"}).status_code == 403
    ok = client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                    json={"state": "CANCELLED", "pin": walker.pin})
    assert ok.status_code == 200 and ok.json()["alert"]["state"] == "CANCELLED"


def test_duress_pin_cancel_looks_cancelled_but_stays_open(client, account):
    walker = account()
    alert_id = _alert(client, walker)
    res = client.put(f"/api/v1/alerts/{alert_id}/state", headers=walker.headers,
                     json={"state": "CANCELLED", "pin": walker.duress_pin})
    assert res.status_code == 200 and res.json()["alert"]["state"] == "CANCELLED"
    stored = client.get(f"/api/v1/alerts/{alert_id}", headers=walker.headers).json()["alert"]
    assert stored["state"] == "ESCALATED"


def test_unacknowledged_alert_auto_escalates(client, account):
    from escalation import escalate_overdue_alerts
    walker, guardian = account(), account()
    walker.add_guardian(guardian)
    pending = _alert(client, walker)
    acked = _alert(client, walker)
    client.post(f"/api/v1/alerts/{acked}/ack", headers=guardian.headers)

    # Real window keeps a fresh alert alone; a zero window treats every ACTIVE alert as overdue
    client.portal.call(escalate_overdue_alerts, 60)
    assert client.get(f"/api/v1/alerts/{pending}", headers=walker.headers).json()["alert"]["state"] == "ACTIVE"
    client.portal.call(escalate_overdue_alerts, 0)
    state = lambda a: client.get(f"/api/v1/alerts/{a}", headers=walker.headers).json()["alert"]  # noqa: E731
    assert state(pending)["state"] == "ESCALATED"
    assert state(pending)["events"][-1]["actor"] == "escalation_engine"
    assert state(acked)["state"] == "ACKNOWLEDGED"


# --- Hygiene -------------------------------------------------------------

def test_hazard_listing_requires_auth_and_hides_reporter_pseudonym(client, account):
    assert client.get("/api/v1/hazards").status_code in (401, 403)
    hazards = client.get("/api/v1/hazards", headers=account().headers).json()["hazards"]
    assert hazards and all("user_hash" not in h for h in hazards)


def test_rating_unknown_segment_is_404(client, account):
    res = client.post("/api/v1/ratings", headers=account().headers, json={
        "segment_id": "does-not-exist", "lit": True, "busy": True, "felt_safe": True})
    assert res.status_code == 404


def test_errors_do_not_leak_internals_and_carry_request_id(client):
    res = client.get("/health")
    assert res.status_code == 200 and res.headers.get("X-Request-ID")
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert client.get("/ready").json()["database"] is True


def test_production_refuses_insecure_configuration():
    import os
    import subprocess
    import sys
    api_dir = os.path.join(os.path.dirname(__file__), "..", "api")
    base = {k: v for k, v in os.environ.items() if k not in ("JWT_SECRET", "SHIELD_DEMO_MODE", "BCRYPT_ROUNDS")}
    cases = [
        {"SHIELD_ENV": "production"},                                              # no JWT secret
        {"SHIELD_ENV": "production", "JWT_SECRET": "short"},                       # weak secret
        {"SHIELD_ENV": "production", "JWT_SECRET": "x" * 40, "SHIELD_DEMO_MODE": "true"},
        {"SHIELD_ENV": "production", "JWT_SECRET": "x" * 40, "CORS_ORIGINS": "*"},
    ]
    for extra in cases:
        proc = subprocess.run([sys.executable, "-c", "import settings"], cwd=api_dir,
                              env={**base, **extra}, capture_output=True, text=True)
        assert proc.returncode != 0, extra
    good = {"SHIELD_ENV": "production", "JWT_SECRET": "x" * 40, "CORS_ORIGINS": "https://dashboard.example",
            "SMTP_HOST": "smtp.example", "MAIL_FROM": "noreply@example.com"}
    no_mail = {k: v for k, v in good.items() if k not in ("SMTP_HOST", "MAIL_FROM")}
    assert subprocess.run([sys.executable, "-c", "import settings"], cwd=api_dir, capture_output=True,
                          env={**base, **no_mail}).returncode != 0  # accounts need email verification
    ok = subprocess.run([sys.executable, "-c", "import settings"], cwd=api_dir, capture_output=True, text=True,
                        env={**base, **good})
    assert ok.returncode == 0, ok.stderr


def test_oversized_body_rejected_before_parsing(client, account):
    res = client.post("/api/v1/ratings", headers={**account().headers, "Content-Length": str(50 * 1024 * 1024)},
                      content=b"{}")
    assert res.status_code == 413


def test_api_responses_are_not_cached_or_framed(client):
    res = client.get("/api/v1/me")
    assert res.headers.get("Cache-Control") == "no-store"
    assert "frame-ancestors 'none'" in res.headers.get("Content-Security-Policy", "")


def test_cors_is_not_wildcard(client):
    res = client.options("/health", headers={"Origin": "https://evil.example",
                                             "Access-Control-Request-Method": "GET"})
    assert res.headers.get("access-control-allow-origin") != "*"
    assert res.headers.get("access-control-allow-origin") != "https://evil.example"

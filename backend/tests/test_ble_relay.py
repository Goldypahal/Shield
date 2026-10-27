"""Bluetooth SOS relay: a nearby phone carries an alert the walker could not send.

The walker has no signal, so their phone broadcasts a signed packet over BLE. A
nearby SHIELD phone with connectivity uploads it here on the walker's behalf.
"""
import json
import uuid

import pytest

import notifier
import settings
from ble_relay import E5, RELAY_VERSION, canonical, decode_and_verify, sign, verify

SECRET = settings.BLE_RELAY_SECRET
# The canonical form is a wire contract shared with app/src/services/bleRelayPayload.ts.
# If this test fails, the app and the API disagree and every relayed SOS is refused.
EXPECTED_CANONICAL = "1|3f0e6a1c-1111-4222-8333-444455556666|9d2b7c4e-aaaa-4bbb-8ccc-ddddeeeeffff|SOS_BUTTON|3073330|7677940|HIGH|1760000000000"


@pytest.fixture(autouse=True)
def sent_sms(monkeypatch):
    """No test may reach Twilio; tests that care can read the captured bodies."""
    sent = []

    async def fake_send(to, body):
        sent.append((to, body))
        return True

    monkeypatch.setattr(notifier, "_send_sms", fake_send)
    return sent


def packet(walker_id, *, sig=None, **overrides):
    p = {
        "v": RELAY_VERSION,
        "id": str(uuid.uuid4()),
        "uid": walker_id,
        "tt": "SOS_BUTTON",
        "lat_e5": 3073330,  # 30.7333 degrees, as the walker's phone broadcasts it
        "lon_e5": 7677940,  # 76.7794 degrees
        "pri": "HIGH",
        "ts": 1_760_000_000_000,
    }
    p.update(overrides)
    p["sig"] = sign(p, SECRET) if sig is None else sig
    return p


def relay(client, relayer, payload):
    return client.post("/api/v1/alerts/relay", headers=relayer.headers, json=payload)


def audit_actions(client, admin):
    logs = client.get("/api/v1/dashboard/audit-logs", headers=admin.headers).json()["audit_logs"]
    return [entry.get("action", "") for entry in logs]


# --- the wire contract ------------------------------------------------------------

def test_canonical_form_is_the_shared_contract():
    p = {
        "v": RELAY_VERSION,
        "id": "3f0e6a1c-1111-4222-8333-444455556666",
        "uid": "9d2b7c4e-aaaa-4bbb-8ccc-ddddeeeeffff",
        "tt": "SOS_BUTTON",
        "lat_e5": 3073330,
        "lon_e5": 7677940,
        "pri": "HIGH",
        "ts": 1_760_000_000_000,
    }
    assert canonical(p) == EXPECTED_CANONICAL
    # Integers only: no float ever reaches the signed bytes, so JS and Python cannot
    # disagree about rounding and the signature is stable across both sides.
    assert canonical(p) == canonical({**p, "lat_e5": 3073330, "lon_e5": 7677940})
    assert E5 == 100000


def test_packet_survives_a_round_trip_over_the_radio():
    walker_id = str(uuid.uuid4())
    p = packet(walker_id)
    raw = json.dumps(p).encode("utf-8")
    assert decode_and_verify(raw) == p


def test_garbage_from_the_radio_is_ignored():
    assert decode_and_verify(b"\x00\x01not json") is None
    assert decode_and_verify(b"[]") is None
    unsigned = {k: v for k, v in packet(str(uuid.uuid4())).items() if k != "sig"}
    assert decode_and_verify(json.dumps(unsigned).encode("utf-8")) is None


# --- the endpoint -----------------------------------------------------------------

def test_relayed_alert_belongs_to_the_walker_and_is_audited(client, account):
    walker, relayer, admin = account(), account(), account(role="admin")
    p = packet(walker.user_id)

    res = relay(client, relayer, p)
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "synced"
    # The alert is the walker's, not the phone that carried it
    assert res.json()["alert"]["user_id"] == walker.user_id
    assert res.json()["alert"]["lat"] == pytest.approx(30.7333)
    assert res.json()["alert"]["lon"] == pytest.approx(76.7794)
    assert res.json()["relayed_by"] == relayer.user_id
    # The relaying account is always recorded: this must not be an anonymous channel
    assert any(a.startswith("ALERT_RELAYED_BY_BLUETOOTH") for a in audit_actions(client, admin))


def test_relayed_alert_reaches_the_walkers_guardians(client, account, sent_sms):
    walker, guardian, relayer = account(), account(), account()
    walker.add_guardian(guardian)
    sent_sms.clear()

    assert relay(client, relayer, packet(walker.user_id)).status_code == 201
    assert [to for to, _ in sent_sms] == [guardian.phone]
    assert "SHIELD ALERT" in sent_sms[0][1]


def test_the_same_packet_from_several_phones_notifies_once(client, account, sent_sms):
    """A busy street means several phones may carry the same alert."""
    walker, guardian, phone_a, phone_b = account(), account(), account(), account()
    walker.add_guardian(guardian)
    p = packet(walker.user_id)
    sent_sms.clear()

    first = relay(client, phone_a, p)
    second = relay(client, phone_b, p)

    assert first.status_code == second.status_code == 201
    assert first.json()["status"] == "synced"
    assert second.json()["status"] == "already_synced"
    assert len(sent_sms) == 1, "guardians must not be told twice about one SOS"


def test_tampered_location_is_refused(client, account):
    """A relay must not be able to move someone's SOS somewhere else."""
    walker, relayer = account(), account()
    p = packet(walker.user_id)
    p["lat_e5"], p["lon_e5"] = 1907600, 7287770  # signed over Tricity, rewritten to Mumbai
    assert relay(client, relayer, p).status_code == 403


def test_relay_cannot_change_who_the_alert_is_about(client, account):
    walker, victim, relayer = account(), account(), account()
    p = packet(walker.user_id)
    p["uid"] = victim.user_id  # re-attributed after signing
    assert relay(client, relayer, p).status_code == 403


def test_a_forged_or_wrong_key_signature_is_refused(client, account):
    walker, relayer = account(), account()
    assert relay(client, relayer, packet(walker.user_id, sig="0" * 64)).status_code == 403
    assert relay(client, relayer, packet(walker.user_id, sig=sign(
        packet(walker.user_id), "some-other-key"))).status_code == 403
    assert not verify({**packet(walker.user_id), "sig": "abc"}), "short signatures are not signatures"


def test_a_packet_with_unexpected_fields_is_refused(client, account):
    """The parsed model and the signed field list must not be able to drift apart."""
    walker, relayer = account(), account()
    p = packet(walker.user_id)
    p["trigger"] = "AUDIO"  # looks like a real field, is not in the signed set
    assert relay(client, relayer, p).status_code == 422


def test_signature_of_the_wrong_length_is_a_bad_request(client, account):
    walker, relayer = account(), account()
    assert relay(client, relayer, packet(walker.user_id, sig="ab")).status_code == 422


def test_unknown_walker_is_refused(client, account):
    relayer = account()
    assert relay(client, relayer, packet(str(uuid.uuid4()))).status_code == 404


def test_a_walker_relays_their_own_alert_through_sync_not_relay(client, account):
    walker = account()
    assert relay(client, walker, packet(walker.user_id)).status_code == 409


def test_out_of_range_coordinates_are_refused(client, account):
    walker, relayer = account(), account()
    assert relay(client, relayer, packet(walker.user_id, lat_e5=91 * E5)).status_code == 422
    assert relay(client, relayer, packet(walker.user_id, lon_e5=-181 * E5)).status_code == 422


def test_uppercase_uuid_is_normalised_before_the_signature_is_checked(client, account):
    """The app lowercases ids before signing; the API must normalise the same way."""
    walker, relayer = account(), account()
    p = packet(walker.user_id)
    p["uid"] = walker.user_id.upper()  # same UUID, different case on the wire
    assert walker.user_id == walker.user_id.lower()
    assert relay(client, relayer, p).status_code == 201


def test_relayed_alert_is_visible_to_responders_as_a_normal_alert(client, account):
    """A relayed SOS must not be a second-class alert: responders see it like any other."""
    walker, relayer, responder = account(), account(), account(role="responder")
    p = packet(walker.user_id, tt="AUDIO_DISTRESS")
    assert relay(client, relayer, p).status_code == 201

    active = client.get("/api/v1/dashboard/alerts/active", headers=responder.headers).json()["alerts"]
    mine = [a for a in active if a["walker_phone"] == walker.phone]
    assert len(mine) == 1
    assert mine[0]["trigger_type"] == "AUDIO_DISTRESS"
    assert mine[0]["priority"] == "HIGH"


def test_relay_requires_a_signed_in_shield_account(client):
    """Relaying is a service by a known account, not an open endpoint."""
    res = client.post("/api/v1/alerts/relay", json=packet(str(uuid.uuid4())))
    assert res.status_code in (401, 403)

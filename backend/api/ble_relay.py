"""Signed payloads for the Bluetooth SOS relay (no-network path).

A walker with no connectivity has nothing to send the backend. If another SHIELD
phone is within BLE range and *does* have connectivity, that phone can carry the
alert here on the walker's behalf. The packet travels over an unauthenticated
broadcast, so it is signed and the signature is checked before anything is stored.

Trust model, stated plainly, because it is weaker than the rest of this API:

* The key is shared and ships inside the app bundle, so a valid signature proves the
  packet came from a SHIELD build and not from an arbitrary BLE tool. It does NOT
  prove the packet came from the named walker. Someone who extracts the key from the
  app could raise an alert attributed to another user.
* What limits the damage: the relayed alert points at coordinates the walker's own
  phone broadcast, the relaying account is recorded in the audit log, and the alert
  is marked as relayed so guardians and responders can see it did not arrive directly.
* Replay is not a concern: the alert id is the client-generated UUID, so a replayed
  packet is idempotent and returns "already_synced" without notifying anyone twice.
  That is why there is no timestamp freshness window - a phone with a wrong clock
  must not be the reason an emergency alert is refused.

Before launch this should become a per-install Ed25519 key whose public half is
registered at sign-up, and the location should be encrypted rather than readable by
any device in range; see docs/ROADMAP.md.

Coordinates travel as integers in units of 1e-5 degrees. Floats are deliberately kept
out of the signed bytes: JavaScript's toFixed() rounds ties away from zero while
Python's :.5f rounds ties to even, so a float in the canonical form would make
signatures fail intermittently on values that happen to land on a tie.
"""
import hashlib
import hmac
import json
import uuid
from typing import Any, Dict, Mapping

import settings

#: Bumped when the canonical field list or the serialisation changes.
RELAY_VERSION = 1
SIG_HEX_LENGTH = 64  # HMAC-SHA256
#: Degrees x 1e5, so a full circle is +/-9000000 lat and +/-18000000 lon.
E5 = 100000
MAX_LAT_E5 = 90 * E5
MAX_LON_E5 = 180 * E5


def canonical(payload: Mapping[str, Any]) -> str:
    """The exact bytes that get signed. Field order is part of the contract.

    Mirrored by app/src/services/bleRelayPayload.ts; a test pins the string so the
    two sides cannot drift apart silently.
    """
    return "|".join([
        str(payload["v"]),
        str(payload["id"]),
        str(payload["uid"]),
        str(payload["tt"]),
        str(payload["lat_e5"]),
        str(payload["lon_e5"]),
        str(payload["pri"]),
        str(payload["ts"]),
    ])


def sign(payload: Mapping[str, Any], secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), canonical(payload).encode("utf-8"), hashlib.sha256).hexdigest()


def verify(payload: Mapping[str, Any]) -> bool:
    """True only for a well-formed packet carrying a signature we can reproduce."""
    supplied = str(payload.get("sig") or "").lower()
    if len(supplied) != SIG_HEX_LENGTH:
        return False
    try:
        expect = sign(payload, settings.BLE_RELAY_SECRET)
    except (KeyError, TypeError, ValueError):
        return False  # a malformed packet is not a valid packet
    return hmac.compare_digest(expect, supplied)


def is_usable(payload: Mapping[str, Any]) -> bool:
    """Same shape checks the Pydantic model makes, for packets read from the radio."""
    try:
        uuid.UUID(str(payload["id"]))
        uuid.UUID(str(payload["uid"]))
        if not -MAX_LAT_E5 <= int(payload["lat_e5"]) <= MAX_LAT_E5:
            return False
        if not -MAX_LON_E5 <= int(payload["lon_e5"]) <= MAX_LON_E5:
            return False
    except (KeyError, ValueError, TypeError, AttributeError):
        return False
    return int(payload.get("v", 0)) == RELAY_VERSION


def decode_and_verify(raw: bytes) -> Dict[str, Any] | None:
    """Turns bytes read off a GATT characteristic into a trusted payload, or None.

    The HTTP endpoint receives JSON and validates it with Pydantic instead; this is
    the radio-side equivalent, used by the relay scanner and by tests.
    """
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict) or not is_usable(payload) or not verify(payload):
        return None
    return payload

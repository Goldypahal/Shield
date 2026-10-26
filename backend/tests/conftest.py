"""Shared test setup: an isolated database and evidence folder per run, and helpers
that create real accounts through the API (tokens for non-existent users are rejected)."""
import os
import sys
import tempfile
import itertools

_tmp = tempfile.mkdtemp(prefix="shield-tests-")
os.environ["SHIELD_SKIP_DOTENV"] = "1"  # tests must not depend on a developer's backend/.env
os.environ["SHIELD_ENV"] = "test"
os.environ["SHIELD_DEMO_MODE"] = "true"
os.environ["SHIELD_ESCALATION_LOOP"] = "false"  # tests drive escalation sweeps explicitly
os.environ["BCRYPT_ROUNDS"] = "4"  # minimum cost keeps the suite fast; production enforces >= 12
os.environ["SHIELD_DB_PATH"] = os.path.join(_tmp, "shield-test.db")
os.environ["SHIELD_EVIDENCE_DIR"] = os.path.join(_tmp, "evidence")
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"  # nothing listens there: forces the in-process broker

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(backend_dir, "api"))
sys.path.insert(0, backend_dir)

import pytest
from fastapi.testclient import TestClient

from main import app
from rate_limiter import limiter
from db.storage import storage

limiter.enabled = False  # rate limits are per-IP and every test request comes from one address

_phones = itertools.count(1)
PASSWORD = "correct horse battery staple"


def new_phone() -> str:
    return f"+9190{os.getpid() % 1000:03d}{next(_phones):05d}"


def new_email() -> str:
    return f"walker{os.getpid()}.{next(_phones)}@example.com"


def register(client, email, phone, pin="1234", duress_pin="9999", name="Test Walker", password=PASSWORD,
             police_sharing=True):
    """Full sign-up through the API: codes for email and phone, then the account with password and PINs."""
    codes = client.post("/api/v1/auth/register/start", json={"email": email, "phone_number": phone})
    assert codes.status_code == 200, codes.text
    body = codes.json()
    return client.post("/api/v1/auth/register/complete", json={
        "email": email, "email_code": body["demo_email_code"], "phone_number": phone,
        "phone_code": body["demo_phone_code"], "password": password, "name": name,
        "pin": pin, "duress_pin": duress_pin, "police_sharing": police_sharing})


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # runs the lifespan, so the database is initialised
        yield c


class Account:
    def __init__(self, client, pin="1234", duress_pin="9999", name="Test Walker", role=None,
                 station_id=None, police_sharing=True):
        self.client = client
        self.phone = new_phone()
        self.email = new_email()
        self.password = PASSWORD
        self.pin = pin
        self.duress_pin = duress_pin
        res = register(client, self.email, self.phone, pin, duress_pin, name, police_sharing=police_sharing)
        assert res.status_code == 201, res.text
        self.user_id = res.json()["user_id"]
        self.refresh_token = res.json()["refresh_token"]
        self.totp_secret = None
        if role:
            from security import new_totp_secret
            self.totp_secret = new_totp_secret()
            client.portal.call(storage.set_user_role, self.user_id, role)
            client.portal.call(lambda: storage.update_user_fields(self.user_id, totp_secret=self.totp_secret,
                                                                  station_id=station_id))
        self.token = self._login()

    def totp(self, offset_steps=0):
        import time
        from security import TOTP_STEP, totp_code
        return totp_code(self.totp_secret, int(time.time() // TOTP_STEP) + offset_steps)

    def _login(self):
        body = {"email": self.email, "password": self.password}
        if self.totp_secret:
            body["totp_code"] = self.totp()
        res = self.client.post("/api/v1/auth/login", json=body)
        assert res.status_code == 200, res.text
        return res.json()["access_token"]

    @property
    def headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def add_guardian(self, other: "Account", verify=True) -> str:
        res = self.client.post("/api/v1/guardians", headers=self.headers,
                               json={"name": "Guardian", "phone_number": other.phone})
        assert res.status_code == 201, res.text
        gid = res.json()["guardian"]["id"]
        if verify:
            assert self.client.post(f"/api/v1/guardians/{gid}/verify", headers=other.headers).status_code == 200
        return gid


@pytest.fixture
def account(client):
    return lambda **kw: Account(client, **kw)

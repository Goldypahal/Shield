"""Email and SMS delivery paths, against fakes (real delivery: manage.py test-email / test-sms)."""
import pytest

import mailer
import notifier
import settings


class FakeSMTP:
    sent = []

    def __init__(self, host, port, timeout):
        self.host, self.port, self.tls, self.auth = host, port, False, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context):
        self.tls = True

    def login(self, user, password):
        self.auth = user

    def send_message(self, msg):
        assert self.tls, "must upgrade to TLS before sending"
        FakeSMTP.sent.append({"to": msg["To"], "subject": msg["Subject"], "body": msg.get_content(), "auth": self.auth})


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.sent = []
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setattr(settings, "SMTP_USERNAME", "shield.sender@gmail.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "app-password")
    monkeypatch.setattr(settings, "MAIL_FROM", "shield.sender@gmail.com")
    return FakeSMTP.sent


def test_signup_code_is_emailed_over_tls_when_not_in_demo_mode(client, smtp, monkeypatch):
    from conftest import new_email, new_phone
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    sms = []

    async def fake_otp(phone, code):
        sms.append((phone, code))
        return True
    import auth
    monkeypatch.setattr(auth, "send_otp_sms", fake_otp)
    email = new_email()
    res = client.post("/api/v1/auth/register/start", json={"email": email, "phone_number": new_phone()})
    assert res.status_code == 200 and "demo_email_code" not in res.json() and "demo_phone_code" not in res.json()
    assert len(smtp) == 1 and smtp[0]["to"] == email and smtp[0]["auth"] == "shield.sender@gmail.com"
    code = smtp[0]["subject"].split()[-1]
    assert code.isdigit() and len(code) == 6 and code in smtp[0]["body"]
    assert len(sms) == 1 and len(sms[0][1]) == 6


def test_sms_goes_through_twilio_client(monkeypatch):
    import asyncio
    calls = []

    class FakeMessages:
        def create(self, body, from_, to):
            calls.append((to, from_, body))

    class FakeClient:
        messages = FakeMessages()

    monkeypatch.setattr(notifier, "_client", FakeClient())
    assert asyncio.run(notifier._send_sms("+919811122233", "hello")) is True
    assert calls == [("+919811122233", settings.TWILIO_FROM_NUMBER, "hello")]

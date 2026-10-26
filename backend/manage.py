"""Operator commands.

    python manage.py create-staff --email control@police.example --phone +919876543210 --name "Control Room" --role responder [--station <id>]
    python manage.py set-role --email control@police.example --role admin
    python manage.py reset-totp --email control@police.example
    python manage.py add-station --name "PS Sector 17" --lat 30.7398 --lon 76.7827 --phone +911722700000
    python manage.py import-stations-osm          # police posts from routing/data/safe_havens.json
    python manage.py list-stations
    python manage.py test-sms --to +919876543210  # real SMS through Twilio (backend/.env)
    python manage.py test-email --to you@gmail.com

Roles are never granted through the public API; only someone with shell
access to the server can create responders and admins. Staff sign in to the
dashboard with email + password + a code from an authenticator app; the
password is prompted, never passed on the command line, so it stays out of
shell history.
"""
import argparse
import asyncio
import getpass
import json
import os
import re
import secrets
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))
sys.path.insert(0, os.path.dirname(__file__))

from db.storage import storage  # noqa: E402
from security import ROLES, get_password_hash, hash_account_password, new_totp_secret, totp_uri  # noqa: E402

PHONE = re.compile(r"^\+[1-9]\d{7,14}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")


def print_totp(email: str, secret: str) -> None:
    print("\nTwo-factor sign-in: add this account to an authenticator app (Google Authenticator, Microsoft Authenticator, ...).")
    print(f"  Setup key: {secret}")
    print(f"  Or open/scan this link: {totp_uri(secret, email)}")
    print("Shown once. Keep it private; run reset-totp to issue a new one.\n")


async def resolve_station(value: str | None) -> str | None:
    if not value:
        return None
    stations = await storage.list_stations()
    match = [s for s in stations if s["id"] == value] or [s for s in stations if s["name"].lower() == value.lower()]
    if len(match) != 1:
        sys.exit(f"No single station matches {value!r}; run list-stations.")
    return match[0]["id"]


async def create_staff(email: str, phone: str, name: str, role: str, password: str, station: str | None) -> None:
    await storage.init_db()
    if await storage.get_user_by_email(email) or await storage.get_user_by_phone(phone):
        sys.exit(f"{email} or {phone} already has an account; use set-role instead.")
    station_id = await resolve_station(station)
    # Staff never stop SOS alerts from the app, so their SOS PIN is random and unknown
    user = await storage.create_user(
        phone_number=phone, name=name, hashed_pin=get_password_hash(f"{secrets.randbelow(10**6):06d}"),
        email=email, password_hash=hash_account_password(password), verified=True,
    )
    await storage.set_user_role(user["id"], role)
    secret = new_totp_secret()
    await storage.update_user_fields(user["id"], totp_secret=secret, station_id=station_id)
    await storage.log_audit(actor="cli", action=f"CREATE_STAFF {role}", target=f"user/{user['id']}")
    print(f"Created {role} {name} <{email}> id={user['id']} station={station_id or 'control room'}")
    print_totp(email, secret)


async def set_role(email: str, role: str) -> None:
    await storage.init_db()
    user = await storage.get_user_by_email(email)
    if not user:
        sys.exit(f"No account for {email}.")
    await storage.set_user_role(user["id"], role)
    await storage.revoke_all_sessions(user["id"])  # new role applies from the next sign-in
    await storage.log_audit(actor="cli", action=f"SET_ROLE {role}", target=f"user/{user['id']}")
    print(f"{email} is now {role}")
    if role != "walker" and not user.get("totp_secret"):
        print("This account has no two-factor key yet; run reset-totp so it can sign in to the dashboard.")


async def reset_totp(email: str) -> None:
    await storage.init_db()
    user = await storage.get_user_by_email(email)
    if not user:
        sys.exit(f"No account for {email}.")
    secret = new_totp_secret()
    await storage.update_user_fields(user["id"], totp_secret=secret, totp_last_step=0)
    await storage.revoke_all_sessions(user["id"])
    await storage.log_audit(actor="cli", action="RESET_TOTP", target=f"user/{user['id']}")
    print_totp(email, secret)


async def set_station(email: str, station: str | None) -> None:
    await storage.init_db()
    user = await storage.get_user_by_email(email)
    if not user:
        sys.exit(f"No account for {email}.")
    station_id = await resolve_station(station)
    await storage.update_user_fields(user["id"], station_id=station_id)
    await storage.revoke_all_sessions(user["id"])
    print(f"{email} now works at {station_id or 'the control room'}")


async def add_station(name: str, lat: float, lon: float, phone: str | None, district: str | None) -> None:
    await storage.init_db()
    st = await storage.add_station(name, lat, lon, phone, district)
    print(f"Added station {st['name']} id={st['id']}")


async def import_stations_osm() -> None:
    await storage.init_db()
    path = os.path.join(os.path.dirname(__file__), "routing", "data", "safe_havens.json")
    places = [p for p in json.load(open(path, encoding="utf-8"))["places"] if p["kind"] == "police"]
    for i, p in enumerate(places):
        # Stable ids, so re-importing updates instead of duplicating
        await storage.add_station(p["name"] or f"Police post {i + 1}", p["lat"], p["lon"], p.get("phone"),
                                  "Tricity (OSM)", station_id=f"osm-{p['lat']:.5f}-{p['lon']:.5f}")
    print(f"Imported {len(places)} police posts from OpenStreetMap. Check names and phones with list-stations.")


async def list_stations() -> None:
    await storage.init_db()
    for s in await storage.list_stations():
        print(f"{s['id']:<32} {s['name'][:40]:<40} {s['lat']:.5f},{s['lon']:.5f} {s.get('phone') or '-'}")


async def test_sms(to: str) -> None:
    import settings
    from notifier import _send_sms
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_FROM_NUMBER):
        sys.exit("Twilio is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER in backend/.env")
    ok = await _send_sms(to, "SHIELD test message: SMS delivery works. You can ignore this.")
    print("Sent. Check the phone." if ok else "Twilio rejected the message; see the error above. "
          "Trial accounts can only text numbers verified in the Twilio console.")


async def test_email(to: str) -> None:
    import settings
    from mailer import send_email
    if not settings.SMTP_HOST:
        sys.exit("SMTP is not configured: set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD and MAIL_FROM in backend/.env")
    ok = await send_email(to, "SHIELD test email", "Email delivery works. You can ignore this message.")
    print("Sent. Check the inbox (and spam)." if ok else "Sending failed; see the error above.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="manage.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-staff", help="create a responder or admin account")
    c.add_argument("--email", required=True)
    c.add_argument("--phone", required=True)
    c.add_argument("--name", required=True)
    c.add_argument("--role", choices=[r for r in ROLES if r != "walker"], default="responder")
    c.add_argument("--station", help="station id or exact name; omit for the control room")
    s = sub.add_parser("set-role", help="change an existing account's role")
    s.add_argument("--email", required=True)
    s.add_argument("--role", choices=ROLES, required=True)
    t = sub.add_parser("reset-totp", help="issue a new two-factor key for a staff account")
    t.add_argument("--email", required=True)
    ss = sub.add_parser("set-station", help="move a staff account to a station (omit --station for control room)")
    ss.add_argument("--email", required=True)
    ss.add_argument("--station")
    a = sub.add_parser("add-station", help="add a police station")
    a.add_argument("--name", required=True)
    a.add_argument("--lat", type=float, required=True)
    a.add_argument("--lon", type=float, required=True)
    a.add_argument("--phone")
    a.add_argument("--district")
    sub.add_parser("import-stations-osm", help="import police posts from OpenStreetMap data")
    sub.add_parser("list-stations", help="list police stations")
    ts = sub.add_parser("test-sms", help="send a real test SMS through Twilio")
    ts.add_argument("--to", required=True)
    te = sub.add_parser("test-email", help="send a real test email through SMTP")
    te.add_argument("--to", required=True)
    args = parser.parse_args()

    if args.cmd == "add-station":
        asyncio.run(add_station(args.name, args.lat, args.lon, args.phone, args.district))
        return
    if args.cmd == "import-stations-osm":
        asyncio.run(import_stations_osm())
        return
    if args.cmd == "list-stations":
        asyncio.run(list_stations())
        return
    if args.cmd == "test-sms":
        if not PHONE.match(args.to):
            sys.exit("Phone must be E.164, e.g. +919876543210")
        asyncio.run(test_sms(args.to))
        return

    email = args.to if args.cmd == "test-email" else args.email
    email = email.strip().lower()
    if not EMAIL.match(email):
        sys.exit("Enter a valid email address.")
    if args.cmd == "test-email":
        asyncio.run(test_email(email))
    elif args.cmd == "create-staff":
        if not PHONE.match(args.phone):
            sys.exit("Phone must be E.164, e.g. +919876543210")
        password = getpass.getpass("Password (at least 12 characters): ")
        if len(password) < 12 or password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords must match and be at least 12 characters.")
        asyncio.run(create_staff(email, args.phone, args.name, args.role, password, args.station))
    elif args.cmd == "reset-totp":
        asyncio.run(reset_totp(email))
    elif args.cmd == "set-station":
        asyncio.run(set_station(email, args.station))
    else:
        asyncio.run(set_role(email, args.role))


if __name__ == "__main__":
    main()

"""Operator commands.

    python manage.py create-staff --email control@police.example --phone +919876543210 --name "Control Room" --role responder
    python manage.py set-role --email control@police.example --role admin

Roles are never granted through the public API; only someone with shell
access to the server can create responders and admins. Staff sign in to the
dashboard with email + password; the password is prompted, never passed on the
command line, so it stays out of shell history.
"""
import argparse
import asyncio
import getpass
import os
import re
import secrets
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))
sys.path.insert(0, os.path.dirname(__file__))

from db.storage import storage  # noqa: E402
from security import ROLES, get_password_hash, hash_account_password  # noqa: E402

PHONE = re.compile(r"^\+[1-9]\d{7,14}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")


async def create_staff(email: str, phone: str, name: str, role: str, password: str) -> None:
    await storage.init_db()
    if await storage.get_user_by_email(email) or await storage.get_user_by_phone(phone):
        sys.exit(f"{email} or {phone} already has an account; use set-role instead.")
    # Staff never stop SOS alerts from the app, so their SOS PIN is random and unknown
    user = await storage.create_user(
        phone_number=phone, name=name, hashed_pin=get_password_hash(f"{secrets.randbelow(10**6):06d}"),
        email=email, password_hash=hash_account_password(password), verified=True,
    )
    await storage.set_user_role(user["id"], role)
    await storage.log_audit(actor="cli", action=f"CREATE_STAFF {role}", target=f"user/{user['id']}")
    print(f"Created {role} {name} <{email}> id={user['id']}")


async def set_role(email: str, role: str) -> None:
    await storage.init_db()
    user = await storage.get_user_by_email(email)
    if not user:
        sys.exit(f"No account for {email}.")
    await storage.set_user_role(user["id"], role)
    await storage.revoke_all_sessions(user["id"])  # new role applies from the next sign-in
    await storage.log_audit(actor="cli", action=f"SET_ROLE {role}", target=f"user/{user['id']}")
    print(f"{email} is now {role}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="manage.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-staff", help="create a responder or admin account")
    c.add_argument("--email", required=True)
    c.add_argument("--phone", required=True)
    c.add_argument("--name", required=True)
    c.add_argument("--role", choices=[r for r in ROLES if r != "walker"], default="responder")
    s = sub.add_parser("set-role", help="change an existing account's role")
    s.add_argument("--email", required=True)
    s.add_argument("--role", choices=ROLES, required=True)
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not EMAIL.match(email):
        sys.exit("Enter a valid email address.")
    if args.cmd == "create-staff":
        if not PHONE.match(args.phone):
            sys.exit("Phone must be E.164, e.g. +919876543210")
        password = getpass.getpass("Password (at least 12 characters): ")
        if len(password) < 12 or password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords must match and be at least 12 characters.")
        asyncio.run(create_staff(email, args.phone, args.name, args.role, password))
    else:
        asyncio.run(set_role(email, args.role))


if __name__ == "__main__":
    main()

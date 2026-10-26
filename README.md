# SHIELD (Heimdal) — personal safety platform

SHIELD helps people walk home safely: plan a route that weighs lighting and
activity, share the walk live with chosen guardians, and raise an SOS (button,
voice keyword, sensors, or a silent **duress PIN**) that reaches guardians and
responders even with poor connectivity.

> SHIELD is an assistive tool. It does not replace emergency services (112).

## Components

| Path | What it is | Stack |
|---|---|---|
| `app/` | Mobile app for walkers and guardians | Expo SDK 54, React Native 0.81, TypeScript |
| `backend/api/` | Core API: auth, walks, alerts, evidence, dashboard, reports | FastAPI, SQLite (aiosqlite), Redis optional |
| `backend/routing/` | Safe-route engine for Chandigarh–Mohali–Panchkula (fastest / safest / balanced) | Python, NetworkX, OSM adapter |
| `backend/ml/` | Scream-detection model, distress classifier, evaluation report | PyTorch / scikit-learn |
| `dashboard/` | Authority command console (live dispatch, heatmap, gaps, audit) | Static HTML + Leaflet, served at `/dashboard/` |
| `functions/` | Firebase fallback alert channel (SMS + call) | Cloud Functions, Twilio |
| `docs/` | SRS v1.0, engineering review, roadmap | |

```
 app ──HTTPS──▶ FastAPI ──▶ SQLite (walks, alerts, evidence metadata, audit)
  │  ◀──WSS───  │  ├──▶ Twilio SMS (guardian alerts, OTP)
  │             │  ├──▶ safe-route engine (in process)
  │             │  └──▶ escalation sweeper (ALERT-8, every 15 s)
  └─▶ Firebase function (fallback only when the API is unreachable)
 dashboard ──HTTPS──▶ same API, responder/admin accounts only
```

## Quick start (Windows, from `C:\Heimdal`)

```powershell
# API
cd SHIELD\backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env            # defaults are fine for local development
cd ..\..
npm run api                       # http://localhost:8000  (docs at /docs)

# Create a responder for the dashboard (prompts for a password)
cd SHIELD\backend
.venv\Scripts\python manage.py create-staff --email control@police.example --phone +919876543210 --name "Control Room" --role responder
# then open http://localhost:8000/dashboard/   (or /dashboard/?demo=1 for labelled sample data)

# App
cd SHIELD\app
copy .env.example .env            # set EXPO_PUBLIC_BACKEND_URL to your PC's LAN IP for a phone
npm install
npm start
```

Docker: `cd SHIELD/backend && cp .env.example .env && docker compose up --build`.

## Tests

```powershell
npm run test:api        # 65 API tests: SRS acceptance criteria, security regressions, features
npm run test:routing    # 54 routing-engine tests
npm run typecheck       # app TypeScript
```

CI (`.github/workflows/ci.yml`) runs all of these plus a Docker build on every push.

## Security model (summary)

* **Accounts**: email + password (at least 10 characters, common passwords
  refused). Sign-up proves the email (6-digit code by email; Gmail works via
  SMTP, see `backend/.env.example`) and the phone (SMS code). Codes are random,
  single use, hashed and burn after 5 wrong tries. Five wrong passwords lock the
  account for 15 minutes; errors never say whether an email is registered.
* **SOS PIN**: set at sign-up. Once an SOS starts (including the countdown),
  only this PIN stops it; check-in timers and trips also need it to confirm
  "I'm safe". Three wrong PINs escalate the alert to guardians; five lock the PIN
  for 15 minutes. Changing the PINs needs an emailed code plus the password.
* **Duress PIN**: wherever the SOS PIN is accepted, the duress PIN gives the same
  answer on the phone and on the network, while the server silently opens or
  keeps a HIGH alert and messages guardians.
* **Tokens**: PyJWT, 15-minute access + 30-day refresh tokens. Refresh tokens are
  stored server-side and single use; replaying one revokes every session.
  Sign out / sign out of all devices / password change revoke sessions at once.
  On the phone, tokens and PIN hashes live in the OS keystore (expo-secure-store).
* **Authorization**: walkers see their own data; guardians see a walker's
  alerts/walks only after accepting the invitation from the invited phone
  number; the dashboard requires the `responder` or `admin` role (granted only
  via `manage.py`). Unauthorized lookups return 404.
* **Live location**: WebSockets use one-time 60 s tickets issued only for
  channels the caller may follow; only the walker can publish.
* **Evidence**: ciphertext only, ordered SHA-256 hash chain enforced, write-once files.
* **Production guardrails**: the API refuses to start in `SHIELD_ENV=production`
  without a strong `JWT_SECRET`, with demo mode on, with `CORS_ORIGINS=*`, with
  weak bcrypt cost, or without SMTP for email verification.
* **Guardian links**: SMS tracking links (`/track/<token>`) are random, hashed,
  read-only and expire after 24 h; location stops showing once the alert closes.

Security testing (bandit, pip-audit, npm audit, OWASP ZAP) and what was fixed:
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).

Full findings and their status: [`docs/ENGINEERING_REVIEW.md`](docs/ENGINEERING_REVIEW.md).
What comes next: [`docs/ROADMAP.md`](docs/ROADMAP.md).

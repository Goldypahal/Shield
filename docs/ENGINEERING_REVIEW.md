# Engineering review — October 2026

Scope: `app/`, `backend/` (API, storage, routing), `dashboard/`, `functions/`,
`firestore.rules`. Baseline: 13 API tests passing, app type-check clean, but
the passing tests encoded several of the defects below.

Severity: **Critical** = exploitable remotely or an SOS fails silently;
**High** = wrong safety outcome or data exposure; **Medium** = robustness,
operability.

## Fixed in this pass

### Critical

| # | Finding | Fix |
|---|---|---|
| C1 | OTP was always `123456` and `/otp/verify` accepted it for any number, then **reset that account's PINs**: full account takeover of any user. | Random 6-digit codes, stored hashed, single use, 5-attempt burn, 5-minute expiry. Demo codes only in demo mode. |
| C2 | No object-level authorization: any logged-in user could read any walk/trail, push points into it, end it, read/escalate/cancel any alert, read evidence, export incident PDFs. `/ack` and `/escalate` needed no login at all. | `access.py` central policy (owner / verified guardian / staff), 404 on denial, enforced in every router. |
| C3 | Any user could get a WebSocket ticket for any walk id and watch a stranger's live location; any subscriber could inject fake location frames. | Tickets only for permitted channels; only the walker's socket publishes. Legacy JWT-in-URL path removed. |
| C4 | Authority dashboard API open to every walker account; the audit actor came from the request body (spoofable). | `responder`/`admin` roles, granted only by `manage.py`; actor taken from the token; audit log admin-only. |
| C5 | Evidence upload wrote `{alert_id}_chunk_{seq}.enc` from raw input: path traversal to write files anywhere the process could. Re-uploads silently overwrote evidence. | Alert ownership check, canonical id from the DB, write-once files, enforced seq order and `prev_sha256` chain, size cap. |
| C6 | Hardcoded default JWT secret; refresh tokens (30 days) accepted as access tokens; tokens of deleted users kept working. | `settings.py` with production guardrails; token `type` enforced; user re-read on every request. |
| C7 | The app never signed in (hardcoded "Alex" profile), so every API call carried `Bearer null`; and its SOS payload used field names the API rejects. **No SOS from the app ever reached the backend.** | Session bootstrap, refresh-on-401 client, payload aligned (`trigger_type`; legacy `type` accepted). |
| C8 | Firebase function `sendEmergencyAlerts` was an unauthenticated SMS + voice-call relay to caller-supplied numbers (toll fraud, harassment); Firestore let any user rewrite any incident. | Auth required, incident ownership, ≤5 E.164 numbers, 1/min per user, TwiML no longer interpolates user input; ownership rules. |

### High

| # | Finding | Fix |
|---|---|---|
| H1 | GPS failure in the SOS path either aborted the SOS (HomeScreen showed "Alert Queued" anyway) or sent **hardcoded Delhi coordinates** (EmergencySOS). | Persist-first SOS; fresh → last-known → explicit "location unavailable". Never fabricated. |
| H2 | Offline queue used `react-native-sqlite-storage` and a non-existent `DirectSms` native module: crashes in this Expo app. | AsyncStorage queue, idempotent replay on reconnect, SMS-composer fallback. |
| H3 | Guardians were never notified: alert sync stored the alert and stopped. Contacts never reached the server (wrong field name and URL). | `notifier.py` (Twilio, or logged when unconfigured) on new ACTIVE alerts, duress, missed check-ins; contacts endpoint accepts the app's payload. |
| H4 | Escalation (ALERT-8) only happened if someone called the endpoint. | Server-side sweeper escalates ACTIVE alerts unacknowledged after 60 s and re-notifies. |
| H5 | Duress login returned `duress_mode_active: true`, revealing it to anyone watching; duress alert had location 0,0. Duress cancel was client-side only. | Identical responses; optional location on login; server-side duress handling on cancel keeps the alert open and escalates. |
| H6 | Cancelling an SOS in the app never told the server: the alert stayed ACTIVE forever, live location kept streaming. | PIN-checked server cancel; streaming stops when the server reports the alert closed. |
| H7 | Dashboard always failed auth (`demo_token`) and then showed **invented incidents with realistic names** as "Live Simulation"; user names rendered as raw HTML (stored XSS into the police console). | Staff login, escaped output, no inline handlers with data; sample data only at `?demo=1` behind a banner. |
| H8 | App "nearby issues" fell back to invented crime reports placed next to the user. | Real `/hazards` data; empty list on failure. |
| H9 | Scream API answered `non_scream, p=0.04` when no model was loaded. | 503 so the client relies on on-device detection. |
| H10 | Missed check-in (WALK-6) only logged a warning. | Opens a CHECKIN_TIMEOUT alert and notifies guardians. |
| H11 | Alert state machine unenforced (resolved alerts could be re-escalated, any state from anyone). | `alert_states.py` transition table; 409 on invalid moves; PIN to stand down an ACTIVE alert. |

### Medium

* `CORS *` with credentials → explicit origin list; security headers, request IDs, generic 500s, `/ready` probe.
* SQLite foreign keys were off (cascades never ran) → enabled on every connection; account deletion now also removes evidence files, tickets and live points.
* PostGIS-only routers (`community`, `risk`, `media`) crashed with `AttributeError` on every call and pulled in `asyncpg`, which Windows Smart App Control blocks → unmounted until the PostGIS deployment exists.
* `/routes/tricity/landmarks` always 500'd (dict API on a list) → fixed.
* Dashboard static mount pointed at a non-existent folder → served at `/dashboard/`.
* OSM adapter never read `lit`/`sidewalk` tags (OSMnx whitelist) → fixed in both routing copies, with a regression test.
* `requirements.txt` missing `aiosqlite`, `bcrypt`, `reportlab` → fixed and bounded; Dockerfile, compose, `.env.example`, CI added.
* Per-account login lockout; PIN re-confirmation for PIN change and account deletion; input validation (E.164, PIN format, coordinate ranges, payload sizes) on all write endpoints.
* Debug screen-switcher bar hidden outside `__DEV__`; hardcoded `localhost` backend URL now `EXPO_PUBLIC_BACKEND_URL`; `lucide@latest` pinned.

## Verified

* `backend/tests`: 43 passing (13 acceptance criteria rewritten to use real accounts, 30 security regressions).
* `backend/routing/tests`: 54 passing. App `tsc --noEmit`: clean. `dashboard.js`: parses.
* Live smoke test on uvicorn: walker SOS + live point visible to a CLI-created responder; walker gets 403 on the dashboard; dashboard page served.

## Not verified

* The app was type-checked, not run on a device or simulator.
* `functions/` has no `package.json` in the repo, so the Cloud Function was not compiled.
* The dashboard was not opened in a browser.
* Docker image build was not run locally (no Docker on this machine); CI builds it.

## Known open issues

Tracked with priorities in [`ROADMAP.md`](ROADMAP.md). The most important:
there is no production sign-up/login screen in the app yet (development builds
use a demo account), and tokens and the local PIN live in unencrypted
AsyncStorage.

# Security audit: October 2026

Scope: `backend/api` (FastAPI), `backend/db`, `app/` (Expo), `dashboard/`.
Method: manual review against the OWASP API Security Top 10 (2023) and the OWASP
Mobile Top 10, static analysis (bandit), dependency audits (pip-audit, npm audit),
an authenticated dynamic scan with OWASP ZAP (`zap-api-scan.py` against the OpenAPI
spec), and regression tests for every fix (`backend/tests/test_security.py`,
`test_features.py`).

## Results at a glance

| Check | Result |
|---|---|
| OWASP ZAP API scan (authenticated) | 0 failures, 119 checks passed, 0 server errors (500s) in ~14,000 requests; 1 low warning: the check-in deadline is a Unix timestamp (intended; the app shows the countdown). An earlier run's 2 warnings (missing CORP header, timestamp in `/health`) were fixed. |
| bandit (Python SAST) | 3 low-severity findings, all false positives (see below) |
| pip-audit | 2 vulnerable packages found (python-jose, ecdsa); both removed |
| npm audit (app) | 33 issues → 11 after non-breaking fixes; the rest are in build tooling and Firebase (see below) |
| API tests | 65 passing (43 before), 22 of them security regressions |

## Findings and fixes

Severity: **H** high, **M** medium, **L** low.

| # | OWASP | Sev | Finding | Fix |
|---|---|---|---|---|
| 1 | API1/API5 business logic | H | An active SOS could be closed as `FALSE_ALARM`, and a `PRE_ALERT` cancelled, **without the PIN**. | Every stand-down (cancel, resolve, false alarm) from any open state needs the SOS PIN (`alerts_router.py`). |
| 2 | API2 / API4 | H | No limit on wrong PINs when cancelling: a 4-digit PIN could be brute-forced (10,000 tries, 20/min). | Per-account PIN counter (`pins.py`): 3 wrong PINs escalate the alert to guardians, 5 lock the PIN for 15 min (423). |
| 3 | API2 broken authentication | H | Accounts (including police/responder dashboard accounts) signed in with phone + a 4-6 digit PIN. | Email + password accounts: email and phone verified by one-time codes, password policy (length + blocklist), bcrypt over SHA-256 pre-hash (no 72-byte truncation), 5-strike lockout, identical errors and timing for unknown emails, no account enumeration at sign-up or reset. |
| 4 | A06 vulnerable components | H | `python-jose` 3.5.0: CVE-2026-85394 (HMAC key confusion, no fix) and unmaintained; pulls `ecdsa` (CVE-2024-23342). | Replaced by PyJWT; tokens also require `iss`, `iat`, `exp`, `sub`, and the algorithm is pinned. |
| 5 | API2 | M | Refresh tokens could not be revoked (lost phone, stolen token). | Refresh tokens stored server-side by id, single use with rotation; replaying a used one revokes every session. Sign out, sign out everywhere, password change and reset revoke sessions; access tokens carry a session version checked on every request. |
| 6 | API1 BOLA | M | Guardian access is keyed on phone number, but phone ownership was not required for every account (demo sign-up). | Phone proven by SMS code at sign-up; guardian access and invitation acceptance require a verified phone. |
| 7 | M9 insecure storage | M | App kept tokens in AsyncStorage and the SOS PIN in **plaintext** (`@shield_pin`). | Tokens and salted PIN hashes in the OS keystore (`expo-secure-store`); plaintext writes removed. |
| 8 | API3 data exposure | L | Phone number inside every JWT. | Removed from token claims. |
| 9 | API1 | M | `GET /api/v1/hazards` was public. | Requires authentication. |
| 10 | Privacy | L | Rating/hazard pseudonyms were `sha256("salt_" + user_id)`: anyone with an id could link reports. | Keyed HMAC with a server secret. |
| 11 | API4 resource consumption | M | Unbounded string fields (audio clip, rating note, dashboard notes); no request size limit. | Max lengths on every field; bodies over 8 MB rejected with 413 before parsing. |
| 12 | API8 misconfiguration | L | Missing `Cache-Control`, CSP, CORP, COOP, Permissions-Policy headers (ZAP warning); server timestamp in `/health` (ZAP warning); exception text returned by `/ml/audio/model_info`. | Headers added to all responses (strict CSP + `no-store` on the API); timestamp and error text removed. |
| 13 | Business logic | M | During a walk, "I'm safe" and ending the trip needed no PIN, so someone holding the phone could stop guardians' live view. | Both need the SOS PIN (duress PIN silently alerts); ending at the destination needs no PIN. |
| 14 | Data exposure | L | Guardian SMS contained the raw alert id and a link to a page that did not exist. | Random 192-bit, hashed, 24 h, read-only tracking links; location hidden once the alert closes; strict CSP, `no-referrer`, SRI on Leaflet. |
| 15 | XSS (new code) | - | Map tooltips show OpenStreetMap names and user reports. | Escaped before insertion (the map iframe is same-origin). |
| 16 | Supply chain | M | The app imported packages it never declared (`@expo/vector-icons`, `react-native-svg`, `react-dom`, `react-native-web`), so a clean install broke the build. | Declared in `package.json` at Expo-compatible versions. |

### bandit

All three are false positives: `"bearer"` (token type label), the dev-only JWT
secret (production refuses to start with it), and an `UPDATE` built from a fixed
list of column names (`storage.update_user_pins`).

### npm audit: remaining 11

* `node-forge`, `postcss`, `image-size`: inside Expo CLI / Metro (build tooling,
  not shipped in the app). Fixed by upgrading to the next Expo SDK.
* `@grpc/grpc-js` via `firebase`: only used by the Firebase fallback channel,
  which is unfinished (ROADMAP P0 #6). Removing that channel removes the issue.

## Not fixed yet (recommendations)

1. **Rate limits are per process and per IP** (slowapi in memory). Behind a proxy, configure the
   trusted `X-Forwarded-For` hop and move limits to Redis (ROADMAP P1).
2. **Chunked request bodies** bypass the Content-Length check; set `client_max_body_size`
   (or equivalent) at the reverse proxy.
3. **Staff accounts** should get a second factor (TOTP) and an allow-list of networks for the dashboard.
4. **Web build** stores tokens in origin storage (browsers have no keystore); keep the web app for demos only,
   or move it to httpOnly cookies with CSRF protection.
5. **Dashboard** pages need a CSP like the tracking page.
6. Run ZAP in CI on every pull request with the trimmed spec in `docs/` (see "How to re-run").

## How to re-run

```powershell
# Static + dependency checks
python -m pip install bandit pip-audit      # Python 3.12; the project venv is 3.15
python -m bandit -q -r SHIELD/backend/api SHIELD/backend/db
python -m pip_audit -r SHIELD/backend/requirements.txt
cd SHIELD/app; npm audit --omit=dev

# Dynamic scan (API on :8000 with SHIELD_DEMO_MODE=true and a throwaway SHIELD_DB_PATH)
# 1. create an account and copy its access token
# 2. save /openapi.json without the session-ending paths (/auth/logout*, /me/account,
#    /me/password, /auth/password/reset), or ZAP signs itself out in the first second
# 3. docker run --rm -v <dir>:/zap/wrk zaproxy/zap-stable zap-api-scan.py -t /zap/wrk/openapi.json -f openapi \
#      -r zap_report.html -z "-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization -config replacer.full_list(0).replacement=Bearer <token> ..."
```

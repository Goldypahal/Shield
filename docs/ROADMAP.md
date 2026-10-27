# Roadmap and future scope

Status after the October 2026 hardening pass (see `ENGINEERING_REVIEW.md`).
Items are ordered by what blocks real users first. Each P0/P1 item ends with a
ready-to-use brief for an AI coding agent or a developer: scoped, with the
files involved and a definition of done, so the work can be handed off as is.

## P0: before any real user (launch blockers)

### 1. Production sign-up and login in the app: done (October 2026)
Email + password accounts with email and SMS verification codes, SOS PIN and
duress PIN set at sign-up, password reset, PIN change via emailed code + password,
sign out / sign out everywhere (`app/src/screens/AuthScreen.tsx`, `backend/api/auth.py`).
Still to do: configure SMTP (Gmail App Password or a transactional provider) and
Twilio in production, and add an optional second factor for staff accounts.

### 2. Encrypt secrets on the device: done (October 2026)
Tokens and salted PIN hashes are in the OS keystore via `expo-secure-store`
(`app/src/services/secureStorage.ts`, `pinVault.ts`); no plaintext PIN is stored.
On web the keystore is not available and storage falls back to the origin's local storage.

### 3. Guardian invitations
`POST /guardians/{id}/verify` works (only the invited phone can accept), but
nothing tells the guardian they were invited.

> **Brief:** When a guardian is added (`backend/api/contacts.py`), send an SMS via
> `notifier._send_sms` with a link `PUBLIC_APP_URL/invite/{guardian_id}`. In the
> app, handle that deep link: sign in (or register) and call
> `POST /api/v1/guardians/{id}/verify`. Show verified/unverified state in
> `ContactsScreen`. Add an API test that an unverified guardian gets no alert
> access and a verified one does (pattern: `tests/test_security.py`).

### 4. Version control: done
The code is on GitHub (`Goldypahal/Shield`). Still worth doing: branch protection
so CI must pass, and secret scanning.
Install Git, `git init` in `SHIELD/`, commit, push to a private repository,
enable secret scanning and branch protection so CI must pass.

### 5. Field-test every SOS path on real phones
Airplane mode, GPS off, location permission denied, app backgrounded, app
killed mid-SOS, low battery, Android and iOS. Record the outcome of each in
the engineering review. Nothing in the SOS chain has run on a device yet.

### 6. Decide the Firebase fallback
The Cloud Function now requires Firebase Auth, which the app never signs into,
so the fallback is effectively off; `functions/` also lacks a `package.json`.
Either add anonymous Firebase Auth plus the package and deploy config, or delete
the fallback and rely on the queue and SMS composer. Keeping half of it is the
worst option.

### 7. One pilot area
The routing engine and its data cover Chandigarh–Mohali–Panchkula, while the
API seed data (`storage.seed_pilot_area`) and dashboard map centre are in
Delhi. Move the seed segments, safe stops and `DEFAULT_CENTER` to the pilot
campus, and make `/routes/compare` use the Tricity engine there.

## P1: reliability and scale

| Item | Why | Brief |
|---|---|---|
| PostgreSQL + PostGIS | SQLite is single-node; buddy matching and contextual risk need spatial queries. | Introduce SQLAlchemy 2 async + Alembic, port `db/storage.py` table by table keeping its method signatures, run the existing test suite against Postgres in CI (service container), then re-enable `community.py` and `risk_router.py` on the pool. |
| Redis-backed live broker and rate limits | `live.py` and slowapi keep state per process, so more than one worker breaks live tracking and limits. | Implement `LiveBroker` on Redis pub/sub with the same interface; set slowapi `storage_uri=REDIS_URL`; key limits on a trusted `X-Forwarded-For` hop. Test with two uvicorn workers. |
| Escalation worker | The sweeper runs inside the API process; with replicas it must run exactly once. | Move `escalation.run_escalation_loop` to a separate worker process with a Redis lock (or a Postgres advisory lock); add a guardian priority chain (G1 → G2 → G3 → responders). |
| Push notifications | Expo push tokens are stored but never used; SMS is the only channel. | Send Expo push to guardians who have the app, alongside SMS, from `notifier.py`; handle receipts and invalid tokens. |
| Token revocation | Refresh tokens cannot be revoked (lost phone). | Store refresh `jti` per device; `/auth/logout` and "sign out everywhere" revoke; reject revoked `jti` on refresh. |
| Evidence storage | Ciphertext is on local disk. | S3/GCS with server-side encryption, object lock for legal hold, and a retention job matching the privacy policy. |
| Observability | Logs only. | Sentry (API and app), Prometheus metrics (alert latency, SMS delivery rate, escalations), alerting on `/ready` and on SMS failures. |
| Routing performance | Loading the 65k-segment real-OSM graph takes ~28 s per process. | Serialize the built graph (pickle or `npz`), load it once at startup, and rebuild it weekly in CI. |

## P2: product

* **Safety data**: municipal streetlight GIS, police open data and community
  ratings feeding the route engine (OSM `lit` tags cover under 1% of Tricity streets);
  wire `SafeMapScreen` and live walks into the app navigation.
* **Background tracking** during walks (`expo-task-manager`), with a persistent notification.
* **On-device detection**: ship the TFLite exports in `backend/ml/audio` and
  `backend/ml/motion` to the app; calibrate thresholds on the false-alarm feedback the API now collects.
* **Accessibility and languages**: screen-reader labels on SOS controls, Hindi and Punjabi.
* **DPDP Act compliance**: recorded consent, data export, scheduled retention, grievance contact.
* **Dashboard**: safe-stops endpoint and layer, assignment queue, SSO for police and campus security.

## Police integration

Built (October 2026): consent at sign-up and in Settings, nearest-station routing,
112/ERSS outbox with retries (mock mode until approved), 3-minute control-room
escalation, station-scoped staff accounts with TOTP and full audit logging,
dispatcher status shown to walker and guardians, FIR consent and evidence bundle,
police hotspots in route scoring, k-anonymous hazard and dark-street exports,
helplines and nearest police in the app, retention job, and a draft agreement
(`docs/POLICE_DATA_SHARING.md`). Still needed from the police side: ERSS API
approval and schema, the official station list with boundaries, and a signed agreement.

Goal: an alert reaches the nearest police unit with verified, actionable data, and
police get nothing they should not (no bulk tracking of citizens).

1. **ERSS-112 handoff.** India's Emergency Response Support System (112) accepts
   events from integrated apps. Apply through the state ERSS/Chandigarh Police for
   the integration API; send HIGH alerts (SOS, duress, missed check-in after
   guardian escalation) with location, trail link and walker name/phone, and keep
   the 112 incident id on the alert. Until approved, the dashboard is the channel.
2. **Station routing.** Map each alert to the jurisdiction police station and PCR
   beat (Chandigarh Police station boundaries) and show it only in that
   station's dashboard queue; escalate to the control room after 3 minutes.
3. **Responder accounts per station** (already supported: `manage.py create-staff`),
   with TOTP, IP allow-lists, and every view logged in the audit log (DASH-6).
4. **Two-way status.** Dispatcher actions (acknowledged, unit assigned, on scene)
   flow back to the walker and guardians, and the tracking link shows them.
5. **Verified evidence.** The PDF report and hash-chained audio evidence are
   exported in a format the police can attach to an FIR; walker consent is
   recorded before sharing.
6. **Safety data loop.** Police share anonymised incident hotspots and PCR beat
   positions (the routing engine already weighs police distance); SHIELD shares
   aggregated hazard reports and dark-street lists (`/dashboard/gaps`) with the
   police and municipal corporation for patrols and lighting repairs.
7. **Women's helpline and Shakti/PCR vans.** Show the nearest PCR van / women's
   helpline (1091 / 181) beside 112 in the SOS screen.
8. **Governance.** A data-sharing MoU, DPDP Act consent, retention limits, and an
   independent audit of what police can see. Police never get live location
   outside an open alert.

## Bluetooth SOS relay (built October 2026, needs hardening before launch)

With no signal at all the SMS composer cannot help either: SMS still needs a cell tower.
So a walker's phone now broadcasts its signed alert over BLE, and any other SHIELD phone
within range reads it and uploads it to `POST /api/v1/alerts/relay` on the walker's behalf.

* App: `src/services/bleRelay.ts` (advertise + GATT serve, and scan + read + upload),
  `src/services/bleRelayPayload.ts` (shared signed payload), `bleRelay.web.ts` (web has
  no phone-to-phone BLE). Uses `munim-bluetooth` + `react-native-nitro-modules`.
* API: `ble_relay.py`, plus the relay endpoint in `alerts_router.py`.
* Needs a native development build; it does not work in Expo Go (neither do
  `@siteed/audio-studio` or `react-native-maps`, so this was already true).

What it honestly is not: Bluetooth reaches tens of metres, so this carries an alert to
the *next SHIELD phone*, never to a guardian or to 112 directly. It works on a campus or
a busy street and fails on an empty road. It also needs the walker's app to be running
to advertise.

Before launch:

1. **Replace the shared signing key with per-device identity.** The key ships in the app
   bundle, so today a valid signature proves only that a packet came from a SHIELD build,
   not *who* sent it, and an extracted key could raise an alert attributed to another
   user. Register an Ed25519 public key per install at sign-up and sign with the private
   half in `expo-secure-store`. The relay endpoint already records `relayed_by` and the
   alert is marked as relayed, which limits the damage in the meantime.
2. **Encrypt the payload on the air.** GATT reads that require encryption need a pairing
   step that cannot happen mid-emergency, so the characteristic is currently readable by
   any device in range while an alert is active, exposing the walker's coordinates.
3. **Field-test it on real phones:** two Android devices, one in airplane mode, radios on,
   app foreground and background, and the Android 12+ permission prompts. Nothing in this
   path has run on a device yet.
4. **Get consent for relaying.** Scanning means a phone reads alerts for strangers nearby.
   It is passive and carries no location of its own, but it belongs in the privacy policy
   and behind an explicit toggle.
5. **Battery and abuse:** measure the scanning budget, and cap how many alerts one account
   can relay per hour (the endpoint is rate limited now, which is not the same thing).

## Future scope: smartwatch companion

Not buildable in the Expo managed app: Wear OS needs a separate Android module and
watchOS an Xcode project with WatchConnectivity. Plan:

1. Wear OS tile + complication: hold-to-SOS that calls `POST /api/v1/alerts/sync`
   through the paired phone (Data Layer API), with the phone's location.
2. watchOS app: same, plus "I'm safe" for check-in timers (still needs the PIN on the watch).
3. Heart-rate spikes and fall detection (see below) on the watch, which is far more reliable than a phone in a bag.

## Future scope: hardware-button SOS

Volume-button patterns need a native Android module (an `AccessibilityService` or a
foreground service listening for `KEYCODE_VOLUME_*`), and Play Store review for that
permission. iOS does not let apps read the side buttons at all; there the options
are Siri Shortcuts ("Hey Siri, SHIELD SOS") and the Action button on newer iPhones.
Shake-to-SOS, silent SOS and the calculator disguise cover discreet triggering today.

## Future scope: fall detection

Moved out of the current release (SRS DET-5, now "Later"). The Home screen shows
the card as *Coming soon* and nothing is armed. The groundwork stays in the repo:
`app/src/ml/MotionClassifier.ts` (2.5 g impact + 10 s stillness rule, struggle
pattern), `app/src/services/motionService.ts`, and the training scaffold in
`backend/ml/motion/`.

What it needs before it ships:

1. **Data and calibration.** Train and evaluate on SisFall / MobiAct plus phone-in-pocket
   and phone-in-bag recordings; report false alarms per hour of normal walking,
   stairs, running, and dropped phones. Target fewer than one false prompt per week.
2. **Confirm-before-alert flow.** After a suspected fall: vibrate + full-screen
   "Are you okay?" with a 30 s countdown, cancel with PIN (duress PIN keeps the
   alert silent), then raise a `FALL` alert through the existing SOS pipeline
   (`FALL` is already an accepted trigger type in `alerts_router.py`).
3. **Background sensing.** Foreground service on Android / background task on iOS
   with a battery budget; only active while a walk is in progress or the user
   turns it on.
4. **Wearables.** Wear OS / watchOS detect falls far more reliably than a phone in a bag.

## Research (later, needs a privacy review first)

Federated learning (`backend/ml/federated_aggregator.py`), personal biometric
baselines, contextual risk scoring, and commute-buddy matching. Each processes
sensitive location or health data and needs a documented threat model and
consent design before any code ships.

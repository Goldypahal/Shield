# Police data sharing: draft agreement and privacy notice

> **Draft for discussion, not legal advice.** Have a lawyer familiar with the Digital
> Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules review this before
> signing anything with a police department. Every rule below is already enforced in code;
> the "Enforced by" column points to where.

## 1. Parties and purpose

Between the SHIELD operator ("Data Fiduciary") and the Chandigarh Police / state ERSS-112
("Police"), so that people who raise an SOS in SHIELD get a faster, better-informed police
response. Data is shared only for responding to an open alert and, with the person's
separate consent, for an FIR. No other purpose (profiling, surveillance, enforcement unrelated
to the alert) is permitted.

## 2. What the police can see, and when

| Data | When police can see it | Enforced by |
|---|---|---|
| Anything at all about a user | Only if the user chose "alert the police" (explicit, at sign-up; changeable any time in Settings) | `users.police_sharing`; `access.staff_can_see`, `police.dispatch` |
| Name, phone, trigger, live location and trail of an alert | While the alert is open, and only staff of the station it was routed to, plus the control room | `access.staff_can_see`, `access.alert_for_viewer` |
| Location after the alert closes | Never, unless the user consents to share that incident for an FIR | `access.location_visible_to_staff` |
| Incident report (PDF), FIR bundle (timeline, trail, evidence hash chain) | Only with the user's per-incident FIR consent, confirmed with their SOS PIN | `police_router.fir_bundle`, `report_router` |
| Audio evidence content | Never by SHIELD: audio is end-to-end encrypted on the phone; the user shares it directly if they wish | `evidence_router` (ciphertext only) |
| Walks, rides, check-in timers without an alert | Never | `access.can_view_walk` |
| Patrol van positions (police → SHIELD) | Used only to tell users "a patrol van is about N km away", rounded to 0.5 km; never shown as a position | `police_router.police_nearby` |
| Community hazard reports (SHIELD → police) | Counts per ~400 m cell, no reporter data, cells with fewer than 3 reports suppressed | `police_router.export_hazards` |

## 3. Safeguards

* **Access control:** named staff accounts only (created by the SHIELD operator on the police's
  written request), email + password + authenticator-app code, scoped to one station or the
  control room. Shared logins are not allowed.
* **Audit:** every view, export and status change by police is logged with the officer's account
  and time (`audit_log`), and the log is available to both parties for review.
* **Transfer:** HTTPS only. The 112 hand-off authenticates with an API key; status callbacks
  from 112 must carry a valid HMAC-SHA256 signature and a fresh timestamp.
* **Breach notification:** each party informs the other within 24 hours of discovering a breach
  affecting shared data, and the Data Fiduciary notifies the Data Protection Board and affected
  users as the DPDP Rules require.

## 4. Retention

| Data | Kept for |
|---|---|
| Location trails of closed alerts and walks | `RETENTION_DAYS` (default 90 days), then deleted automatically |
| Evidence of closed alerts without FIR consent | `RETENTION_DAYS`, then deleted (database rows and encrypted files) |
| Evidence and trail of an alert shared for an FIR | Kept on legal hold until the case closes; the police notify SHIELD |
| Audit log | 1 year |
| Data the police copied into their own systems | The police's own retention rules apply; the police must not re-share it beyond the case |

Enforced by `police.apply_retention` (runs hourly in the API's background sweep).

## 5. User rights

Users can withdraw police sharing at any time (Settings → "Alert the police on SOS"), see their
incident history, give or not give FIR consent per incident, and delete their account (which
erases their alerts, trails and evidence except data on legal hold). Grievance contact: *[name,
email, phone of the Grievance Officer]*.

## 6. Privacy notice text (shown in the app)

> **Alert the police on SOS?**
> If you say yes, when you raise an SOS SHIELD sends your name, phone number and live location
> to the nearest police station and to 112, only while the SOS is open. The police cannot see
> your location after it closes, unless you choose to share that incident for an FIR. You can
> change this any time in Settings.

## 7. Open items before signing

1. ERSS-112 integration approval and the real API schema (SHIELD's payload in `police.dispatch`
   is a proposal and must be mapped to it).
2. Official police station list with jurisdiction boundaries and phone numbers
   (today: OpenStreetMap police posts, nearest-station routing; replace with
   `manage.py add-station` entries from the department).
3. Who at the police may request staff accounts, and the off-boarding process.
4. Agreed format for FIR evidence hand-over and chain of custody.

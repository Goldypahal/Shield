# Put SHIELD on a phone (APK) with the backend online

About 1–2 hours, mostly waiting for builds. Everything below is free; no card needed.

## 1. Backend online (Render), ~15 min

1. Sign in at <https://render.com> with your GitHub account.
2. **New → Blueprint**, pick the `Goldypahal/Shield` repo, branch `main` (after PR #3 is merged).
   Render reads `render.yaml` and creates the `shield-api` web service. Click **Apply**.
3. Wait for the first deploy (Docker build, ~5–10 min). Open the service; its URL is at the
   top, e.g. `https://shield-api.onrender.com` (Render adds a suffix like `-a1b2` if the
   name is taken).
4. Check it: open `<URL>/ready` in a browser. You should see `"status":"ready"`.
5. If your URL is **not** exactly `https://shield-api.onrender.com`:
   - in `app/eas.json` replace `https://shield-api.onrender.com` (two places) with your URL;
   - in Render → shield-api → Environment, set `CORS_ORIGINS` and `PUBLIC_APP_URL` to your URL;
   - in GitHub → repo Settings → Secrets and variables → Actions → **Variables**, add
     `SHIELD_API_URL` = your URL (used by the keep-awake ping).

### What the free plan means
- **Sleeps after 15 min idle.** `.github/workflows/keepalive.yml` pings `/health` every
  10 min so an SOS doesn't wait ~50 s for the server to wake. GitHub may run it a few
  minutes late, so the server can still occasionally be asleep; the app queues the alert
  and retries, and offers SMS as a fallback.
- **No persistent disk.** Accounts and alerts are stored in SQLite inside the container and
  are **wiped whenever the service restarts or redeploys** (every push to `main`). Fine
  for testing; for real users change `plan: free` to `plan: starter` in `render.yaml` and
  uncomment the `disk:` block (about US$7.25/month).
- **Pilot mode.** `SHIELD_DEMO_MODE=true`: sign-up codes are shown in the app instead of
  being sent, so no SMS/email service is needed. Anyone with the app can create an
  account. Before a public launch: `SHIELD_ENV=production`, `SHIELD_DEMO_MODE=false`, and
  fill in `SMTP_*` (Gmail app password works) and `TWILIO_*` in Render → Environment.
- Guardian SMS alerts need Twilio (`TWILIO_*`). Without it the server logs them instead.

## 2. Build the APK (EAS Build), ~5 min of work + 15–60 min waiting

On your computer, in the repo:

```bash
cd app
npm install
npx eas-cli login          # create a free account at expo.dev if you have none
npx eas-cli build -p android --profile preview
```

- First time it asks to create an EAS project: answer **Yes** (it adds the project id to
  `app.json`; commit that change).
- It asks to generate an Android keystore: answer **Yes** (Expo stores it for you; keep it,
  every update must be signed with the same key).
- The build runs on Expo's servers. Free accounts may wait in a queue first. When done it
  prints a link and a QR code.

## 3. Install on the phone

1. Open the link (or scan the QR code) on the Android phone and download the `.apk`.
2. Allow "Install unknown apps" for your browser when Android asks.
3. Open SHIELD → create an account (codes appear on screen in pilot mode) → set your SOS
   PIN → add guardians.
4. Allow microphone, location and notifications. In Settings check **Scream detection**,
   **Listen in background** and **Fall detection**.

## Updating

Any code change needs a new APK: run the build command again and install over the old app
(same keystore, data is kept). Backend changes deploy by themselves when `main` changes.

`--profile production` builds an `.aab` for the Google Play Store instead.

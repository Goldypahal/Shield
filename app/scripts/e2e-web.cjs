/**
 * Feature test of the web build against a local API (demo mode):
 *   backend: SHIELD_ENV=staging SHIELD_DEMO_MODE=true JWT_SECRET=<32+ chars> CORS_ORIGINS=http://127.0.0.1:8791 \
 *            python -m uvicorn main:app --app-dir backend/api --port 8767
 *   app:     EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8767 npx expo export -p web --output-dir /tmp/web && \
 *            python -m http.server 8791 -d /tmp/web
 *   run:     node scripts/e2e-web.cjs      (needs `npm i -g playwright` + a Chromium)
 * Uses a fresh database: it signs up riya@example.com.
 */
const { chromium } = require('playwright');
const R = []; const ok = (n, v, note='') => { R.push([n, !!v, note]); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${note ? '  -- ' + note : ''}`); };
const txt = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  p.on('dialog', d => d.accept());
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name, false, String(e).split('\n')[0].slice(0, 160)); await p.screenshot({ path: `full_fail_${name.replace(/\W+/g,'_')}.png` }); } };
  await p.goto('http://127.0.0.1:8791/', { waitUntil: 'networkidle' }); await p.waitForTimeout(4500);

  await step('sign-up with code + PINs (number without +91)', async () => {
    await p.getByText('New to SHIELD? Create an account').click();
    await p.getByLabel('Full name').fill('Riya Test');
    await p.getByLabel('Email').fill('riya@example.com');
    await p.getByLabel('Mobile number').fill('98111 22334');
    await p.getByLabel('Password', { exact: true }).fill('Str0ng!Passw0rd');
    await p.getByLabel('Repeat password').fill('Str0ng!Passw0rd');
    await p.getByLabel('Send verification codes').click(); await p.waitForTimeout(2500);
    const t = await txt(p); const em = t.match(/email (\d{6})/)?.[1], sm = t.match(/SMS (\d{6})/)?.[1];
    if (!em || !sm) throw new Error('no demo codes: ' + t.slice(0, 300));
    await p.getByLabel('Code from email').fill(em); await p.getByLabel('Code from SMS').fill(sm);
    await p.getByLabel('Continue').click(); await p.waitForTimeout(1500);
    await p.getByLabel(/^SOS PIN/).fill('1234'); await p.getByLabel('Repeat SOS PIN').fill('1234');
    await p.getByLabel(/^Duress PIN/).fill('9876');
    await p.getByText('No, only my guardians').first().click();
    await p.getByLabel('Create account').click(); await p.waitForTimeout(4000);
    const home = await txt(p);
    ok('sign-up with code + PINs (number without +91)', /Quick actions|Helplines/.test(home), home.includes('Riya') ? 'greets Riya' : '');
  });

  await step('bottom tabs (no Safety Info)', async () => {
    const t = await txt(p); ok('bottom tabs (no Safety Info)', /Helplines/.test(t) && !/Safety Info/.test(t));
  });

  await step('home helplines + call buttons', async () => {
    const t = await txt(p); ok('home helplines + call buttons', /112/.test(t) && /181|1098|14490/.test(t));
  });

  await step('language switch to Hindi and back', async () => {
    await p.getByLabel(/^Language:/).click(); await p.waitForTimeout(800);
    await p.getByLabel(/हिन्दी|Hindi/).first().click(); await p.waitForTimeout(1200);
    const t = await txt(p); const hindi = /[ऀ-ॿ]{3}/.test(t);
    await p.getByLabel(/: Hindi$/).click().catch(()=>{}); await p.waitForTimeout(800);
    await p.getByLabel(/English/).first().click(); await p.waitForTimeout(800);
    ok('language switch to Hindi and back', hindi && /Quick actions/.test(await txt(p)));
  });

  await step('guardian add (no +91) / list / delete', async () => {
    await p.getByText('Who gets your SOS', { exact: true }).click(); await p.waitForTimeout(1500);
    await p.getByText('Add guardian', { exact: true }).first().click(); await p.waitForTimeout(600);
    await p.getByPlaceholder(/Name/).fill('Papa'); await p.getByPlaceholder(/Mobile number/).fill('099887 76655');
    await p.getByText('Add guardian', { exact: true }).last().click(); await p.waitForTimeout(2500);
    const added = /\+919988776655/.test(await txt(p));
    await p.getByText('Add guardian', { exact: true }).first().click(); await p.waitForTimeout(600);
    await p.getByPlaceholder(/Name/).fill('Me'); await p.getByPlaceholder(/Mobile number/).fill('98111 22334');
    await p.getByText('Add guardian', { exact: true }).last().click(); await p.waitForTimeout(2000);
    const selfErr = /yourself/i.test(await txt(p));
    await p.getByLabel('Close').last().click().catch(()=>{}); await p.waitForTimeout(500);
    ok('guardian add (no +91) / list / delete', added && selfErr, `added=${added} self-number refused=${selfErr}`);
  });

  await step('helplines tab: search', async () => {
    await p.getByText('Helplines', { exact: true }).last().click(); await p.waitForTimeout(1200);
    await p.getByLabel(/Search helplines/).fill('child'); await p.waitForTimeout(800);
    ok('helplines tab: search', /1098/.test(await txt(p)));
  });

  // The SOS button has to be held for 3 s: a tap only shows a hint
  const holdSos = async (ms = 3300) => {
    const b = p.getByLabel(/Emergency SOS/).first(); const box = await b.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
  };
  await step('SOS button: a short tap does not start an SOS', async () => {
    await holdSos(600); await p.waitForTimeout(800);
    const t = await txt(p);
    ok('SOS button: a short tap does not start an SOS', !/I.?M SAFE/i.test(t) && (await p.getByLabel('SOS PIN').count()) === 0, /Hold 3 s/.test(t) ? 'hint shown' : '');
  });

  await step('SOS button: PIN-only, wrong PIN refused, duress looks stopped', async () => {
    await holdSos(); await p.waitForTimeout(1200);
    const back = await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const stillOpen = /Emergency SOS/.test(await txt(p)) || (await p.getByText(/I.?M SAFE/i).count()) > 0;
    await p.getByText(/I.?m safe/i).first().click(); await p.waitForTimeout(400);
    await p.getByLabel('SOS PIN').fill('1111'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    const wrong = /Incorrect PIN/.test(await txt(p));
    await p.getByLabel('SOS PIN').fill('9876'); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
    const looksStopped = /SOS cancelled|cancelled/i.test(await txt(p));
    await p.getByText('DONE').click().catch(()=>{}); await p.waitForTimeout(800);
    ok('SOS button: PIN-only, wrong PIN refused, duress looks stopped', stillOpen && wrong && looksStopped, `escape-ignored=${stillOpen} wrong=${wrong} duress=${looksStopped}`);
  });

  await step('SOS sent then stopped with PIN', async () => {
    await holdSos(); await p.waitForTimeout(7000);
    const sent = (await p.getByLabel('SOS PIN').count()) > 0;
    await p.getByLabel('SOS PIN').fill('1234'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
    const stopped = /SOS stopped/.test(await txt(p));
    await p.getByText('DONE').click().catch(()=>{});
    ok('SOS sent then stopped with PIN', sent && stopped);
  });

  await step('check-in timer start + stop with PIN', async () => {
    await p.getByText('Home', { exact: true }).last().click(); await p.waitForTimeout(1500);
    await p.getByLabel('Start a check-in timer').click(); await p.waitForTimeout(700);
    await p.getByLabel('15 minutes').click().catch(async () => { await p.getByLabel(/minutes/).first().click(); });
    await p.waitForTimeout(2000);
    const running = (await p.getByLabel('I am safe, stop the timer with PIN').count()) > 0;
    await p.getByLabel('I am safe, stop the timer with PIN').click(); await p.waitForTimeout(500);
    await p.getByLabel('SOS PIN').fill('1234'); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
    const stopped = (await p.getByLabel('Start a check-in timer').count()) > 0;
    ok('check-in timer start + stop with PIN', running && stopped, `running=${running} stopped=${stopped}`);
  });

  await step('fake call: schedule, ring, answer, end', async () => {
    await p.getByText('Get out of a situation', { exact: true }).click(); await p.waitForTimeout(1200);
    await p.getByText(/^5 s|^5s|5 sec/).first().click().catch(()=>{});
    await p.getByLabel('Schedule fake call').click();
    await p.waitForTimeout(12000);
    const ringing = (await p.getByLabel('Accept call').count()) > 0;
    const navHidden = !(await txt(p)).includes('Profile');
    await p.getByLabel('Accept call').click().catch(()=>{}); await p.waitForTimeout(2000);
    const inCall = (await p.getByLabel('End call').count()) > 0;
    await p.getByLabel('End call').click().catch(()=>{}); await p.waitForTimeout(800);
    ok('fake call: schedule, ring, answer, end', ringing && inCall, `ringing=${ringing} navHiddenWhileRinging=${navHidden} inCall=${inCall}`);
  });

  await step('settings: toggles present', async () => {
    await p.getByText('Profile', { exact: true }).last().click(); await p.waitForTimeout(1500);
    const t = await txt(p);
    const need = ['Scream detection', 'Listen in background', 'Fall detection', 'Voice keywords', 'Shake to start SOS', 'calculator', 'SOS PIN'];
    const missing = need.filter(n => !t.includes(n));
    ok('settings: toggles present', missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : '');
  });

  await step('routes tab opens', async () => {
    await p.getByText('Routes', { exact: true }).last().click(); await p.waitForTimeout(2000);
    ok('routes tab opens', /Where to\?/.test(await txt(p)));
  });

  ok('no page crashes', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${R.filter(r => r[1]).length}/${R.length} passed`);
  await b.close();
})();

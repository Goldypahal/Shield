// SHIELD Walk - Authority Command & Analytics Dashboard JS (SRS DASH-1 to 6)
//
// Staff sign in with a responder/admin account. Every API call carries that
// account's token, so the server's role checks and audit log apply.
// Demo data is shown only with ?demo=1 and is always labelled as such: a
// dispatch console must never present invented incidents as real ones.

const API_BASE = (location.protocol.startsWith("http") ? location.origin : "http://localhost:8000") + "/api/v1";
const DEMO_MODE = new URLSearchParams(location.search).get("demo") === "1";
const TOKEN_KEY = "shield_dash_access";
const REFRESH_KEY = "shield_dash_refresh";

let liveMap = null;
let heatMap = null;
let heatLayer = null;
let incidentLayer = null;
let markerLayerGroup = null;
let currentRole = "responder";
let activeIncidents = [];
let pollTimer = null;

// Default coordinates for the pilot area (Chandigarh Tricity, where the routing engine runs)
const DEFAULT_CENTER = [30.7333, 76.7794];

/** Escapes text for safe insertion into HTML: walker names and notes are user-controlled. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;"
  })[c]);
}

function num(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

document.addEventListener("DOMContentLoaded", () => {
  initIcons();
  initLiveMap();
  wireDelegatedActions();
  if (DEMO_MODE) {
    showDemoBanner();
    loadDashboardData();
  } else if (sessionStorage.getItem(TOKEN_KEY)) {
    startPolling();
  } else {
    showLogin();
  }
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// --- Authentication -------------------------------------------------------

function showLogin(message) {
  let overlay = document.getElementById("login-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,10,18,.92)";
    overlay.innerHTML = `
      <form id="login-form" style="background:#111A2A;border:1px solid #334460;border-radius:12px;padding:28px;width:min(360px,92vw);color:#E2E8F0;font-family:inherit">
        <h2 style="margin:0 0 4px">SHIELD Command Login</h2>
        <p style="margin:0 0 18px;color:#94A3B8;font-size:13px">Responder or admin account required.</p>
        <label style="font-size:12px">Email</label>
        <input id="login-email" required type="email" placeholder="control@police.example" autocomplete="username"
          style="width:100%;margin:4px 0 12px;padding:9px;border-radius:6px;border:1px solid #334460;background:#182232;color:white">
        <label style="font-size:12px">Password</label>
        <input id="login-password" required type="password" autocomplete="current-password"
          style="width:100%;margin:4px 0 12px;padding:9px;border-radius:6px;border:1px solid #334460;background:#182232;color:white">
        <label style="font-size:12px">Authenticator code</label>
        <input id="login-totp" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 digits"
          style="width:100%;margin:4px 0 12px;padding:9px;border-radius:6px;border:1px solid #334460;background:#182232;color:white">
        <p id="login-error" style="color:#F87171;font-size:12px;min-height:16px;margin:0 0 10px"></p>
        <button class="btn-primary" type="submit" style="width:100%">Sign in</button>
        <p style="margin:14px 0 0;font-size:11px;color:#64748B">Exploring without a backend? Open <a href="?demo=1" style="color:#FBBF24">demo mode</a>.</p>
      </form>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#login-form").addEventListener("submit", submitLogin);
  }
  overlay.style.display = "flex";
  overlay.querySelector("#login-error").textContent = message || "";
}

async function submitLogin(event) {
  event.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("login-email").value.trim(),
        password: document.getElementById("login-password").value,
        totp_code: document.getElementById("login-totp").value.trim()
      })
    });
    if (!res.ok) {
      errorEl.textContent = res.status === 429 ? "Too many attempts. Try again later."
        : res.status === 422 ? "Enter a valid email, your password and the 6-digit code."
        : res.status === 403 ? "Two-factor sign-in is not set up for this account. Ask an administrator."
        : "Incorrect email, password or code.";
      return;
    }
    const data = await res.json();
    sessionStorage.setItem(TOKEN_KEY, data.access_token);
    sessionStorage.setItem(REFRESH_KEY, data.refresh_token);
    const me = await api("/me");
    if (!me.ok || !["responder", "admin"].includes((await me.json()).role)) {
      logout("This account is not a responder or admin.");
      return;
    }
    document.getElementById("login-overlay").style.display = "none";
    startPolling();
  } catch (e) {
    errorEl.textContent = "Backend unreachable.";
  }
}

function logout(message) {
  const refresh = sessionStorage.getItem(REFRESH_KEY);
  if (refresh) {
    // Revoke the session on the server too, so a copied refresh token stops working
    fetch(`${API_BASE}/auth/logout`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refresh })
    }).catch(() => {});
  }
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  showLogin(message);
}

async function refreshToken() {
  const refresh = sessionStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh })
  });
  if (!res.ok) return false;
  const data = await res.json();
  sessionStorage.setItem(TOKEN_KEY, data.access_token);
  sessionStorage.setItem(REFRESH_KEY, data.refresh_token);
  return true;
}

/** Authenticated fetch with one transparent token refresh. */
async function api(path, options = {}, retried = false) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY)}` };
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 && !retried && await refreshToken()) {
    return api(path, options, true);
  }
  if (res.status === 401) logout("Session expired. Please sign in again.");
  return res;
}

function startPolling() {
  loadDashboardData();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadDashboardData, 10000);
}

function setStatus(icon, text) {
  document.getElementById("api-status").innerHTML = `<i data-lucide="${esc(icon)}"></i> <span>${esc(text)}</span>`;
}

function showDemoBanner() {
  const banner = document.createElement("div");
  banner.textContent = "DEMO MODE: all incidents, gaps and logs on this page are invented sample data.";
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9998;background:#B45309;color:white;text-align:center;font:600 13px sans-serif;padding:6px";
  document.body.appendChild(banner);
  setStatus("flask-conical", "Demo data (not live)");
}

// --- Maps -------------------------------------------------------------------

const FALLBACK_BASEMAP = {
  raster_url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap contributors'
};
let basemapConfig = null;

/** Tile settings come from the API (GET /config/maps) so the CARTO key stays in server config. */
function getBasemap() {
  if (!basemapConfig) {
    basemapConfig = fetch(`${API_BASE}/config/maps`)
      .then((res) => (res.ok ? res.json() : FALLBACK_BASEMAP))
      .catch(() => FALLBACK_BASEMAP);
  }
  return basemapConfig;
}

async function addBasemap(map) {
  const cfg = await getBasemap();
  L.tileLayer(cfg.raster_url, { attribution: cfg.attribution, maxZoom: 19 }).addTo(map);
}

function initLiveMap() {
  if (liveMap) return;

  liveMap = L.map("live-map").setView(DEFAULT_CENTER, 14);
  addBasemap(liveMap);

  markerLayerGroup = L.layerGroup().addTo(liveMap);
  incidentLayer = L.layerGroup().addTo(liveMap);
}

function initHeatMap(points) {
  if (!heatMap) {
    heatMap = L.map("analyst-heat-map").setView(DEFAULT_CENTER, 14);
    addBasemap(heatMap);
  }
  if (heatLayer) {
    heatMap.removeLayer(heatLayer);
  }
  const heatPoints = points.map(p => [p.lat, p.lon, p.intensity || 0.7]);
  heatLayer = L.heatLayer(heatPoints, {
    radius: 35,
    blur: 25,
    maxZoom: 17,
    gradient: { 0.2: '#10B981', 0.5: '#F59E0B', 0.8: '#EF4444' }
  }).addTo(heatMap);
}

// --- Live dispatch (DASH-1, DASH-2) -----------------------------------------

async function loadDashboardData() {
  if (DEMO_MODE) {
    activeIncidents = demoIncidents();
    renderIncidents(activeIncidents);
    renderGaps(demoGaps());
    renderAuditLogs(demoAuditLogs());
    initIcons();
    return;
  }
  try {
    const res = await api("/dashboard/alerts/active");
    if (res.ok) {
      activeIncidents = (await res.json()).alerts || [];
      renderIncidents(activeIncidents);
      setStatus("server", "Backend API: Online");
    } else if (res.status === 403) {
      logout("This account is not a responder or admin.");
      return;
    } else {
      setStatus("alert-triangle", `Backend error ${res.status}: data may be stale`);
    }
  } catch (err) {
    setStatus("wifi-off", "Backend unreachable: data may be stale");
  }
  loadGaps();
  loadAuditLogs();
  initIcons();
}

function renderIncidents(incidents) {
  const container = document.getElementById("incidents-list");
  document.getElementById("active-alert-count").textContent = incidents.length;
  document.getElementById("stat-active-sos").textContent = incidents.length;
  document.getElementById("stat-duress").textContent = incidents.filter(i => i.trigger_type === "DURESS_PIN").length;

  if (incidentLayer) incidentLayer.clearLayers();

  if (incidents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="shield-check"></i>
        <p>No active distress alerts in queue.</p>
      </div>`;
    initIcons();
    return;
  }

  container.innerHTML = incidents.map((inc) => {
    const isDuress = inc.trigger_type === "DURESS_PIN";
    const badgeText = isDuress ? "SILENT DURESS PIN" : (inc.trigger_type || "SOS BUTTON");
    return `
      <div class="incident-card ${isDuress ? 'duress-alert' : 'high-priority'}" data-action="focus" data-id="${esc(inc.id)}">
        <div class="card-top">
          <span class="badge-tag ${isDuress ? "tag-orange" : "tag-red"}">${esc(badgeText)}</span>
          <span class="card-time">${esc(inc.started_at || 'Active')}</span>
        </div>
        <h4>${esc(inc.walker_name || "Unnamed walker")}</h4>
        <p>Location: ${num(inc.lat, 4)}, ${num(inc.lon, 4)} &bull; State: <strong>${esc(inc.state)}</strong></p>
        <p style="font-size:12px;color:#94A3B8">${inc.control_room ? '<strong style="color:#F97316">CONTROL ROOM</strong>' : esc(inc.station || "")}
          &bull; Police: <strong>${esc(POLICE_LABELS[inc.police_status] || inc.police_status || "not routed")}</strong>${inc.police_unit ? " (" + esc(inc.police_unit) + ")" : ""}
          ${inc.incident_112 ? "&bull; 112 #" + esc(inc.incident_112) : ""}</p>
        <div class="card-actions">
          <button class="btn-card-action" data-action="review" data-id="${esc(inc.id)}">Review & Assign</button>
          <button class="btn-card-action" data-action="ack" data-id="${esc(inc.id)}">Acknowledge</button>
        </div>
      </div>`;
  }).join("");

  incidents.forEach((inc) => {
    if (!incidentLayer || !Number.isFinite(inc.lat) || !Number.isFinite(inc.lon)) return;
    const isDuress = inc.trigger_type === "DURESS_PIN";
    const color = isDuress ? "#F97316" : "#EF4444";
    const popup = document.createElement("div");
    popup.style.fontFamily = "sans-serif";
    popup.innerHTML = `<b style="color:${color}">${esc(isDuress ? "SILENT DURESS PIN" : inc.trigger_type)}</b><br>
      <strong>${esc(inc.walker_name || "Unnamed walker")}</strong><br>Status: ${esc(inc.state)}<br>`;
    const btn = document.createElement("button");
    btn.textContent = "Dispatch Unit";
    btn.style.cssText = "margin-top:6px;padding:4px 8px;background:#FF8F00;border:none;border-radius:4px;cursor:pointer;font-weight:bold";
    btn.addEventListener("click", () => openIncidentModal(inc.id));
    popup.appendChild(btn);
    L.circleMarker([inc.lat, inc.lon], { radius: 10, fillColor: color, color: "#FFFFFF", weight: 2, fillOpacity: 0.9 })
      .bindPopup(popup).addTo(incidentLayer);
    if (inc.trail && inc.trail.length > 1) {
      L.polyline(inc.trail.map(t => [t.lat, t.lon]), { color, weight: 3, dashArray: '5, 8' }).addTo(incidentLayer);
    }
  });
  initIcons();
}

/** One listener instead of inline onclick handlers, so no data is ever interpolated into JS. */
function wireDelegatedActions() {
  document.getElementById("incidents-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const id = target.dataset.id;
    if (target.dataset.action === "review") { event.stopPropagation(); openIncidentModal(id); }
    else if (target.dataset.action === "ack") { event.stopPropagation(); acknowledgeAlert(id); }
    else if (target.dataset.action === "focus") focusIncident(id);
  });
}

function focusIncident(alertId) {
  const inc = activeIncidents.find(i => i.id === alertId);
  if (inc && liveMap) {
    liveMap.setView([inc.lat, inc.lon], 16, { animate: true });
  }
}

function openIncidentModal(alertId) {
  const inc = activeIncidents.find(i => i.id === alertId);
  if (!inc) return;

  const isDuress = inc.trigger_type === "DURESS_PIN";
  document.getElementById("modal-priority").textContent = isDuress ? "SILENT DURESS ALARM (DUR-4)" : `ALERT (${inc.priority || "HIGH"})`;
  document.getElementById("modal-priority").className = `badge-priority ${isDuress ? 'orange' : 'high'}`;
  document.getElementById("modal-title").textContent = `Incident ${String(inc.id).substring(0, 12)}`;

  document.getElementById("modal-body").innerHTML = `
    <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:8px">
      <p><strong>Walker Identity:</strong> ${esc(inc.walker_name || "Unnamed walker")}</p>
      <p><strong>Registered Phone:</strong> ${esc(inc.walker_phone || "Unknown")}</p>
      <p><strong>Trigger Mechanism:</strong> ${esc(inc.trigger_type)}</p>
      <p><strong>GPS Coordinates:</strong> ${num(inc.lat, 6)}, ${num(inc.lon, 6)}${inc.lat === 0 && inc.lon === 0 ? " (location unavailable at trigger)" : ""}</p>
      <p><strong>Escalation State:</strong> <span style="color:#10B981;font-weight:bold">${esc(inc.state)}</span></p>
      <p><strong>Trail points:</strong> ${esc(inc.trail_count ?? 0)}</p>
      <p><strong>Station:</strong> ${inc.control_room ? "Control room" : esc(inc.station || "-")} &bull;
         <strong>Police:</strong> ${esc(POLICE_LABELS[inc.police_status] || inc.police_status || "not routed")}
         ${inc.incident_112 ? "&bull; <strong>112 incident:</strong> " + esc(inc.incident_112) : ""}</p>
    </div>
    <div style="display:flex;gap:8px">
      <input id="modal-unit" maxlength="40" placeholder="Unit call sign (e.g. PCR-12)" value="${esc(inc.police_unit || "")}"
        style="flex:2;background:#182232;border:1px solid #334460;border-radius:6px;padding:8px;color:white">
      <input id="modal-eta" type="number" min="0" max="180" placeholder="ETA min"
        style="flex:1;background:#182232;border:1px solid #334460;border-radius:6px;padding:8px;color:white">
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-card-action" data-status="UNIT_ASSIGNED">Unit assigned</button>
      <button class="btn-card-action" data-status="EN_ROUTE">En route</button>
      <button class="btn-card-action" data-status="ON_SCENE">On scene</button>
      <button class="btn-card-action" data-status="CLOSED_SAFE">Closed (safe)</button>
    </div>
    <div>
      <label style="display:block;font-size:11px;font-weight:bold;margin-bottom:4px">DISPATCH / RESOLUTION NOTES:</label>
      <textarea id="modal-notes" rows="3" maxlength="1000" style="width:100%;background:#182232;border:1px solid #334460;border-radius:6px;padding:8px;color:white" placeholder="Vehicle call sign or response action"></textarea>
    </div>`;

  const footer = document.getElementById("modal-footer");
  footer.innerHTML = `
    <button class="btn-secondary" id="modal-pdf"><i data-lucide="file-text"></i> Download Incident PDF (REP-1)</button>
    <button class="btn-secondary" id="modal-fir"><i data-lucide="folder-down"></i> FIR evidence bundle</button>
    <button class="btn-primary" id="modal-resolve"><i data-lucide="check-circle"></i> Resolve Incident</button>`;
  footer.querySelector("#modal-pdf").addEventListener("click", () => downloadIncidentPDF(inc.id));
  footer.querySelector("#modal-fir").addEventListener("click", () => downloadFirBundle(inc.id));
  document.getElementById("modal-body").querySelectorAll("[data-status]").forEach((b) =>
    b.addEventListener("click", () => sendPoliceStatus(inc.id, b.getAttribute("data-status"))));
  footer.querySelector("#modal-resolve").addEventListener("click", () => resolveIncident(inc.id));

  document.getElementById("incident-modal").classList.add("open");
  initIcons();
}

function closeIncidentModal() {
  document.getElementById("incident-modal").classList.remove("open");
}

const POLICE_LABELS = {
  ROUTED: "awaiting station", ACKNOWLEDGED: "acknowledged", UNIT_ASSIGNED: "unit assigned",
  EN_ROUTE: "en route", ON_SCENE: "on scene", CLOSED_SAFE: "closed (safe)",
};

async function acknowledgeAlert(alertId) {
  await sendPoliceStatus(alertId, "ACKNOWLEDGED");
}

/** Dispatcher progress; the walker and their guardians see it in the app and on the tracking link. */
async function sendPoliceStatus(alertId, status) {
  if (DEMO_MODE) { alert("Demo mode: nothing was sent."); return; }
  const unit = document.getElementById("modal-unit")?.value.trim() || undefined;
  const etaRaw = document.getElementById("modal-eta")?.value.trim();
  const body = { status, unit, eta_minutes: etaRaw ? Number(etaRaw) : undefined,
                 note: document.getElementById("modal-notes")?.value.trim() || undefined };
  if ((status === "UNIT_ASSIGNED" || status === "EN_ROUTE") && !unit) { alert("Enter the unit call sign first."); return; }
  const res = await api(`/dashboard/alerts/${encodeURIComponent(alertId)}/police-status`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) { alert(`Update failed (${res.status}).`); return; }
  if (status === "CLOSED_SAFE") closeIncidentModal();
  loadDashboardData();
}

async function downloadFirBundle(alertId) {
  if (DEMO_MODE) { alert("Demo mode: needs the backend."); return; }
  const res = await api(`/dashboard/alerts/${encodeURIComponent(alertId)}/fir-bundle`);
  if (res.status === 403) { alert("The walker has not consented to share this incident for an FIR."); return; }
  if (!res.ok) { alert(`Export failed (${res.status}).`); return; }
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shield_fir_${String(alertId).substring(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function resolveIncident(alertId) {
  if (DEMO_MODE) { alert("Demo mode: nothing was sent."); return; }
  const notes = document.getElementById("modal-notes")?.value.trim();
  if (!notes) { alert("Please enter resolution notes."); return; }
  const res = await api(`/dashboard/alerts/${encodeURIComponent(alertId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ responder_name: "Control room", resolution_notes: notes })
  });
  if (!res.ok) { alert(`Resolve failed (${res.status}).`); return; }
  closeIncidentModal();
  loadDashboardData();
}

async function downloadBlob(path, filename, method = "GET") {
  const res = await api(path, { method });
  if (!res.ok) { alert(`Download failed (${res.status}).`); return; }
  const url = window.URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function downloadIncidentPDF(alertId) {
  if (DEMO_MODE) { alert("Demo mode: PDF export needs the backend."); return; }
  downloadBlob(`/reports/incident/${encodeURIComponent(alertId)}/pdf`, `shield_incident_${String(alertId).substring(0, 8)}.pdf`, "POST");
}

// --- Infrastructure gaps (DASH-4) -------------------------------------------

async function loadGaps() {
  try {
    const res = await api("/dashboard/gaps");
    if (res.ok) renderGaps((await res.json()).work_list || []);
  } catch (e) {
    // keep the last rendered table
  }
}

function renderGaps(gaps) {
  const tbody = document.getElementById("gaps-tbody");
  if (!tbody) return;
  tbody.innerHTML = gaps.map(g => `
    <tr>
      <td><span class="priority-badge priority-${esc(String(g.priority_rank).toLowerCase())}">${esc(g.priority_rank)}</span></td>
      <td><strong>${esc(g.name)}</strong><br><span style="color:#64748B;font-size:10px">${esc(g.segment_id)}</span></td>
      <td>${esc(g.lamp_density_per_100m)} / 100m</td>
      <td><strong style="color:${g.safety_score < 40 ? '#EF4444' : '#10B981'}">${esc(g.safety_score)}</strong></td>
      <td>${esc(g.rating_count)} community reviews</td>
      <td><strong>${esc(g.urgency_score)}</strong></td>
      <td>${esc(g.recommended_action)}</td>
    </tr>`).join("");
}

function exportGapsCSV() {
  if (DEMO_MODE) { alert("Demo mode: CSV export needs the backend."); return; }
  downloadBlob("/dashboard/gaps?format=csv", "shield_infrastructure_gaps.csv");
}

// --- Heatmap (DASH-3, DASH-5) -----------------------------------------------

async function updateHeatmap() {
  if (DEMO_MODE) {
    initHeatMap([
      { lat: 28.6910, lon: 77.2120, intensity: 0.2 }, { lat: 28.6940, lon: 77.2140, intensity: 0.85 },
      { lat: 28.6960, lon: 77.2180, intensity: 0.95 }, { lat: 28.6880, lon: 77.2160, intensity: 0.3 }
    ]);
    return;
  }
  const res = await api("/dashboard/heatmap");
  initHeatMap(res.ok ? (await res.json()).heatmap || [] : []);
}

// --- Audit log (DASH-6, admins only) ----------------------------------------

async function loadAuditLogs() {
  const tbody = document.getElementById("audit-tbody");
  if (!tbody || DEMO_MODE) return;
  const res = await api("/dashboard/audit-logs");
  if (res.status === 403) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#94A3B8">The audit log is visible to admins only.</td></tr>`;
    return;
  }
  if (res.ok) renderAuditLogs(((await res.json()).audit_logs || []).map(l => ({ ...l, status: "LOGGED" })));
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById("audit-tbody");
  if (!tbody) return;
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${esc(l.ts)}</td>
      <td><code>${esc(l.actor)}</code></td>
      <td><strong>${esc(l.action)}</strong></td>
      <td><code>${esc(l.target)}</code></td>
      <td><span style="color:#10B981;font-weight:bold">${esc(l.status)}</span></td>
    </tr>`).join("");
}

// --- Navigation & role view -------------------------------------------------

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(a => a.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

  const targetLink = document.querySelector(`.nav-item[href="#${tabId}"]`);
  if (targetLink) targetLink.classList.add("active");

  const pane = document.getElementById(`tab-${tabId}`);
  if (pane) pane.classList.add("active");

  if (tabId === "heatmap-analysis") {
    setTimeout(updateHeatmap, 200);
  }
}

function setRole(role) {
  currentRole = role;
  document.getElementById("btn-role-responder").classList.toggle("active", role === "responder");
  document.getElementById("btn-role-analyst").classList.toggle("active", role === "analyst");
  document.getElementById("current-role-badge").textContent = role === "responder" ? "Officer On Duty" : "Urban Safety Analyst";
  switchTab(role === "analyst" ? "heatmap-analysis" : "live-dispatch");
}

function toggleMapLayer(layer) {
  const btn = document.getElementById(`btn-toggle-${layer}`);
  if (btn) btn.classList.toggle("active");
}

function refreshDashboardData() {
  loadDashboardData();
}

// --- Demo data (only with ?demo=1) ------------------------------------------

function demoIncidents() {
  return [
    { id: "demo-0001", walker_name: "Demo Walker A", walker_phone: "+910000000001", trigger_type: "DURESS_PIN",
      priority: "HIGH", state: "ACTIVE", lat: 28.6925, lon: 77.2140, started_at: "demo", trail_count: 3,
      trail: [{ lat: 28.6910, lon: 77.2120 }, { lat: 28.6918, lon: 77.2130 }, { lat: 28.6925, lon: 77.2140 }] },
    { id: "demo-0002", walker_name: "Demo Walker B", walker_phone: "+910000000002", trigger_type: "AUDIO_DISTRESS",
      priority: "HIGH", state: "ESCALATED", lat: 28.6960, lon: 77.2175, started_at: "demo", trail_count: 3,
      trail: [{ lat: 28.6940, lon: 77.2160 }, { lat: 28.6952, lon: 77.2168 }, { lat: 28.6960, lon: 77.2175 }] }
  ];
}

function demoGaps() {
  return [
    { segment_id: "seg_north_ridge_cutoff", name: "North Ridge Cutoff Path", lamp_density_per_100m: 0.3, safety_score: 32.0, rating_count: 8, priority_rank: "HIGH", urgency_score: 76.5, recommended_action: "Install LED street lamps" },
    { segment_id: "seg_univ_main_ave", name: "University Main Avenue", lamp_density_per_100m: 3.8, safety_score: 85.0, rating_count: 24, priority_rank: "LOW", urgency_score: 12.0, recommended_action: "Standard maintenance" }
  ];
}

function demoAuditLogs() {
  return [{ ts: "demo", actor: "demo", action: "VIEW_ACTIVE_ALERTS", target: "alerts/active", status: "DEMO" }];
}

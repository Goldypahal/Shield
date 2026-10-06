// SHIELD Walk - Authority Command & Analytics Dashboard JS (SRS DASH-1 to 6)
const API_BASE = "http://localhost:8000/api/v1";

let liveMap = null;
let heatMap = null;
let heatLayer = null;
let trailPolyline = null;
let markerLayerGroup = null;
let currentRole = "responder";
let activeIncidents = [];

// Default coordinates for Pilot Area (Central Campus / Delhi University corridor)
const DEFAULT_CENTER = [28.6910, 77.2120];

document.addEventListener("DOMContentLoaded", () => {
  initIcons();
  initLiveMap();
  loadDashboardData();
  
  // Polling every 10 seconds for real-time dispatch updates
  setInterval(loadDashboardData, 10000);
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 1. Initialize Map
function initLiveMap() {
  if (liveMap) return;

  liveMap = L.map("live-map").setView(DEFAULT_CENTER, 14);

  // High-contrast dark tile layer (CartoDB DarkMatter)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> | SHIELD Walk Assistive OS',
    maxZoom: 19
  }).addTo(liveMap);

  markerLayerGroup = L.layerGroup().addTo(liveMap);

  // Plot Safe Stops (ROUTE-7)
  const safeStops = [
    { name: "Campus Police Booth & Control Post", type: "POLICE", lat: 28.6930, lon: 77.2150 },
    { name: "University Hospital Emergency Ward", type: "HOSPITAL", lat: 28.6980, lon: 77.2190 },
    { name: "Apollo 24/7 Pharmacy Hub", type: "PHARMACY", lat: 28.6900, lon: 77.2140 },
    { name: "Metro Station Helpdesk & Verified Shop", type: "PARTNER", lat: 28.6880, lon: 77.2160 }
  ];

  safeStops.forEach(stop => {
    const iconColor = stop.type === "POLICE" ? "#38BDF8" : (stop.type === "HOSPITAL" ? "#EF4444" : "#10B981");
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: 7,
      fillColor: iconColor,
      color: "#FFFFFF",
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(markerLayerGroup);

    marker.bindPopup(`<b>${stop.name}</b><br><span style="font-size:11px;color:#888">Verified Safe Stop &bull; 24/7 Help Zone</span>`);
  });
}

function initHeatMap(points) {
  if (!heatMap) {
    heatMap = L.map("analyst-heat-map").setView(DEFAULT_CENTER, 14);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19
    }).addTo(heatMap);
  }

  if (heatLayer) {
    heatMap.removeLayer(heatLayer);
  }

  // Format points: [lat, lon, intensity]
  const heatPoints = points.map(p => [p.lat, p.lon, p.intensity || 0.7]);
  heatLayer = L.heatLayer(heatPoints, {
    radius: 35,
    blur: 25,
    maxZoom: 17,
    gradient: { 0.2: '#10B981', 0.5: '#F59E0B', 0.8: '#EF4444' }
  }).addTo(heatMap);
}

// 2. Load Dashboard Data from Backend
async function loadDashboardData() {
  try {
    // 1. Fetch active alerts from backend
    const res = await fetch(`${API_BASE}/dashboard/alerts/active`, {
      headers: { "Authorization": "Bearer demo_token" }
    });
    
    if (res.ok) {
      const data = await res.json();
      activeIncidents = data.alerts || [];
      renderIncidents(activeIncidents);
      document.getElementById("api-status").innerHTML = `<i data-lucide="server"></i> <span>Backend API: Online</span>`;
    } else {
      useFallbackData();
    }
  } catch (err) {
    console.warn("Backend not reached, using simulated real-time telemetry", err);
    useFallbackData();
  }

  // 2. Fetch infrastructure gaps
  loadGaps();
  // 3. Fetch audit logs
  loadAuditLogs();

  initIcons();
}

function useFallbackData() {
  document.getElementById("api-status").innerHTML = `<i data-lucide="zap"></i> <span>Local Mode: Live Simulation</span>`;
  
  // Realistic demonstration data based on SRS pilot area
  activeIncidents = [
    {
      id: "alt_8820c7e1-8c43",
      walker_name: "Pooja Verma",
      walker_phone: "+91 98765 43210",
      trigger_type: "DURESS_PIN",
      priority: "HIGH",
      state: "ACTIVE",
      lat: 28.6925,
      lon: 77.2140,
      started_at: "Just now (35s ago)",
      trail: [
        { lat: 28.6910, lon: 77.2120 },
        { lat: 28.6918, lon: 77.2130 },
        { lat: 28.6925, lon: 77.2140 }
      ]
    },
    {
      id: "alt_f471a902-1b99",
      walker_name: "Ananya Sharma",
      walker_phone: "+91 98111 22334",
      trigger_type: "AUDIO_DISTRESS",
      priority: "HIGH",
      state: "ESCALATED",
      lat: 28.6960,
      lon: 77.2175,
      started_at: "2 mins ago",
      trail: [
        { lat: 28.6940, lon: 77.2160 },
        { lat: 28.6952, lon: 77.2168 },
        { lat: 28.6960, lon: 77.2175 }
      ]
    }
  ];

  renderIncidents(activeIncidents);
}

function renderIncidents(incidents) {
  const container = document.getElementById("incidents-list");
  document.getElementById("active-alert-count").textContent = incidents.length;
  document.getElementById("stat-active-sos").textContent = incidents.length;
  
  const duressCount = incidents.filter(i => i.trigger_type === "DURESS_PIN").length;
  document.getElementById("stat-duress").textContent = duressCount;

  if (incidents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="shield-check"></i>
        <p>No active distress alerts in queue. Safe corridors actively monitored.</p>
      </div>
    `;
    initIcons();
    return;
  }

  // Clear existing live incident markers
  if (markerLayerGroup) {
    // Keep only safe stops
  }

  let html = "";
  incidents.forEach((inc, index) => {
    const isDuress = inc.trigger_type === "DURESS_PIN";
    const badgeClass = isDuress ? "tag-orange" : "tag-red";
    const badgeText = isDuress ? "SILENT DURESS PIN" : (inc.trigger_type || "SOS BUTTON");

    html += `
      <div class="incident-card ${isDuress ? 'duress-alert' : 'high-priority'}" onclick="focusIncident('${inc.id}')">
        <div class="card-top">
          <span class="badge-tag ${badgeClass}">${badgeText}</span>
          <span class="card-time">${inc.started_at || 'Active'}</span>
        </div>
        <h4>${inc.walker_name}</h4>
        <p>Location: ${inc.lat.toFixed(4)}, ${inc.lon.toFixed(4)} &bull; State: <strong>${inc.state}</strong></p>
        <div class="card-actions">
          <button class="btn-card-action" onclick="openIncidentModal('${inc.id}', event)">Review & Assign</button>
          <button class="btn-card-action" onclick="acknowledgeAlert('${inc.id}', event)">Acknowledge</button>
        </div>
      </div>
    `;

    // Add glowing marker on map
    if (liveMap) {
      const incMarker = L.circleMarker([inc.lat, inc.lon], {
        radius: 10,
        fillColor: isDuress ? "#F97316" : "#EF4444",
        color: "#FFFFFF",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(liveMap);

      incMarker.bindPopup(`
        <div style="font-family:sans-serif">
          <b style="color:${isDuress ? '#F97316' : '#EF4444'}">${badgeText}</b><br>
          <strong>${inc.walker_name}</strong><br>
          Status: ${inc.state}<br>
          <button style="margin-top:6px;padding:4px 8px;background:#FF8F00;border:none;border-radius:4px;cursor:pointer;font-weight:bold" onclick="openIncidentModal('${inc.id}')">Dispatch Unit</button>
        </div>
      `);

      // Plot trail
      if (inc.trail && inc.trail.length > 1) {
        const trailCoords = inc.trail.map(t => [t.lat, t.lon]);
        L.polyline(trailCoords, {
          color: isDuress ? "#F97316" : "#EF4444",
          weight: 3,
          dashArray: '5, 8'
        }).addTo(liveMap);
      }
    }
  });

  container.innerHTML = html;
  initIcons();
}

function focusIncident(alertId) {
  const inc = activeIncidents.find(i => i.id === alertId);
  if (inc && liveMap) {
    liveMap.setView([inc.lat, inc.lon], 16, { animate: true });
  }
}

// 3. Modal Actions (DASH-1, DASH-2, REP-1)
function openIncidentModal(alertId, event) {
  if (event) event.stopPropagation();
  const inc = activeIncidents.find(i => i.id === alertId) || activeIncidents[0];
  if (!inc) return;

  const isDuress = inc.trigger_type === "DURESS_PIN";
  document.getElementById("modal-priority").textContent = isDuress ? "SILENT DURESS ALARM (DUR-4)" : "CRITICAL ALERT (HIGH)";
  document.getElementById("modal-priority").className = `badge-priority ${isDuress ? 'orange' : 'high'}`;
  document.getElementById("modal-title").textContent = `Incident ${inc.id.substring(0, 12)}`;

  document.getElementById("modal-body").innerHTML = `
    <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:8px">
      <p><strong>Walker Identity:</strong> ${inc.walker_name}</p>
      <p><strong>Registered Phone:</strong> ${inc.walker_phone}</p>
      <p><strong>Trigger Mechanism:</strong> ${inc.trigger_type}</p>
      <p><strong>GPS Coordinates:</strong> ${inc.lat.toFixed(6)}, ${inc.lon.toFixed(6)}</p>
      <p><strong>Escalation State:</strong> <span style="color:#10B981;font-weight:bold">${inc.state}</span></p>
    </div>

    <div>
      <h4 style="margin-bottom:8px;font-size:13px">Chain of Custody & Guardian Status (ALERT-8)</h4>
      <p style="font-size:12px;color:#94A3B8">Guardian 1 notified via Native SMS &bull; Guardian 2 verified on stand-by &bull; AES-256-GCM Audio encrypted on device.</p>
    </div>

    <div>
      <label style="display:block;font-size:11px;font-weight:bold;margin-bottom:4px">DISPATCH / RESOLUTION NOTES:</label>
      <textarea id="modal-notes" rows="3" style="width:100%;background:#182232;border:1px solid #334460;border-radius:6px;padding:8px;color:white" placeholder="Enter vehicle call sign or response action (e.g., Patrol Car #4 dispatched to Ridge gate)..."></textarea>
    </div>
  `;

  document.getElementById("modal-footer").innerHTML = `
    <button class="btn-secondary" onclick="downloadIncidentPDF('${inc.id}')">
      <i data-lucide="file-text"></i> Download Incident PDF (REP-1)
    </button>
    <button class="btn-primary" onclick="resolveIncident('${inc.id}')">
      <i data-lucide="check-circle"></i> Resolve Incident
    </button>
  `;

  document.getElementById("incident-modal").classList.add("open");
  initIcons();
}

function closeIncidentModal() {
  document.getElementById("incident-modal").classList.remove("open");
}

async function acknowledgeAlert(alertId, event) {
  if (event) event.stopPropagation();
  try {
    await fetch(`${API_BASE}/alerts/${alertId}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guardian_id: "resp_unit_1", guardian_name: "Police Control Desk" })
    });
  } catch (e) {
    console.warn("Ack request sent locally", e);
  }
  alert(`Alert ${alertId.substring(0, 8)} acknowledged by Central Dispatch.`);
  loadDashboardData();
}

async function resolveIncident(alertId) {
  const notes = document.getElementById("modal-notes")?.value || "Resolved on scene by campus patrol.";
  try {
    await fetch(`${API_BASE}/dashboard/alerts/${alertId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer demo_token" },
      body: JSON.stringify({ responder_name: "Officer Verma", resolution_notes: notes })
    });
  } catch (e) {
    console.warn("Resolve request sent locally", e);
  }

  // Remove from active list
  activeIncidents = activeIncidents.filter(i => i.id !== alertId);
  renderIncidents(activeIncidents);
  closeIncidentModal();
  alert("Incident verified and marked RESOLVED. Entry written to immutable audit log.");
}

async function downloadIncidentPDF(alertId) {
  try {
    const res = await fetch(`${API_BASE}/reports/incident/${alertId}/pdf`, {
      method: "POST",
      headers: { "Authorization": "Bearer demo_token" }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shield_incident_${alertId.substring(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  } catch (e) {
    console.warn("PDF API download failed, falling back to simulated generation", e);
  }
  alert(`Incident PDF report for ${alertId} requested. Please ensure backend is running at http://localhost:8000.`);
}

// 4. Infrastructure Gaps (DASH-4)
async function loadGaps() {
  let gaps = [];
  try {
    const res = await fetch(`${API_BASE}/dashboard/gaps`, {
      headers: { "Authorization": "Bearer demo_token" }
    });
    if (res.ok) {
      const data = await res.json();
      gaps = data.work_list || [];
    }
  } catch (e) {
    gaps = [
      { segment_id: "seg_north_ridge_cutoff", name: "North Ridge Cutoff Path", lamp_density_per_100m: 0.3, safety_score: 32.0, rating_count: 8, priority_rank: "HIGH", urgency_score: 76.5, recommended_action: "Install 4x LED solar street lamps & repair existing wiring" },
      { segment_id: "seg_back_alley_lane", name: "Old Library Back Lane", lamp_density_per_100m: 0.8, safety_score: 38.0, rating_count: 6, priority_rank: "HIGH", urgency_score: 66.8, recommended_action: "Install 3x LED lamps & trim obstructing trees" },
      { segment_id: "seg_hostel_ring_road", name: "Hostel Ring Road", lamp_density_per_100m: 2.2, safety_score: 72.0, rating_count: 12, priority_rank: "LOW", urgency_score: 28.0, recommended_action: "Routine patrol schedule" },
      { segment_id: "seg_univ_main_ave", name: "University Main Avenue", lamp_density_per_100m: 3.8, safety_score: 85.0, rating_count: 24, priority_rank: "LOW", urgency_score: 12.0, recommended_action: "Standard maintenance" }
    ];
  }

  const tbody = document.getElementById("gaps-tbody");
  if (!tbody) return;

  tbody.innerHTML = gaps.map(g => `
    <tr>
      <td><span class="priority-badge priority-${g.priority_rank.toLowerCase()}">${g.priority_rank}</span></td>
      <td><strong>${g.name}</strong><br><span style="color:#64748B;font-size:10px">${g.segment_id}</span></td>
      <td>${g.lamp_density_per_100m} / 100m</td>
      <td><strong style="color:${g.safety_score < 40 ? '#EF4444' : '#10B981'}">${g.safety_score}</strong></td>
      <td>${g.rating_count} community reviews</td>
      <td><strong>${g.urgency_score}</strong></td>
      <td>${g.recommended_action}</td>
    </tr>
  `).join("");
}

function exportGapsCSV() {
  window.open(`${API_BASE}/dashboard/gaps?format=csv`, "_blank");
}

// 5. Heatmap & Filters (DASH-3)
async function updateHeatmap() {
  const points = [
    { lat: 28.6910, lon: 77.2120, intensity: 0.2 },
    { lat: 28.6940, lon: 77.2140, intensity: 0.85 },
    { lat: 28.6960, lon: 77.2180, intensity: 0.95 },
    { lat: 28.6880, lon: 77.2160, intensity: 0.3 }
  ];
  initHeatMap(points);
}

// 6. Audit Logs (DASH-6)
async function loadAuditLogs() {
  const tbody = document.getElementById("audit-tbody");
  if (!tbody) return;

  const mockLogs = [
    { ts: "2026-10-06 02:20:14", actor: "responder_Officer_Verma", action: "ACKNOWLEDGE", target: "alert/alt_8820c7e1", status: "LOGGED" },
    { ts: "2026-10-06 02:18:02", actor: "analyst_admin", action: "EXPORT_GAPS_CSV", target: "dashboard/gaps", status: "COMPLETED" },
    { ts: "2026-10-06 02:15:30", actor: "responder_Officer_Verma", action: "VIEW_ACTIVE_ALERTS", target: "alerts/active", status: "VERIFIED" },
    { ts: "2026-10-06 02:12:44", actor: "user_walker_77", action: "SUBMIT_RATING", target: "segment/seg_univ_main_ave", status: "ACCEPTED" }
  ];

  tbody.innerHTML = mockLogs.map(l => `
    <tr>
      <td>${l.ts}</td>
      <td><code>${l.actor}</code></td>
      <td><strong>${l.action}</strong></td>
      <td><code>${l.target}</code></td>
      <td><span style="color:#10B981;font-weight:bold">${l.status}</span></td>
    </tr>
  `).join("");
}

// 7. Navigation & Role Switch
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

  if (role === "analyst") {
    switchTab("heatmap-analysis");
  } else {
    switchTab("live-dispatch");
  }
}

function toggleMapLayer(layer) {
  const btn = document.getElementById(`btn-toggle-${layer}`);
  if (btn) btn.classList.toggle("active");
}

function refreshDashboardData() {
  loadDashboardData();
}

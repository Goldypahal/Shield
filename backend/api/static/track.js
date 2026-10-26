// Guardian tracking page: polls /api/v1/track/<token> and draws the trail. All text goes in via textContent.
(function () {
  const token = location.pathname.split("/").filter(Boolean)[1] || "";
  const titleEl = document.getElementById("title");
  const statusEl = document.getElementById("status");
  const map = L.map("map").setView([30.7333, 76.7794], 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let fitted = false;

  function setStatus(pillText, ok, text) {
    statusEl.textContent = "";
    const pill = document.createElement("span");
    pill.className = "pill" + (ok ? " ok" : "");
    pill.textContent = pillText;
    statusEl.appendChild(pill);
    statusEl.appendChild(document.createTextNode(text));
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const t = Date.parse(ts.endsWith("Z") || ts.includes("+") ? ts : ts.replace(" ", "T") + "Z");
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
  }

  async function refresh() {
    let data;
    try {
      const res = await fetch(`/api/v1/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) {
        setStatus("Link", false, " This link has expired or is not valid.");
        return false;
      }
      data = await res.json();
    } catch (e) {
      statusEl.textContent = "Connection problem. Retrying…";
      return true;
    }

    const isAlert = data.kind === "alert";
    titleEl.textContent = isAlert ? `${data.name} may need help` : `${data.name}'s ${data.mode === "ride" ? "ride" : "walk"}`;
    if (!data.open) {
      setStatus(isAlert ? "Closed" : "Ended", true, isAlert ? " The alert was closed." : " The trip has ended.");
      layer.clearLayers();
      return false;
    }
    const last = data.trail.length ? data.trail[data.trail.length - 1] : null;
    const detail = isAlert
      ? ` ${String(data.trigger || "SOS").replace(/_/g, " ").toLowerCase()}${last ? ` · last update ${timeAgo(last.ts)}` : ""}`
      : ` to ${data.destination || "destination"}${data.vehicle_plate ? ` · vehicle ${data.vehicle_plate}` : ""}${last ? ` · ${timeAgo(last.ts)}` : ""}`;
    setStatus(isAlert ? "SOS" : "Live", !isAlert, detail);

    layer.clearLayers();
    const pts = [];
    if (data.route && data.route.length) {
      const route = data.route.map((p) => [p.lat, p.lon]);
      L.polyline(route, { color: "#64748B", weight: 5, dashArray: "8 8" }).addTo(layer);
      pts.push(...route);
    }
    if (data.trail.length) {
      const trail = data.trail.map((p) => [p.lat, p.lon]);
      L.polyline(trail, { color: "#FFFFFF", weight: 10 }).addTo(layer);
      L.polyline(trail, { color: isAlert ? "#DC2626" : "#2563EB", weight: 6 }).addTo(layer);
      pts.push(...trail);
    }
    const here = last ? [last.lat, last.lon] : data.start ? [data.start.lat, data.start.lon] : null;
    if (here) {
      L.circleMarker(here, { radius: 10, color: "#FFFFFF", weight: 3, fillColor: isAlert ? "#DC2626" : "#2563EB", fillOpacity: 1 })
        .bindTooltip(`${data.name} (latest)`).addTo(layer);
      pts.push(here);
    }
    if (pts.length && !fitted) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
      fitted = true;
    }
    return true;
  }

  async function loop() {
    if (await refresh()) setTimeout(loop, 10000);
  }
  loop();
})();

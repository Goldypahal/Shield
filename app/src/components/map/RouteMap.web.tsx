import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { RouteMapProps, ROUTE_COLORS, DEFAULT_CENTER, cautionRuns, HAVEN_COLORS, HAZARD_COLOR, riskColor } from './routeMapShared';

// react-native-maps has no web implementation, so the web build draws the same layers with
// Leaflet inside an iframe. The page is static; route data arrives by postMessage, so
// changing the selected route does not reload the tiles.
const LEAFLET_VERSION = '1.9.4';

const MAP_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;background:#E5E7EB}
.leaflet-tile-pane{filter:saturate(.35) brightness(1.04)}
.dark #map{background:#0F1726}
.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) saturate(.3)}
.pin-start{width:14px;height:14px;border-radius:50%;background:${ROUTE_COLORS.start};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.pin-end{width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${ROUTE_COLORS.end};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.pin-haven{width:22px;height:22px;border-radius:6px;border:2px solid #fff;color:#fff;font:700 12px/18px system-ui;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.pin-hazard{width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:18px solid ${HAZARD_COLOR};filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.pin-me{width:16px;height:16px;border-radius:50%;background:#FF5A1F;border:3px solid #fff;box-shadow:0 0 0 6px rgba(255,90,31,.25)}</style>
</head><body><div id="map"></div><script>
var C = ${JSON.stringify(ROUTE_COLORS)};
var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([${DEFAULT_CENTER.lat}, ${DEFAULT_CENTER.lon}], 13);
// Zoom buttons bottom-right: the screen's layer chips sit along the top edge
L.control.zoom({ position: 'bottomright' }).addTo(map);
var layer = L.layerGroup().addTo(map), lastFitKey = '';
// OpenStreetMap tiles need no key (CARTO's now do). Muted so the route stands out; inverted for dark mode.
var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
}).addTo(map);
// Place names come from OpenStreetMap and reports from users: never insert them as HTML
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
var HAVEN_LETTER = { police: 'P', hospital: 'H', pharmacy: 'Rx', fuel: 'F' };
function setTheme(dark) {
  document.body.className = dark ? 'dark' : '';
}
function render(d) {
  setTheme(d.dark);
  layer.clearLayers();
  var all = [];
  if (d.heat) {
    var h = d.heat.cellDeg / 2;
    d.heat.cells.forEach(function (c) {
      L.rectangle([[c.lat - h, c.lon - h], [c.lat + h, c.lon + h]], { stroke: false, fillColor: c.color, fillOpacity: 0.38, interactive: false }).addTo(layer);
    });
  }
  d.alternatives.forEach(function (r) {
    L.polyline(r.coords, { color: C.alternative, weight: 5, opacity: 0.85, dashArray: '8 8', lineCap: 'round' })
      .on('click', function () { parent.postMessage({ shieldRouteMap: 'select', label: r.label }, '*'); })
      .bindTooltip(r.title, { sticky: true }).addTo(layer);
    all = all.concat(r.coords);
  });
  if (d.active) {
    L.polyline(d.active.coords, { color: C.casing, weight: 12, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
    L.polyline(d.active.coords, { color: C.selected, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' })
      .bindTooltip(d.active.title, { sticky: true }).addTo(layer);
    d.caution.forEach(function (run) {
      L.polyline(run, { color: C.caution, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' })
        .bindTooltip('Caution: dark, isolated or higher-risk stretch', { sticky: true }).addTo(layer);
    });
    all = all.concat(d.active.coords);
  }
  if (d.origin) {
    L.marker(d.origin, { icon: L.divIcon({ className: '', html: '<div class="pin-start"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
      .bindTooltip('Start').addTo(layer);
    all.push(d.origin);
  }
  if (d.destination) {
    L.marker(d.destination, { icon: L.divIcon({ className: '', html: '<div class="pin-end"></div>', iconSize: [28, 28], iconAnchor: [14, 30] }) })
      .bindTooltip('Destination').addTo(layer);
    all.push(d.destination);
  }
  (d.hazards || []).forEach(function (z) {
    L.marker([z.lat, z.lon], { icon: L.divIcon({ className: '', html: '<div class="pin-hazard"></div>', iconSize: [20, 18], iconAnchor: [10, 18] }) })
      .bindTooltip('Reported: ' + esc(z.label)).addTo(layer);
  });
  (d.havens || []).forEach(function (p, i) {
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      html: '<div class="pin-haven" style="background:' + esc(p.color) + '">' + esc(HAVEN_LETTER[p.kind] || '?') + '</div>' }) })
      .bindTooltip(esc(p.label))
      .on('click', function () { parent.postMessage({ shieldRouteMap: 'haven', index: i }, '*'); })
      .addTo(layer);
  });
  if (d.me) {
    L.marker(d.me, { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 })
      .bindTooltip('You').addTo(layer);
    if (d.followMe) map.panTo(d.me, { animate: true });
  }
  // Refit only when the trip changes or the user asks, not when another route is picked.
  if (all.length > 1 && d.fitKey !== lastFitKey) {
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
    lastFitKey = d.fitKey;
  }
}
window.addEventListener('message', function (e) {
  if (e.source === parent && e.data && e.data.shieldRouteMap === 'render') render(e.data.payload);
});
parent.postMessage({ shieldRouteMap: 'ready' }, '*');
</script></body></html>`;

export default function RouteMap({ routes, selected, origin, destination, onSelectRoute, onRecenter, extras, onSelectHaven, style }: RouteMapProps) {
  const { colors, isDark } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const onSelectRef = useRef(onSelectRoute);
  onSelectRef.current = onSelectRoute;
  const havenRef = useRef({ havens: extras?.havens, onSelectHaven });
  havenRef.current = { havens: extras?.havens, onSelectHaven };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !e.data) return;
      if (e.data.shieldRouteMap === 'ready') setReady(true);
      if (e.data.shieldRouteMap === 'select') onSelectRef.current?.(e.data.label);
      if (e.data.shieldRouteMap === 'haven') {
        const h = havenRef.current.havens?.[Number(e.data.index)];
        if (h) havenRef.current.onSelectHaven?.(h);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const active = routes.find((r) => r.label === selected) ?? null;
    const titled = (r: (typeof routes)[number]) => ({ label: r.label, coords: r.coords, title: `${r.label} · safety ${r.safety_index}` });
    const payload = {
      dark: isDark,
      active: active ? titled(active) : null,
      alternatives: routes.filter((r) => r !== active).map(titled),
      caution: active ? cautionRuns(active) : [],
      origin: origin ? [origin.lat, origin.lon] : null,
      destination: destination ? [destination.lat, destination.lon] : null,
      fitKey: `${origin?.lat},${origin?.lon}>${destination?.lat},${destination?.lon}#${routes.length}#${fitNonce}`,
      heat: extras?.heat ? { cellDeg: extras.heat.cellDeg, cells: extras.heat.cells.map((c) => ({ lat: c.lat, lon: c.lon, color: riskColor(c.risk) })) } : null,
      havens: (extras?.havens ?? []).map((p) => ({ lat: p.lat, lon: p.lon, kind: p.kind, color: HAVEN_COLORS[p.kind] ?? '#334155',
        label: `${p.name || p.kind} (${p.distance_m} m)${p.open_24_7 ? ' · open 24/7' : ''}` })),
      hazards: (extras?.hazards ?? []).map((z) => ({ lat: z.lat, lon: z.lon, label: z.category.replace(/_/g, ' ') })),
      me: extras?.me ? [extras.me.lat, extras.me.lon] : null,
      followMe: !!extras?.me && routes.length === 0,
    };
    frameRef.current?.contentWindow?.postMessage({ shieldRouteMap: 'render', payload }, '*');
  }, [ready, routes, selected, origin, destination, isDark, fitNonce, extras]);

  return (
    <View style={[styles.container, style]}>
      {React.createElement('iframe', {
        ref: frameRef,
        srcDoc: MAP_PAGE,
        title: 'Route map',
        style: { border: 0, width: '100%', height: '100%', display: 'block' },
      })}
      <TouchableOpacity
        onPress={() => {
          setFitNonce((n) => n + 1);
          onRecenter?.();
        }}
        style={[styles.recenterButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Show whole route"
        activeOpacity={0.8}
      >
        <Ionicons name="scan-outline" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
  },
  recenterButton: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
});

import { MAP_STYLE_URL, NAV_COLORS, INDIA_CENTER } from './navMapShared';

/**
 * The phone map: MapLibre GL JS with OpenFreeMap vector tiles (OpenStreetMap data, free,
 * no API key, no usage limits), running in a WebView. It looks and pans like Google Maps.
 *
 * Why a WebView: the same engine as the web app, so what is tested in a browser is what
 * the phone shows, and it does not depend on a native map SDK build. React Native sends
 * the state with window.__update(...); the page answers with postMessage events
 * (ready, selectRoute, selectPlace, longPress, error).
 */
export const MAPLIBRE_VERSION = '4.7.1';

export function navMapHtml(styleUrl = MAP_STYLE_URL): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e5e7eb; }
  .mk { border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .start { width: 14px; height: 14px; border-radius: 50%; background: ${NAV_COLORS.start}; }
  .me { width: 16px; height: 16px; border-radius: 50%; background: ${NAV_COLORS.me}; box-shadow: 0 0 0 6px rgba(37,99,235,.25); }
  .end { width: 22px; height: 22px; border-radius: 50% 50% 0 50%; transform: rotate(45deg); background: ${NAV_COLORS.end}; }
  #msg { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font: 14px sans-serif; color: #475569; }
  .maplibregl-ctrl-attrib { font-size: 10px; }
</style>
</head><body>
<div id="map"></div><div id="msg">Loading map...</div>
<script>
(function () {
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  if (!window.maplibregl) {
    document.getElementById('msg').textContent = 'The map needs an internet connection.';
    post({ type: 'error', message: 'maplibre-gl did not load (offline?)' });
    return;
  }
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var line = function (coords, props) { return { type: 'Feature', properties: props || {}, geometry: { type: 'LineString', coordinates: coords.map(function (c) { return [c[1], c[0]]; }) } }; };
  var point = function (lat, lon, props) { return { type: 'Feature', properties: props || {}, geometry: { type: 'Point', coordinates: [lon, lat] } }; };
  var circle = function (lat, lon, r) {
    var out = [], dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
    for (var i = 0; i <= 48; i++) { var a = i / 48 * 2 * Math.PI; out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
    return out;
  };
  var map = new maplibregl.Map({
    container: 'map', style: ${JSON.stringify(styleUrl)},
    center: [${INDIA_CENTER.lon}, ${INDIA_CENTER.lat}], zoom: 4,
    attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  var ready = false, pending = null, markers = {}, last = { fitKey: '', recenterKey: 0 }, state = null;

  map.on('error', function (e) { post({ type: 'error', message: String((e && e.error && e.error.message) || e) }); });
  map.on('load', function () {
    document.getElementById('msg').style.display = 'none';
    ['alternatives', 'selected', 'caution', 'incidents', 'places', 'me'].forEach(function (id) { map.addSource(id, { type: 'geojson', data: EMPTY }); });
    var round = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'alt-casing', type: 'line', source: 'alternatives', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    map.addLayer({ id: 'alt-line', type: 'line', source: 'alternatives', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'sel-casing', type: 'line', source: 'selected', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 13 } });
    map.addLayer({ id: 'sel-line', type: 'line', source: 'selected', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 8 } });
    map.addLayer({ id: 'caution-line', type: 'line', source: 'caution', layout: round, paint: { 'line-color': '${NAV_COLORS.caution}', 'line-width': 7, 'line-dasharray': [1.2, 1] } });
    map.addLayer({ id: 'incident-dot', type: 'circle', source: 'incidents', paint: { 'circle-radius': 6, 'circle-color': '${NAV_COLORS.incident}', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'place-dot', type: 'circle', source: 'places', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'me-halo', type: 'fill', source: 'me', paint: { 'fill-color': '${NAV_COLORS.me}', 'fill-opacity': 0.15 } });
    map.on('click', 'alt-line', function (e) { var id = e.features && e.features[0] && e.features[0].properties.id; if (id) post({ type: 'selectRoute', id: String(id) }); });
    map.on('click', 'place-dot', function (e) { var i = e.features && e.features[0] && e.features[0].properties.i; if (i !== undefined) post({ type: 'selectPlace', i: Number(i) }); });
    ready = true;
    post({ type: 'ready' });
    if (pending) apply(pending);
  });

  // Long press drops a destination pin (contextmenu on desktop, a 600 ms hold on touch)
  var pressTimer = null, pressAt = null;
  map.on('contextmenu', function (e) { post({ type: 'longPress', lat: e.lngLat.lat, lon: e.lngLat.lng }); });
  map.on('touchstart', function (e) {
    if (e.originalEvent.touches.length !== 1) return;
    pressAt = e.lngLat;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () { if (pressAt) post({ type: 'longPress', lat: pressAt.lat, lon: pressAt.lng }); pressAt = null; }, 600);
  });
  ['touchend', 'touchmove', 'dragstart', 'zoomstart'].forEach(function (ev) { map.on(ev, function () { clearTimeout(pressTimer); pressAt = null; }); });

  function marker(key, at, anchor) {
    var m = markers[key];
    if (!at) { if (m) { m.remove(); delete markers[key]; } return; }
    if (m) { m.setLngLat([at.lon, at.lat]); return; }
    var el = document.createElement('div');
    el.className = 'mk ' + key;
    markers[key] = new maplibregl.Marker({ element: el, anchor: anchor }).setLngLat([at.lon, at.lat]).addTo(map);
  }

  function bounds(s) {
    var pts = [];
    s.routes.forEach(function (r) { r.coords.forEach(function (c) { pts.push(c); }); });
    if (s.origin) pts.push([s.origin.lat, s.origin.lon]);
    if (s.destination) pts.push([s.destination.lat, s.destination.lon]);
    if (!pts.length) return null;
    var S = 90, N = -90, W = 180, E = -180;
    pts.forEach(function (p) { S = Math.min(S, p[0]); N = Math.max(N, p[0]); W = Math.min(W, p[1]); E = Math.max(E, p[1]); });
    return [[W, S], [E, N]];
  }

  function apply(s) {
    state = s;
    var sel = null;
    s.routes.forEach(function (r) { if (r.id === s.selectedId) sel = r; });
    var set = function (id, data) { var src = map.getSource(id); if (src) src.setData(data); };
    set('alternatives', { type: 'FeatureCollection', features: s.routes.filter(function (r) { return r.id !== s.selectedId; }).map(function (r) { return line(r.coords, { id: r.id, color: r.color || '${NAV_COLORS.alternative}' }); }) });
    set('selected', { type: 'FeatureCollection', features: sel ? [line(sel.coords, { color: sel.color || '${NAV_COLORS.selected}' })] : [] });
    set('caution', { type: 'FeatureCollection', features: (sel ? sel.caution : []).map(function (c) { return line(c.coords); }) });
    set('incidents', { type: 'FeatureCollection', features: s.incidents.map(function (p) { return point(p.lat, p.lon); }) });
    set('places', { type: 'FeatureCollection', features: s.places.map(function (p, i) { return point(p.lat, p.lon, { i: i, color: p.color }); }) });
    set('me', { type: 'FeatureCollection', features: s.me && s.me.accuracy ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(s.me.lat, s.me.lon, s.me.accuracy)] } }] : [] });
    marker('start', s.origin, 'center');
    marker('end', s.destination, 'bottom');
    marker('me', s.me, 'center');
    var pad = { top: s.padding.top, bottom: s.padding.bottom, left: 40, right: 40 };
    if (s.follow && s.me) {
      map.easeTo({ center: [s.me.lon, s.me.lat], zoom: 17, duration: 500 });
    } else if (s.fitKey !== last.fitKey) {
      var b = bounds(s);
      if (b) map.fitBounds(b, { padding: pad, duration: 600, maxZoom: 17 });
      else if (s.me && !last.fitKey) map.jumpTo({ center: [s.me.lon, s.me.lat], zoom: 14 });
    }
    if (s.recenterKey !== last.recenterKey && s.me) map.flyTo({ center: [s.me.lon, s.me.lat], zoom: 16, duration: 600 });
    if (!last.centeredOnMe && s.me && !bounds(s)) { map.jumpTo({ center: [s.me.lon, s.me.lat], zoom: 14 }); last.centeredOnMe = true; }
    last.fitKey = s.fitKey;
    last.recenterKey = s.recenterKey;
  }

  window.__update = function (s) { pending = s; if (ready) apply(s); };
  post({ type: 'boot' });
})();
</script>
</body></html>`;
}

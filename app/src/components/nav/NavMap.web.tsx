import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import maplibregl, { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavMapProps, MAP_STYLE_URL, NAV_COLORS, PLACE_COLORS, circlePolygon, boundsOf, INDIA_CENTER } from './navMapShared';

// The native MapLibre SDK has no web build, so the web app draws the same layers with
// MapLibre GL JS directly in the page (an iframe would break MapLibre's data worker).

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const line = (coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [lon, lat]) },
});
const point = (lat: number, lon: number, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] },
});

function markerEl(kind: 'start' | 'end' | 'me'): HTMLElement {
  const el = document.createElement('div');
  const s = el.style;
  s.border = '3px solid #fff';
  s.boxShadow = '0 1px 4px rgba(0,0,0,.4)';
  if (kind === 'start') { s.width = s.height = '14px'; s.borderRadius = '50%'; s.background = NAV_COLORS.start; }
  if (kind === 'me') { s.width = s.height = '16px'; s.borderRadius = '50%'; s.background = NAV_COLORS.me; s.boxShadow = '0 0 0 6px rgba(37,99,235,.25)'; }
  if (kind === 'end') { s.width = s.height = '22px'; s.borderRadius = '50% 50% 0 50%'; s.transform = 'rotate(45deg)'; s.background = NAV_COLORS.end; }
  return el;
}

export default function NavMap(props: NavMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<Record<string, Marker>>({});
  const handlers = useRef(props);
  handlers.current = props;
  const last = useRef({ fitKey: '', recenterKey: 0 });
  const [loaded, setLoaded] = React.useState(false);

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE_URL,
      center: [INDIA_CENTER.lon, INDIA_CENTER.lat],
      zoom: 4,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-left');
    m.on('load', () => {
      for (const id of ['alternatives', 'selected', 'caution', 'incidents', 'places', 'me']) m.addSource(id, { type: 'geojson', data: EMPTY });
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      m.addLayer({ id: 'alt-casing', type: 'line', source: 'alternatives', layout: round, paint: { 'line-color': NAV_COLORS.casing, 'line-width': 9 } });
      m.addLayer({ id: 'alt-line', type: 'line', source: 'alternatives', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.75 } });
      m.addLayer({ id: 'sel-casing', type: 'line', source: 'selected', layout: round, paint: { 'line-color': NAV_COLORS.casing, 'line-width': 12 } });
      m.addLayer({ id: 'sel-line', type: 'line', source: 'selected', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 8 } });
      m.addLayer({ id: 'caution-line', type: 'line', source: 'caution', layout: round, paint: { 'line-color': NAV_COLORS.caution, 'line-width': 7, 'line-dasharray': [1.2, 1] } });
      m.addLayer({ id: 'incident-dot', type: 'circle', source: 'incidents', paint: { 'circle-radius': 6, 'circle-color': NAV_COLORS.incident, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'place-dot', type: 'circle', source: 'places', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
      m.addLayer({ id: 'me-halo', type: 'fill', source: 'me', paint: { 'fill-color': NAV_COLORS.me, 'fill-opacity': 0.15 } });
      m.on('click', 'alt-line', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) handlers.current.onSelectRoute(String(id));
      });
      m.on('click', 'place-dot', (e) => {
        const i = Number(e.features?.[0]?.properties?.i);
        const p = handlers.current.places[i];
        if (p) handlers.current.onSelectPlace(p);
      });
      for (const l of ['alt-line', 'place-dot']) {
        m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', l, () => { m.getCanvas().style.cursor = ''; });
      }
      // Right-click on desktop, long-press on touch: drop a destination pin
      m.on('contextmenu', (e) => handlers.current.onLongPress({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
      ready.current = true;
      setLoaded(true);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  const { routes, selectedId, origin, destination, places, incidents, me, fitKey, recenterKey, follow, padding } = props;

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const selected = routes.find((r) => r.id === selectedId) ?? null;
    const set = (id: string, data: FC) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    set('alternatives', { type: 'FeatureCollection', features: routes.filter((r) => r.id !== selectedId).map((r) => line(r.coords, { id: r.id, color: r.color ?? NAV_COLORS.alternative })) });
    set('selected', { type: 'FeatureCollection', features: selected ? [line(selected.coords, { color: selected.color ?? NAV_COLORS.selected })] : [] });
    set('caution', { type: 'FeatureCollection', features: (selected?.caution ?? []).map((c) => line(c.coords)) });
    set('incidents', { type: 'FeatureCollection', features: incidents.map((p) => point(p.lat, p.lon)) });
    set('places', { type: 'FeatureCollection', features: places.map((p, i) => point(p.lat, p.lon, { i, color: PLACE_COLORS[p.kind] })) });
    set('me', { type: 'FeatureCollection', features: me?.accuracy ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(me.lat, me.lon, me.accuracy)] } }] : [] });

    const place = (key: 'start' | 'end' | 'me', at: { lat: number; lon: number } | null, anchor: 'center' | 'bottom') => {
      const existing = markers.current[key];
      if (!at) { existing?.remove(); delete markers.current[key]; return; }
      if (existing) existing.setLngLat([at.lon, at.lat]);
      else markers.current[key] = new maplibregl.Marker({ element: markerEl(key), anchor }).setLngLat([at.lon, at.lat]).addTo(m);
    };
    place('start', origin, 'center');
    place('end', destination, 'bottom');
    place('me', me, 'center');

    const pad = { top: padding.top, bottom: padding.bottom, left: 40, right: 40 };
    if (follow && me) {
      m.easeTo({ center: [me.lon, me.lat], zoom: 17, duration: 500 });
    } else if (fitKey !== last.current.fitKey) {
      const b = boundsOf({ routes, origin, destination });
      if (b) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, duration: 600, maxZoom: 17 });
    }
    if (recenterKey !== last.current.recenterKey && me) m.flyTo({ center: [me.lon, me.lat], zoom: 16, duration: 600 });
    last.current = { fitKey, recenterKey };
  }, [loaded, routes, selectedId, origin, destination, places, incidents, me, fitKey, recenterKey, follow, padding.top, padding.bottom]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {React.createElement('div', { ref: container, style: { position: 'absolute', inset: 0 } })}
    </View>
  );
}

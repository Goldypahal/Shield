import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Map, Camera, CameraRef, GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import {
  NavMapProps, MAP_STYLE_URL, NAV_COLORS, PLACE_COLORS, circlePolygon, boundsOf, INDIA_CENTER,
} from './navMapShared';

type FC = GeoJSON.FeatureCollection;

const line = (coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [lon, lat]) },
});

/** Native map: MapLibre with OpenFreeMap tiles (free, no key). */
export default function NavMap(props: NavMapProps) {
  const { routes, selectedId, origin, destination, places, incidents, me, fitKey, recenterKey, follow, padding } = props;
  const camera = useRef<CameraRef>(null);

  const alternatives = useMemo<FC>(() => ({
    type: 'FeatureCollection',
    features: routes.filter((r) => r.id !== selectedId).map((r) => line(r.coords, { id: r.id })),
  }), [routes, selectedId]);
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const selectedFc = useMemo<FC>(() => ({ type: 'FeatureCollection', features: selected ? [line(selected.coords)] : [] }), [selected]);
  const cautionFc = useMemo<FC>(() => ({
    type: 'FeatureCollection', features: (selected?.caution ?? []).map((c) => line(c.coords, { reason: c.reason })),
  }), [selected]);
  const placesFc = useMemo<FC>(() => ({
    type: 'FeatureCollection',
    features: places.map((p, i) => ({
      type: 'Feature', properties: { i, color: PLACE_COLORS[p.kind] }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  }), [places]);
  const incidentsFc = useMemo<FC>(() => ({
    type: 'FeatureCollection',
    features: incidents.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  }), [incidents]);
  const meFc = useMemo<FC>(() => ({
    type: 'FeatureCollection',
    features: me && me.accuracy ? [{
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(me.lat, me.lon, me.accuracy)] },
    }] : [],
  }), [me]);

  // Fit the camera to new routes
  useEffect(() => {
    const b = boundsOf({ routes, origin, destination });
    if (!b || follow) return;
    camera.current?.fitBounds(b, { padding: { top: padding.top, bottom: padding.bottom, left: 40, right: 40 }, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Fly back to the user
  useEffect(() => {
    if (recenterKey && me) camera.current?.flyTo({ center: [me.lon, me.lat], zoom: 16, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // Follow the user during a trip
  useEffect(() => {
    if (follow && me) camera.current?.easeTo({ center: [me.lon, me.lat], zoom: 17, duration: 500 });
  }, [follow, me?.lat, me?.lon]);

  const start = origin;

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE_URL}
      attribution
      attributionPosition={{ bottom: padding.bottom + 4, left: 8 }}
      logo={false}
      compass
      compassPosition={{ top: padding.top + 8, right: 12 }}
      onLongPress={(e) => props.onLongPress({ lat: e.nativeEvent.lngLat[1], lon: e.nativeEvent.lngLat[0] })}
    >
      <Camera ref={camera} initialViewState={{ center: me ? [me.lon, me.lat] : [INDIA_CENTER.lon, INDIA_CENTER.lat], zoom: me ? 14 : 4 }} />

      <GeoJSONSource
        id="alternatives"
        data={alternatives}
        onPress={(e) => {
          const id = e.nativeEvent.features?.[0]?.properties?.id;
          if (typeof id === 'string') props.onSelectRoute(id);
        }}
      >
        <Layer id="alt-casing" type="line" style={{ lineColor: NAV_COLORS.casing, lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
        <Layer id="alt-line" type="line" style={{ lineColor: NAV_COLORS.alternative, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
      </GeoJSONSource>

      <GeoJSONSource id="selected" data={selectedFc}>
        <Layer id="sel-casing" type="line" style={{ lineColor: NAV_COLORS.casing, lineWidth: 12, lineCap: 'round', lineJoin: 'round' }} />
        <Layer id="sel-line" type="line" style={{ lineColor: NAV_COLORS.selected, lineWidth: 7, lineCap: 'round', lineJoin: 'round' }} />
      </GeoJSONSource>

      <GeoJSONSource id="caution" data={cautionFc}>
        <Layer id="caution-line" type="line" style={{ lineColor: NAV_COLORS.caution, lineWidth: 7, lineCap: 'round', lineJoin: 'round', lineDasharray: [1.2, 1] }} />
      </GeoJSONSource>

      <GeoJSONSource id="incidents" data={incidentsFc}>
        <Layer id="incident-dot" type="circle" style={{ circleRadius: 6, circleColor: NAV_COLORS.incident, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2 }} />
      </GeoJSONSource>

      <GeoJSONSource
        id="places"
        data={placesFc}
        onPress={(e) => {
          const i = e.nativeEvent.features?.[0]?.properties?.i;
          if (typeof i === 'number' && places[i]) props.onSelectPlace(places[i]);
        }}
      >
        <Layer id="place-dot" type="circle" style={{ circleRadius: 8, circleColor: ['get', 'color'], circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2.5 }} />
      </GeoJSONSource>

      <GeoJSONSource id="me-accuracy" data={meFc}>
        <Layer id="me-halo" type="fill" style={{ fillColor: NAV_COLORS.me, fillOpacity: 0.15 }} />
      </GeoJSONSource>

      {start && (
        <Marker lngLat={[start.lon, start.lat]} anchor="center">
          <View style={[styles.dot, { backgroundColor: NAV_COLORS.start }]} />
        </Marker>
      )}
      {destination && (
        <Marker lngLat={[destination.lon, destination.lat]} anchor="bottom">
          <View style={styles.pin} />
        </Marker>
      )}
      {me && (
        <Marker lngLat={[me.lon, me.lat]} anchor="center">
          <View style={styles.meOuter}><View style={styles.meInner} /></View>
        </Marker>
      )}
    </Map>
  );
}

const styles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF' },
  pin: {
    width: 24, height: 24, borderRadius: 12, borderBottomRightRadius: 0, transform: [{ rotate: '45deg' }],
    backgroundColor: NAV_COLORS.end, borderWidth: 3, borderColor: '#FFFFFF', marginBottom: 6,
  },
  meOuter: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(37,99,235,0.25)', alignItems: 'center', justifyContent: 'center' },
  meInner: { width: 16, height: 16, borderRadius: 8, backgroundColor: NAV_COLORS.me, borderWidth: 3, borderColor: '#FFFFFF' },
});

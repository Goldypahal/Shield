import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, Polygon, LatLng } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { RouteMapProps, ROUTE_COLORS, DEFAULT_CENTER, cautionRuns, HAVEN_COLORS, HAZARD_COLOR, riskColor } from './routeMapShared';
import { HAVEN_LABELS, HAZARD_LABELS } from '../../services/safetyService';

const toLatLng = ([latitude, longitude]: [number, number]): LatLng => ({ latitude, longitude });

/** Native map (react-native-maps). The web build uses RouteMap.web.tsx instead. */
export default function RouteMap({ routes, selected, origin, destination, onSelectRoute, onRecenter, extras, onSelectHaven, style }: RouteMapProps) {
  const { colors, isDark } = useTheme();
  const mapRef = useRef<MapView>(null);

  const active = routes.find((r) => r.label === selected) ?? null;
  const alternatives = routes.filter((r) => r !== active);

  const fitAll = () => {
    const points = routes.flatMap((r) => r.coords.map(toLatLng));
    if (origin) points.push({ latitude: origin.lat, longitude: origin.lon });
    if (destination) points.push({ latitude: destination.lat, longitude: destination.lon });
    if (points.length > 1) {
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 60, right: 50, bottom: 60, left: 50 },
        animated: true,
      });
    }
  };

  useEffect(fitAll, [routes, origin, destination]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: DEFAULT_CENTER.lat,
          longitude: DEFAULT_CENTER.lon,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        onMapReady={fitAll}
      >
        {extras?.heat?.cells.map((c, i) => {
          const h = extras.heat!.cellDeg / 2;
          return (
            <Polygon
              key={`heat-${i}`}
              coordinates={[
                { latitude: c.lat - h, longitude: c.lon - h }, { latitude: c.lat - h, longitude: c.lon + h },
                { latitude: c.lat + h, longitude: c.lon + h }, { latitude: c.lat + h, longitude: c.lon - h },
              ]}
              fillColor={riskColor(c.risk).replace('hsl(', 'hsla(').replace(')', ', 0.38)')}
              strokeWidth={0}
              zIndex={0}
            />
          );
        })}

        {alternatives.map((r) => (
          <Polyline
            key={`alt-${r.label}`}
            coordinates={r.coords.map(toLatLng)}
            strokeColor={ROUTE_COLORS.alternative}
            strokeWidth={4}
            lineDashPattern={[8, 6]}
            lineCap="round"
            lineJoin="round"
            tappable
            onPress={() => onSelectRoute?.(r.label)}
            zIndex={1}
          />
        ))}

        {active && (
          <>
            <Polyline
              coordinates={active.coords.map(toLatLng)}
              strokeColor={ROUTE_COLORS.casing}
              strokeWidth={11}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
            <Polyline
              coordinates={active.coords.map(toLatLng)}
              strokeColor={ROUTE_COLORS.selected}
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              zIndex={3}
            />
            {cautionRuns(active).map((run, i) => (
              <Polyline
                key={`caution-${i}`}
                coordinates={run.map(toLatLng)}
                strokeColor={ROUTE_COLORS.caution}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
                zIndex={4}
              />
            ))}
          </>
        )}

        {extras?.hazards?.map((z, i) => (
          <Marker key={`hz-${i}`} coordinate={{ latitude: z.lat, longitude: z.lon }} title={HAZARD_LABELS[z.category] ?? 'Report'}>
            <Ionicons name="warning" size={22} color={HAZARD_COLOR} />
          </Marker>
        ))}
        {extras?.havens?.map((p, i) => (
          <Marker
            key={`hv-${i}`}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            title={p.name || HAVEN_LABELS[p.kind]}
            description={`${HAVEN_LABELS[p.kind]} · ${p.distance_m} m${p.open_24_7 ? ' · open 24/7' : ''}`}
            onCalloutPress={() => onSelectHaven?.(p)}
          >
            <View style={[styles.haven, { backgroundColor: HAVEN_COLORS[p.kind] ?? '#334155' }]}>
              <Ionicons name={p.kind === 'police' ? 'shield' : p.kind === 'hospital' ? 'medkit' : p.kind === 'pharmacy' ? 'bandage' : 'car'} size={12} color="#FFFFFF" />
            </View>
          </Marker>
        ))}
        {origin && (
          <Marker coordinate={{ latitude: origin.lat, longitude: origin.lon }} anchor={{ x: 0.5, y: 0.5 }} title="Start">
            <View style={[styles.startDot, { backgroundColor: ROUTE_COLORS.start }]} />
          </Marker>
        )}
        {destination && (
          <Marker coordinate={{ latitude: destination.lat, longitude: destination.lon }} title="Destination">
            <Ionicons name="location" size={34} color={ROUTE_COLORS.end} />
          </Marker>
        )}
      </MapView>

      <TouchableOpacity
        onPress={() => {
          fitAll();
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
  haven: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#FFFFFF',
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

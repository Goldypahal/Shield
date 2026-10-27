import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Animated, Platform, Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { ensureLocationReady, getBestLocation, LocationReadiness } from '../services/locationService';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useI18n, StringKey } from '../i18n';
import NavMap from '../components/nav/NavMap';
import PlaceSearch from '../components/nav/PlaceSearch';
import RouteCard from '../components/nav/RouteCard';
import TripPanel from '../components/map/TripPanel';
import ReportHazardModal from '../components/map/ReportHazardModal';
import { callNumber } from '../components/common/HelplineRow';
import { PLACE_COLORS, PLACE_ICONS } from '../components/nav/navMapShared';
import {
  ALL_MODES, FREE_MODES, NavPlace, NavPlan, Place247, SortKey, TravelMode, getCapabilities, planNav, sortRoutes,
  toPlannedRoute, formatKm, navErrorMessage, TIER_COLORS,
} from '../services/navService';
import type { LatLon } from '../services/routeService';

interface NavigationScreenProps {
  onBack?: () => void;
}

type Endpoint = { name: string; point: LatLon } | null; // null start = my location

const MODE_ICONS: Record<TravelMode, keyof typeof Ionicons.glyphMap> = {
  walk: 'walk', bicycle: 'bicycle', two_wheeler: 'speedometer', car: 'car', transit: 'bus',
};
const MODE_LABELS: Record<TravelMode, StringKey> = {
  walk: 'nav.mode.walk', bicycle: 'nav.mode.bicycle', two_wheeler: 'nav.mode.twoWheeler', car: 'nav.mode.car', transit: 'nav.mode.transit',
};

/**
 * All-India navigation, laid out like Google Maps: search on top, map underneath, routes in
 * a bottom sheet. Every alternative is scored for safety and can be sorted by safest,
 * shortest or fastest; the 24x7 places along each route are listed and drawn on the map.
 */
export default function NavigationScreen({ onBack }: NavigationScreenProps) {
  const { colors, typography, radii } = useTheme();
  const { t, lang } = useI18n();

  const [me, setMe] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [locationProblem, setLocationProblem] = useState<LocationReadiness | null>(null);
  const [locationRetry, setLocationRetry] = useState(0);
  const [start, setStart] = useState<Endpoint>(null);
  const [dest, setDest] = useState<Endpoint>(null);
  const [searchFor, setSearchFor] = useState<'start' | 'dest' | null>(null);
  const [mode, setMode] = useState<TravelMode>('walk');
  const [modes, setModes] = useState<TravelMode[]>(FREE_MODES);
  const [plan, setPlan] = useState<NavPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('safest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [place, setPlace] = useState<Place247 | null>(null);
  const [tripActive, setTripActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hazardOpen, setHazardOpen] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [topH, setTopH] = useState(150);
  const [sheetH, setSheetH] = useState(0);
  const planSeq = useRef(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }),
      Animated.delay(2600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }),
    ]).start(() => setToast(null));
  }, [toastOpacity]);

  // Live position: a quick first fix (never hangs indoors), then GPS tracking at the best
  // accuracy the phone offers (GPS + Wi-Fi + cell; often 3-5 m outdoors)
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const ready = await ensureLocationReady();
      if (ready !== 'ok') { setLocationDenied(true); setLocationProblem(ready); return; }
      setLocationDenied(false);
      setLocationProblem(null);
      const first = await getBestLocation(10000);
      if (first && !cancelled) setMe((prev) => prev ?? { lat: first.latitude, lon: first.longitude, accuracy: first.accuracy });
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 2, timeInterval: 2000 },
          (p) => setMe({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
        );
        if (cancelled) sub.remove();
      } catch (e) {
        console.warn('[nav] location watch failed', e);
      }
      if (!first && !cancelled) showToast('Still looking for your location. Move near a window, or pick a start point.');
    })();
    getCapabilities().then((c) => setModes(c.modes)).catch(() => undefined);
    return () => { cancelled = true; sub?.remove(); };
  }, [locationRetry]);

  const origin: LatLon | null = start?.point ?? (me ? { lat: me.lat, lon: me.lon } : null);

  // Re-plan whenever both ends or the travel mode change, like a maps app
  useEffect(() => {
    if (!origin || !dest) return;
    const id = ++planSeq.current;
    setLoading(true);
    setError(null);
    planNav(origin, dest.point, mode, lang)
      .then((p) => {
        if (id !== planSeq.current) return;
        setPlan(p);
        const first = sortRoutes(p.routes, sort)[0];
        setSelectedId(first?.id ?? null);
        setExpanded(false);
      })
      .catch((e: any) => {
        if (id !== planSeq.current) return;
        setPlan(null);
        setError(navErrorMessage(e) ?? t('nav.error'));
      })
      .finally(() => { if (id === planSeq.current) setLoading(false); });
    // Only the start that the user chose triggers a re-plan, not every GPS update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start?.point.lat, start?.point.lon, !!me, dest?.point.lat, dest?.point.lon, mode, lang, retryKey]);

  const routes = useMemo(() => (plan ? sortRoutes(plan.routes, sort) : []), [plan, sort]);
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0] ?? null;

  const changeSort = (k: SortKey) => {
    setSort(k);
    if (plan) setSelectedId(sortRoutes(plan.routes, k)[0]?.id ?? null);
  };

  const pickPlace = (p: NavPlace | 'me') => {
    const endpoint: Endpoint = p === 'me' ? null : { name: p.name, point: { lat: p.lat!, lon: p.lon! } };
    if (searchFor === 'start') setStart(endpoint);
    else if (endpoint) setDest(endpoint);
    setSearchFor(null);
  };

  const swap = () => {
    if (!dest) return;
    const newStart = dest;
    const newDest = start ?? (me ? { name: t('nav.myLocation'), point: { lat: me.lat, lon: me.lon } } : null);
    setStart(newStart);
    setDest(newDest);
  };

  // Every alternative is drawn in its safety-tier colour (safest green, medium amber, most
  // vulnerable red; others grey), the selected one on top and thicker
  const mapRoutes = useMemo(() => routes.map((r) => ({
    id: r.id, coords: r.coords, caution: r.safety.caution, color: TIER_COLORS[r.tier ?? 'other'],
  })), [routes]);
  // Re-fit when the plan changes and when the sheet settles or opens, so routes are never hidden under it
  const fitKey = plan ? `${plan.routes.map((r) => r.id + r.distance_m).join('|')}:${Math.round(sheetH / 40)}` : '';

  // ------------------------------------------------------------------ trip mode
  if (tripActive && selected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <NavMap
          routes={[{ id: selected.id, coords: selected.coords, caution: selected.safety.caution, color: TIER_COLORS[selected.tier ?? 'other'] }]}
          selectedId={selected.id}
          origin={null}
          destination={dest?.point ?? null}
          places={selected.safety.places_247}
          incidents={selected.safety.incident_reports}
          me={me}
          fitKey={`trip-${selected.id}`}
          recenterKey={recenterKey}
          follow
          padding={{ top: 40, bottom: 260 }}
          onSelectRoute={() => undefined}
          onSelectPlace={setPlace}
          onLongPress={() => undefined}
        />
        <View style={styles.tripPanel}>
          <TripPanel
            route={toPlannedRoute(selected)}
            destinationName={dest?.name ?? ''}
            mode={mode === 'walk' ? 'walk' : 'ride'}
            vehiclePlate={null}
            onPosition={() => undefined}
            onEnded={(msg) => { setTripActive(false); if (msg) showToast(msg); }}
          />
        </View>
      </View>
    );
  }

  // ------------------------------------------------------------------ planning mode
  const field = (which: 'start' | 'dest', icon: React.ReactNode, label: string, placeholder: string) => (
    <TouchableOpacity
      onPress={() => setSearchFor(which)}
      style={[styles.field, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.md }]}
      accessibilityRole="button"
      accessibilityLabel={`${which === 'start' ? t('nav.from') : t('nav.to')}: ${label || placeholder}`}
    >
      {icon}
      <Text style={[typography.bodyLarge, { color: label ? colors.textPrimary : colors.textMuted, flex: 1 }]} numberOfLines={1}>
        {label || placeholder}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <NavMap
        routes={mapRoutes}
        selectedId={selected?.id ?? null}
        origin={start?.point ?? null}
        destination={dest?.point ?? null}
        places={selected?.safety.places_247 ?? []}
        incidents={selected?.safety.incident_reports ?? []}
        me={me}
        fitKey={fitKey}
        recenterKey={recenterKey}
        follow={false}
        padding={{ top: topH + 10, bottom: sheetH + 10 }}
        onSelectRoute={(id) => { setSelectedId(id); setExpanded(true); }}
        onSelectPlace={setPlace}
        onLongPress={(p) => setDest({ name: `${t('nav.droppedPin')} (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`, point: p })}
      />

      {/* Search card + travel modes */}
      <View style={styles.top} onLayout={(e) => setTopH(e.nativeEvent.layout.height)} pointerEvents="box-none">
        <View style={[styles.searchCard, { backgroundColor: colors.surface, borderRadius: radii.lg }]}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1, gap: 8 }}>
            {field('start', <View style={[styles.startDot, { borderColor: '#2563EB' }]} />,
              start?.name ?? (me ? t('nav.myLocation') : locationDenied ? '' : t('nav.locating')), t('nav.from'))}
            {field('dest', <Ionicons name="location" size={18} color="#DC2626" />, dest?.name ?? '', t('nav.to'))}
          </View>
          <TouchableOpacity onPress={swap} style={styles.swap} accessibilityRole="button" accessibilityLabel={t('nav.swap')}>
            <Ionicons name="swap-vertical" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
          {ALL_MODES.map((m) => {
            const available = modes.includes(m);
            const on = m === mode;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => (available ? setMode(m) : showToast(t('nav.mode.unavailable')))}
                style={[styles.modeChip, {
                  backgroundColor: on ? colors.brandAccent : colors.surface,
                  borderColor: on ? colors.brandAccent : colors.border, opacity: available ? 1 : 0.5,
                }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !available }}
              >
                <Ionicons name={MODE_ICONS[m]} size={16} color={on ? '#FFFFFF' : colors.textPrimary} />
                <Text style={[typography.bodyMedium, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '600' }]}>{t(MODE_LABELS[m])}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {locationDenied && !start && (
          <TouchableOpacity
            onPress={() => (locationProblem === 'blocked' ? Linking.openSettings() : setLocationRetry((k) => k + 1))}
            accessibilityRole="button"
          >
            <Text style={[typography.bodySmall, styles.notice, { backgroundColor: colors.statusWarningBg, color: colors.textPrimary }]}>
              {locationProblem === 'services_off' ? 'Location is off on this phone. Tap to turn it on.'
                : locationProblem === 'blocked' ? 'Location permission is blocked. Tap to open Settings and allow it.'
                : `${t('nav.locationOff')} Tap to allow.`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Map buttons (hidden while the route list is open, as in Google Maps) */}
      {!expanded && <View style={[styles.mapButtons, { bottom: sheetH + 12 }]} pointerEvents="box-none">
        {me?.accuracy != null && (
          <View style={[styles.accuracy, { backgroundColor: colors.surface }]}>
            <View style={[styles.accDot, { backgroundColor: me.accuracy <= 10 ? '#16A34A' : me.accuracy <= 30 ? '#D97706' : '#DC2626' }]} />
            <Text style={[typography.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]}>{t('nav.accuracy', { m: Math.round(me.accuracy) })}</Text>
          </View>
        )}
        <TouchableOpacity onPress={() => setHazardOpen(true)} style={[styles.roundBtn, { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel={t('nav.reportHazard')}>
          <Ionicons name="flag" size={20} color="#EA580C" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setRecenterKey((k) => k + 1)} style={[styles.roundBtn, { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel={t('nav.recenter')}>
          <Ionicons name="locate" size={22} color="#2563EB" />
        </TouchableOpacity>
      </View>}

      {/* Bottom sheet */}
      {(loading || error || plan) && (
        <View
          style={[styles.sheet, { backgroundColor: colors.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }]}
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity onPress={() => setExpanded((x) => !x)} style={styles.handleArea} accessibilityRole="button"
            accessibilityLabel={expanded ? t('nav.showLess') : t('nav.showAll')}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </TouchableOpacity>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandAccent} />
              <Text style={[typography.bodyMedium, { color: colors.textSecondary }]}>{t('nav.loading')}</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={[typography.bodyMedium, { color: colors.sosPrimary, textAlign: 'center' }]}>{error}</Text>
              <TouchableOpacity onPress={() => setRetryKey((k) => k + 1)} style={[styles.retryBtn, { borderColor: colors.border }]}
                accessibilityRole="button" accessibilityLabel="Try again">
                <Ionicons name="refresh" size={16} color={colors.textPrimary} />
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : routes.length === 0 ? (
            <View style={styles.center}>
              <Text style={[typography.bodyMedium, { color: colors.textSecondary }]}>{t('nav.noRoutes')}</Text>
            </View>
          ) : (
            <>
              <View style={[styles.tabs, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.md }]}>
                {(['safest', 'shortest', 'fastest'] as SortKey[]).map((k) => (
                  <TouchableOpacity
                    key={k}
                    onPress={() => changeSort(k)}
                    style={[styles.tab, sort === k && { backgroundColor: colors.surface, borderRadius: radii.sm }]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: sort === k }}
                  >
                    <Text style={[typography.bodyMedium, { color: sort === k ? colors.brandAccent : colors.textSecondary, fontWeight: '700' }]}>
                      {t(`nav.sort.${k}` as StringKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {routes.length > 1 && (
                <View style={styles.legend}>
                  {(['safest', 'medium', 'vulnerable'] as const).filter((k) => routes.some((r) => r.tier === k)).map((k) => (
                    <TouchableOpacity
                      key={k}
                      onPress={() => { const r = routes.find((x) => x.tier === k); if (r) { setSelectedId(r.id); setExpanded(true); } }}
                      style={styles.legendItem}
                      accessibilityRole="button"
                    >
                      <View style={[styles.legendSwatch, { backgroundColor: TIER_COLORS[k] }]} />
                      <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '700' }]}>{t(`nav.badge.${k}` as StringKey)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <ScrollView style={{ maxHeight: expanded ? 460 : 190 }} contentContainerStyle={{ paddingBottom: 6 }}>
                {(expanded ? routes : routes.filter((r) => r.id === selected?.id)).map((r) => (
                  <RouteCard
                    key={r.id}
                    route={r}
                    selected={r.id === selected?.id}
                    expanded={expanded && r.id === selected?.id}
                    onPress={() => { setSelectedId(r.id); setExpanded(true); }}
                    onStart={() => setTripActive(true)}
                    onPlace={setPlace}
                  />
                ))}
              </ScrollView>
              {!expanded && routes.length > 1 && (
                <TouchableOpacity onPress={() => setExpanded(true)} accessibilityRole="button">
                  <Text style={[typography.button, { color: colors.brandAccent, textAlign: 'center', paddingVertical: 4 }]}>
                    {t('nav.showAll')} ({routes.length})
                  </Text>
                </TouchableOpacity>
              )}
              <Text style={[typography.caption, { color: colors.textMuted, textAlign: 'center', marginTop: 4 }]}>
                {plan?.attribution ?? t('nav.dataNote')}
              </Text>
            </>
          )}
        </View>
      )}

      {/* A tapped 24x7 place */}
      {place && (
        <View style={[styles.placeCard, { backgroundColor: colors.surface, bottom: sheetH + 70, borderRadius: radii.lg }]}>
          <View style={[styles.placeIcon, { backgroundColor: PLACE_COLORS[place.kind] }]}>
            <Ionicons name={PLACE_ICONS[place.kind] as any} size={18} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typography.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>
              {place.name || t(`nav.place.${place.kind}` as StringKey)}
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
              {place.open_247 ? `${t('common.allDay')} · ` : ''}{t('nav.offRoute', { m: place.distance_from_route_m })} · {formatKm(place.along_m)}
            </Text>
          </View>
          {place.phone ? (
            <TouchableOpacity onPress={() => callNumber(place.phone)} style={[styles.roundBtn, { backgroundColor: colors.statusSuccess }]}
              accessibilityRole="button" accessibilityLabel={t('common.callNumber', { number: place.phone })}>
              <Ionicons name="call" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => { setDest({ name: place.name || t(`nav.place.${place.kind}` as StringKey), point: { lat: place.lat, lon: place.lon } }); setPlace(null); }}
            style={[styles.roundBtn, { backgroundColor: colors.brandAccent }]} accessibilityRole="button" accessibilityLabel={t('nav.navigateHere')}
          >
            <Ionicons name="navigate" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPlace(null)} style={styles.closePlace} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {toast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity, bottom: sheetH + 20 }]}>
          <Text style={[typography.bodyMedium, { color: '#FFFFFF' }]}>{toast}</Text>
        </Animated.View>
      )}

      <PlaceSearch
        visible={searchFor !== null}
        title={searchFor === 'start' ? t('nav.from') : t('nav.to')}
        near={origin}
        allowMyLocation={searchFor === 'start'}
        onPick={pickPlace}
        onClose={() => setSearchFor(null)}
      />
      <ReportHazardModal
        visible={hazardOpen}
        at={me ? { lat: me.lat, lon: me.lon } : null}
        onClose={(sent) => { setHazardOpen(false); if (sent) showToast(t('nav.reportHazard')); }}
      />
    </View>
  );
}

const shadow = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
};

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4, paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 18, height: 6, borderRadius: 3 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10 },
  container: { flex: 1, overflow: 'hidden' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 10 },
  searchCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, padding: 10, gap: 6, ...shadow },
  back: { padding: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  startDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 4, marginHorizontal: 2 },
  swap: { padding: 8 },
  modes: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, ...shadow },
  notice: { marginHorizontal: 12, padding: 10, borderRadius: 10 },
  mapButtons: { position: 'absolute', right: 12, alignItems: 'flex-end', gap: 10 },
  accuracy: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, ...shadow },
  accDot: { width: 8, height: 8, borderRadius: 4 },
  roundBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', ...shadow },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 8, ...shadow },
  handleArea: { alignItems: 'center', paddingVertical: 8 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  tabs: { flexDirection: 'row', padding: 4, marginBottom: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  placeCard: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, ...shadow },
  placeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  closePlace: { padding: 4 },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(15,23,42,0.92)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  tripPanel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

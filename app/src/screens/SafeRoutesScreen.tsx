import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert as RNAlert,
  Keyboard,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import RouteMap from '../components/map/RouteMap';
import { ROUTE_COLORS, DEFAULT_CENTER, MapExtras } from '../components/map/routeMapShared';
import TripPanel from '../components/map/TripPanel';
import ReportHazardModal from '../components/map/ReportHazardModal';
import { Hazard, HeatCell, SafeHaven, HAVEN_LABELS, fetchHeatmap, listHazards, nearbyHavens } from '../services/safetyService';
import {
  LatLon,
  Landmark,
  PlannedRoute,
  RouteLabel,
  ROUTE_TITLES,
  fetchLandmarks,
  planRoutes,
  parseLatLon,
  isInCoverage,
  isCautionSegment,
  formatDistance,
  formatDuration,
} from '../services/routeService';

interface SafeRoutesScreenProps {
  onBack: () => void;
}

const MY_LOCATION = 'My location';
type Field = 'from' | 'to';
type TravelMode = 'walk' | 'ride';
const PLATE_RE = /^[A-Z0-9][A-Z0-9 -]{3,14}$/;

export default function SafeRoutesScreen({ onBack }: SafeRoutesScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();

  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [focused, setFocused] = useState<Field | null>(null);
  const [gps, setGps] = useState<LatLon | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);

  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [selected, setSelected] = useState<RouteLabel | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TravelMode>('walk');
  const [plate, setPlate] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [tripActive, setTripActive] = useState(false);
  const [me, setMe] = useState<LatLon | null>(null);
  const [showHavens, setShowHavens] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [heatHour, setHeatHour] = useState(() => new Date().getHours());
  const [havens, setHavens] = useState<SafeHaven[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [heat, setHeat] = useState<{ cells: HeatCell[]; cellDeg: number } | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchLandmarks()
      .then(setLandmarks)
      .catch((e) => console.warn('Landmarks unavailable', e));

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGps(here);
        setMe(here);
        // Routing data covers the Tricity only; outside it the user picks a start point.
        if (isInCoverage(here)) setFromText((t) => t || MY_LOCATION);
      } catch (e) {
        console.warn('Current position unavailable', e);
      }
    })();
  }, []);

  // Layers follow what is on screen: the walker during a trip, the planned route while
  // planning (centred between start and destination), otherwise the walker or the city centre
  const planned = origin && destination && routes.length > 0;
  const layerCenter: LatLon = tripActive && me ? me
    : planned ? { lat: (origin!.lat + destination!.lat) / 2, lon: (origin!.lon + destination!.lon) / 2 }
    : me ?? origin ?? DEFAULT_CENTER;
  const layerRadiusKm = planned && !tripActive
    ? Math.min(15, Math.max(3, Math.hypot((origin!.lat - destination!.lat) * 111, (origin!.lon - destination!.lon) * 96) / 2 + 1))
    : 4;
  useEffect(() => {
    if (!showHavens) return setHavens([]);
    nearbyHavens(layerCenter, layerRadiusKm).then(setHavens).catch(() => setNotice('Safe places could not be loaded.'));
  }, [showHavens, layerCenter.lat, layerCenter.lon, layerRadiusKm]);
  useEffect(() => {
    if (!showReports) return setHazards([]);
    listHazards(layerCenter, 10).then(setHazards).catch(() => setNotice('Reports could not be loaded.'));
  }, [showReports, layerCenter.lat, layerCenter.lon]);
  useEffect(() => {
    if (!showHeat) return setHeat(null);
    fetchHeatmap(heatHour).then(setHeat).catch(() => setNotice('The safety heatmap could not be loaded.'));
  }, [showHeat, heatHour]);

  const extras: MapExtras = useMemo(
    () => ({ havens, hazards, heat, me: tripActive ? me : null }),
    [havens, hazards, heat, me, tripActive]
  );

  const suggestions = useMemo(() => {
    if (!focused) return [];
    const q = (focused === 'from' ? fromText : toText).trim().toLowerCase();
    const matches = landmarks.filter((l) => !q || l.name.toLowerCase().includes(q)).slice(0, 5);
    const offerGps = focused === 'from' && gps && isInCoverage(gps) && fromText !== MY_LOCATION;
    return offerGps ? [{ name: MY_LOCATION, ...gps! }, ...matches] : matches;
  }, [focused, fromText, toText, landmarks, gps]);

  const resolve = (text: string): LatLon | null => {
    const t = text.trim();
    if (!t) return null;
    if (t === MY_LOCATION) return gps;
    const typed = parseLatLon(t);
    if (typed) return typed;
    const q = t.toLowerCase();
    return landmarks.find((l) => l.name.toLowerCase() === q) ?? landmarks.find((l) => l.name.toLowerCase().includes(q)) ?? null;
  };

  const handleSearch = async (fromOverride?: string, toOverride?: string) => {
    Keyboard.dismiss();
    setFocused(null);
    const from = resolve(fromOverride ?? fromText);
    const to = resolve(toOverride ?? toText);
    if (!from || !to) {
      setError(`Choose a ${!from ? 'start point' : 'destination'} from the suggestions, or type coordinates like 30.7333, 76.7794.`);
      return;
    }
    if (!isInCoverage(from) || !isInCoverage(to)) {
      setError('Safe routing currently covers Chandigarh, Mohali, Panchkula and Zirakpur only.');
      return;
    }

    await planBetween(from, to, (toOverride ?? toText).trim());
  };

  const planBetween = async (from: LatLon, to: LatLon, name: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const plan = await planRoutes(from, to, new Date(), mode === 'ride' ? 'drive' : 'walk');
      setOrigin(from);
      setDestination(to);
      setDestinationName(name);
      setRoutes(plan.routes);
      setNotes(plan.notes);
      setSelected(plan.routes[0]?.label ?? null);
      if (plan.routes.length === 0) setError('No route was found between these points.');
      if (plan.communityReports.length > 0) setNotice(`${plan.communityReports.length} recent community report(s) nearby were taken into account.`);
    } catch (e: any) {
      const status = e?.response?.status;
      setRoutes([]);
      setError(
        status === 422 || status === 400
          ? 'No route could be planned between these points. Try points further apart.'
          : status === 503
          ? 'The routing engine is not loaded on the server.'
          : 'Could not reach the SHIELD server. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const pickSuggestion = (name: string) => {
    if (focused === 'from') {
      setFromText(name);
      if (toText.trim()) handleSearch(name, undefined);
    } else {
      setToText(name);
      if (fromText.trim()) handleSearch(undefined, name);
    }
    setFocused(null);
  };

  const swap = () => {
    setFromText(toText);
    setToText(fromText);
    if (fromText.trim() && toText.trim()) handleSearch(toText, fromText);
  };

  const active = routes.find((r) => r.label === selected) ?? null;
  const cautionM = active
    ? Math.round(active.segments.filter(isCautionSegment).reduce((m, s) => m + s.length_m, 0))
    : 0;
  const scoreColor = (score: number) =>
    score >= 70 ? colors.statusSuccess : score >= 55 ? colors.statusWarning : colors.sosPrimary;

  const handleStartTrip = () => {
    if (!active) return;
    if (mode === 'ride' && !PLATE_RE.test(plate.trim().toUpperCase())) {
      setError('Enter the vehicle number plate (e.g. CH01AB1234) so your guardians know which vehicle you are in.');
      return;
    }
    setError(null);
    setTripActive(true);
  };

  /** Safe havens: tapping one plans a route there from where you are. */
  const routeToHaven = (h: SafeHaven) => {
    const from = me && isInCoverage(me) ? me : origin;
    if (!from) {
      setError('Your location is needed to route to a safe place.');
      return;
    }
    setToText(h.name || HAVEN_LABELS[h.kind]);
    planBetween(from, { lat: h.lat, lon: h.lon }, h.name || HAVEN_LABELS[h.kind]);
  };

  const switchMode = (m: TravelMode) => {
    if (m === mode || tripActive) return;
    setMode(m);
    setRoutes([]);
    setSelected(null);
  };

  const layerChip = (label: string, icon: any, on: boolean, toggle: () => void) => (
    <TouchableOpacity
      onPress={toggle}
      style={[styles.layerChip, { backgroundColor: on ? colors.brandAccent : colors.surface, borderColor: on ? colors.brandAccent : colors.border }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={14} color={on ? '#FFFFFF' : colors.textSecondary} />
      <Text style={[styles.layerChipText, { color: on ? '#FFFFFF' : colors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderField = (field: Field, value: string, setValue: (v: string) => void, icon: React.ReactNode, placeholder: string) => (
    <View style={[styles.fieldRow, { borderColor: focused === field ? colors.brandAccent : colors.border, borderRadius: radii.lg }]}>
      {icon}
      <TextInput
        style={[styles.input, typography.bodyMedium, { color: colors.textPrimary }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={setValue}
        onFocus={() => setFocused(field)}
        // Delay so a tap on a suggestion lands before the list closes (web blurs first).
        onBlur={() => setTimeout(() => setFocused((f) => (f === field ? null : f)), 200)}
        onSubmitEditing={() => handleSearch()}
        returnKeyType="search"
        accessibilityLabel={field === 'from' ? 'Start point' : 'Destination'}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => setValue('')} accessibilityLabel={`Clear ${field === 'from' ? 'start point' : 'destination'}`}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <AppHeader title="Safe Routes" showBack onBack={onBack} />

      <View style={styles.searchArea}>
        <View style={[styles.searchCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
          <View style={styles.fields}>
            {renderField('from', fromText, setFromText, <View style={[styles.fromDot, { backgroundColor: ROUTE_COLORS.start }]} />, 'Start (landmark or lat, lon)')}
            {renderField('to', toText, setToText, <Ionicons name="location" size={16} color={ROUTE_COLORS.end} style={styles.fieldIcon} />, 'Where to? (e.g. Elante Mall)')}
          </View>
          <View style={styles.searchActions}>
            <TouchableOpacity onPress={swap} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Swap start and destination">
              <Ionicons name="swap-vertical" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleSearch()}
              style={[styles.goButton, { backgroundColor: colors.brandAccent }]}
              accessibilityRole="button"
              accessibilityLabel="Find routes"
            >
              {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="search" size={18} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </View>

        {suggestions.length > 0 && (
          <View style={[styles.suggestions, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg }]}>
            {suggestions.map((s) => (
              <TouchableOpacity key={s.name} style={styles.suggestionRow} onPress={() => pickSuggestion(s.name)}>
                <Ionicons
                  name={s.name === MY_LOCATION ? 'navigate' : 'pin-outline'}
                  size={16}
                  color={s.name === MY_LOCATION ? colors.brandAccent : colors.textSecondary}
                />
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: 10 }]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.mapContainer}>
        <RouteMap
          routes={routes}
          selected={selected}
          origin={origin}
          destination={destination}
          onSelectRoute={tripActive ? undefined : setSelected}
          extras={extras}
          onSelectHaven={tripActive ? undefined : routeToHaven}
          style={styles.map}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.layerBar} contentContainerStyle={styles.layerBarContent}>
          {layerChip('Safe places', 'shield-checkmark-outline', showHavens, () => setShowHavens((v) => !v))}
          {layerChip('Reports', 'warning-outline', showReports, () => setShowReports((v) => !v))}
          {layerChip('Safety by hour', 'moon-outline', showHeat, () => setShowHeat((v) => !v))}
          {layerChip('Report here', 'add-circle-outline', false, () => setReportVisible(true))}
        </ScrollView>
        {showHeat && (
          <View style={[styles.hourBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => setHeatHour((h) => (h + 23) % 24)} accessibilityLabel="Earlier hour" style={styles.hourBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.hourText, { color: colors.textPrimary }]}>
              {`${String(heatHour).padStart(2, '0')}:00`} {heatHour >= 19 || heatHour < 6 ? '🌙' : '☀️'}
            </Text>
            <TouchableOpacity onPress={() => setHeatHour((h) => (h + 1) % 24)} accessibilityLabel="Later hour" style={styles.hourBtn}>
              <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.hourHint, { color: colors.textSecondary }]}>green safer · red riskier</Text>
          </View>
        )}
        {routes.length > 0 && (
          <View style={[styles.legend, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <LegendItem color={ROUTE_COLORS.selected} label="Your route" textColor={colors.textSecondary} />
            {cautionM > 0 && <LegendItem color={ROUTE_COLORS.caution} label="Caution" textColor={colors.textSecondary} />}
            {routes.length > 1 && <LegendItem color={ROUTE_COLORS.alternative} label="Other options" dashed textColor={colors.textSecondary} />}
          </View>
        )}
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {tripActive && active ? (
          <TripPanel
            route={active}
            destinationName={destinationName || 'Destination'}
            mode={mode}
            vehiclePlate={mode === 'ride' ? plate.trim().toUpperCase() : null}
            onPosition={setMe}
            onEnded={(message) => {
              setTripActive(false);
              if (message) setNotice(message);
            }}
          />
        ) : (
        <>
        <View style={[styles.modeRow, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.pill }]}>
          {(['walk', 'ride'] as TravelMode[]).map((m) => (
            <TouchableOpacity key={m} onPress={() => switchMode(m)}
              style={[styles.modeBtn, { backgroundColor: mode === m ? colors.surface : 'transparent', borderRadius: radii.pill }]}
              accessibilityRole="button" accessibilityState={{ selected: mode === m }} accessibilityLabel={m === 'walk' ? 'Walking' : 'Ride in auto or cab'}>
              <Ionicons name={m === 'walk' ? 'walk' : 'car'} size={16} color={mode === m ? colors.brandAccent : colors.textSecondary} />
              <Text style={[typography.caption, { color: mode === m ? colors.textPrimary : colors.textSecondary, marginLeft: 6, fontWeight: '700' }]}>
                {m === 'walk' ? 'Walk' : 'Auto / cab'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {notice && !error && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 6 }]}>{notice}</Text>
        )}
        {error && (
          <View style={[styles.errorBox, { backgroundColor: colors.statusWarningBg }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.statusWarning} />
            <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8, flex: 1 }]}>{error}</Text>
          </View>
        )}

        {!active && !error && (
          <Text style={[typography.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
            Pick a start and destination to compare the fastest and safer walking routes for right now.
          </Text>
        )}

        {active && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {routes.map((r) => {
                const isActive = r.label === selected;
                return (
                  <TouchableOpacity
                    key={r.label}
                    onPress={() => setSelected(r.label)}
                    style={[
                      styles.chip,
                      {
                        borderColor: isActive ? ROUTE_COLORS.selected : colors.border,
                        backgroundColor: isActive ? colors.surfaceSecondary : colors.surface,
                        borderRadius: radii.lg,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`${ROUTE_TITLES[r.label]}, ${formatDuration(r.duration_s)}, safety ${r.safety_index}`}
                  >
                    <Text style={[typography.caption, { color: isActive ? ROUTE_COLORS.selected : colors.textSecondary, fontWeight: '700' }]}>
                      {ROUTE_TITLES[r.label].toUpperCase()}
                    </Text>
                    <View style={styles.chipStats}>
                      <Text style={[typography.h4, { color: colors.textPrimary }]}>{formatDuration(r.duration_s)}</Text>
                      <View style={[styles.scorePill, { backgroundColor: scoreColor(r.safety_index) }]}>
                        <Text style={styles.scorePillText}>{r.safety_index}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={[styles.metricsRow, { borderTopColor: colors.borderSubtle }]}>
              <Metric value={formatDistance(active.distance_m)} label="Distance" colors={colors} typography={typography} />
              <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />
              <Metric value={`${Math.round(active.lit_pct)}%`} label="On lit roads" colors={colors} typography={typography} />
              <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />
              <Metric
                value={cautionM > 0 ? formatDistance(cautionM) : 'None'}
                label="Caution stretch"
                colors={colors}
                typography={typography}
                valueColor={cautionM > 0 ? colors.sosPrimary : colors.statusSuccessText}
              />
            </View>

            {active.main_roads.length > 0 && (
              <Text style={[typography.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
                Via {active.main_roads.join(', ')}
              </Text>
            )}
            {active.highlights.slice(0, 2).map((h) => (
              <Text key={h} style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
                • {h}
              </Text>
            ))}
            {notes.some((n) => n.startsWith('Synthetic')) && (
              <Text style={[typography.caption, { color: colors.textMuted, marginTop: 6 }]}>
                Safety score uses simulated data for testing. Assistive tool only; in danger call 112.
              </Text>
            )}

            {mode === 'ride' && (
              <TextInput
                value={plate}
                onChangeText={(t) => setPlate(t.toUpperCase())}
                placeholder="Vehicle number plate, e.g. CH01AB1234"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                maxLength={15}
                style={[styles.plateInput, typography.bodyMedium, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.lg }]}
                accessibilityLabel="Vehicle number plate"
              />
            )}
            <TouchableOpacity
              onPress={handleStartTrip}
              activeOpacity={0.8}
              style={[
                styles.navigationButton,
                {
                  backgroundColor: isDark ? colors.brandAccent : colors.brandPrimary,
                  borderRadius: radii.pill,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={mode === 'ride' ? 'Start ride and share with guardians' : 'Start walk and share with guardians'}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>
                {mode === 'ride' ? 'Start ride · share live' : 'Start walk · share live'}
              </Text>
            </TouchableOpacity>
          </>
        )}
        </>
        )}
      </View>

      <ReportHazardModal
        visible={reportVisible}
        at={me ?? gps}
        onClose={(sent) => {
          setReportVisible(false);
          if (sent) {
            setNotice('Thanks. Your report warns other walkers and steers routes around this spot.');
            setShowReports(true);
            listHazards(layerCenter, 10).then(setHazards).catch(() => undefined);
          }
        }}
      />
    </SafeAreaView>
  );
}

function LegendItem({ color, label, dashed, textColor }: { color: string; label: string; dashed?: boolean; textColor: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: dashed ? 'transparent' : color, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      <Text style={[styles.legendText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

function Metric({ value, label, colors, typography, valueColor }: { value: string; label: string; colors: any; typography: any; valueColor?: string }) {
  return (
    <View style={styles.metricColumn}>
      <Text style={[typography.metricValue, { color: valueColor ?? colors.textPrimary }]}>{value}</Text>
      <Text style={[typography.metricLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
  },
  fields: {
    flex: 1,
    gap: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 42,
  },
  fromDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: 2,
    marginRight: 10,
  },
  fieldIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 40,
    outlineWidth: 0, // web: the field border already shows focus
  },
  searchActions: {
    marginLeft: 8,
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
  goButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchArea: {
    zIndex: 20,
  },
  suggestions: {
    position: 'absolute',
    top: '100%',
    marginTop: -6,
    left: 16,
    right: 16,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
  },
  map: {
    flex: 1,
    height: '100%',
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 26, // clears the map attribution line
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendSwatch: {
    width: 18,
    height: 0,
    borderTopWidth: 4,
    marginRight: 5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  panel: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  chips: {
    gap: 8,
    paddingBottom: 10,
  },
  chip: {
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 120,
  },
  chipStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  scorePill: {
    minWidth: 30,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
  },
  scorePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    marginBottom: 6,
  },
  metricColumn: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 28,
  },
  layerBar: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 64,
  },
  layerBarContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  layerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  layerChipText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 5,
  },
  hourBar: {
    position: 'absolute',
    top: 52,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  hourBtn: {
    padding: 6,
  },
  hourText: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'center',
  },
  hourHint: {
    fontSize: 11,
    marginHorizontal: 6,
  },
  modeRow: {
    flexDirection: 'row',
    padding: 3,
    marginBottom: 10,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 7,
  },
  plateInput: {
    borderWidth: 1,
    height: 42,
    paddingHorizontal: 12,
    marginTop: 8,
    outlineWidth: 0,
  },
  navigationButton: {
    width: '100%',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
});

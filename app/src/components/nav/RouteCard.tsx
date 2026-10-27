import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useI18n, StringKey } from '../../i18n';
import { NavRoute, Place247, formatDuration, formatKm, scoreColor, TIER_COLORS, SHORTEST_COLOR, RouteBadge } from '../../services/navService';
import { PLACE_COLORS, PLACE_ICONS } from './navMapShared';
import { callNumber } from '../common/HelplineRow';

interface RouteCardProps {
  route: NavRoute;
  selected: boolean;
  expanded: boolean;
  onPress: () => void;
  onStart: () => void;
  onPlace: (p: Place247) => void;
}

const BADGE_COLOR: Record<RouteBadge, string> = {
  safest: TIER_COLORS.safest, medium: TIER_COLORS.medium, vulnerable: TIER_COLORS.vulnerable,
  shortest: SHORTEST_COLOR, fastest: '#7C3AED',
};

const PLACE_LABEL: Record<Place247['kind'], StringKey> = {
  pharmacy: 'nav.place.pharmacy', hospital: 'nav.place.hospital', police: 'nav.place.police', fuel: 'nav.place.fuel',
  convenience: 'nav.place.convenience', atm: 'nav.place.atm', other: 'nav.place.other',
};

/**
 * One route: time and distance first (as in any maps app), then what makes it safe or not.
 * The selected card opens up to explain the score and list the 24x7 places on the way.
 */
export default function RouteCard({ route, selected, expanded, onPress, onStart, onPlace }: RouteCardProps) {
  const { colors, typography, radii } = useTheme();
  const { t, textAlign } = useI18n();
  const s = route.safety;
  const color = scoreColor(s.score);

  const metric = (icon: keyof typeof Ionicons.glyphMap, text: string, tint = colors.textSecondary) => (
    <View style={styles.metric}>
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={[typography.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>{text}</Text>
    </View>
  );

  const bar = (label: StringKey, value: number | null) => (
    <View key={label} style={styles.barRow}>
      <Text style={[typography.bodySmall, { color: colors.textSecondary, width: 96, textAlign }]} numberOfLines={1}>{t(label)}</Text>
      <View style={[styles.barTrack, { backgroundColor: colors.surfaceSecondary }]}>
        {value !== null && <View style={[styles.barFill, { width: `${value}%`, backgroundColor: scoreColor(value) }]} />}
      </View>
      <Text style={[typography.bodySmall, { color: colors.textPrimary, width: 34, textAlign: 'right', fontWeight: '700' }]}>
        {value === null ? '–' : value}
      </Text>
    </View>
  );

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.card, {
        backgroundColor: colors.surface, borderRadius: radii.lg,
        borderColor: selected ? colors.brandAccent : colors.border, borderWidth: selected ? 2 : 1,
        borderLeftWidth: 6, borderLeftColor: TIER_COLORS[route.tier ?? 'other'],
      }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <View style={styles.timeRow}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>{formatDuration(route.duration_s, t('common.min'))}</Text>
            <Text style={[typography.bodyMedium, { color: colors.textSecondary }]}>{formatKm(route.distance_m)}</Text>
          </View>
          {!!route.summary && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary, textAlign }]} numberOfLines={1}>
              {t('nav.via', { road: route.summary })}
            </Text>
          )}
          {route.badges.length > 0 && (
            <View style={styles.badges}>
              {route.badges.map((b) => (
                <View key={b} style={[styles.badge, { backgroundColor: `${BADGE_COLOR[b]}22`, borderColor: BADGE_COLOR[b], borderWidth: 1 }]}>
                  <Text style={[styles.badgeText, { color: BADGE_COLOR[b] }]}>{t(`nav.badge.${b}` as StringKey)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={[styles.score, { borderColor: color }]} accessibilityLabel={s.score === null ? '' : t('nav.safety', { score: s.score })}>
          <Ionicons name="shield-checkmark" size={14} color={color} />
          <Text style={[styles.scoreText, { color }]}>{s.score ?? '–'}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        {metric('bulb-outline', s.lit_pct !== null ? t('nav.lit', { pct: s.lit_pct })
          : s.lighting_estimated && s.components.lighting !== null ? `~${s.components.lighting}% lit (est.)` : t('nav.litUnknown'))}
        {metric('alert-circle-outline', s.incidents ? t('nav.incidents', { count: s.incidents }) : t('nav.noIncidents'),
          s.incidents ? colors.sosPrimary : colors.textSecondary)}
        {metric('time-outline', t('nav.open247', { count: s.places_247.filter((p) => p.open_247).length }))}
      </View>

      {expanded && (
        <View style={[styles.details, { borderTopColor: colors.border }]}>
          <Text style={[typography.h4, { color: colors.textPrimary, marginBottom: 6, textAlign }]}>{t('nav.whySafe')}</Text>
          {bar('nav.why.lighting', s.components.lighting)}
          {bar('nav.why.incidents', s.components.incidents)}
          {bar('nav.why.help', s.components.help)}
          {bar('nav.why.activity', s.components.activity)}
          {(s.period === 'night' || s.period === 'evening') && (
            <Text style={[typography.bodySmall, { color: colors.textMuted, marginTop: 4, textAlign }]}>{t('nav.nightNote')}</Text>
          )}
          {s.partial && <Text style={[typography.bodySmall, { color: colors.statusWarning, marginTop: 4, textAlign }]}>{t('nav.partial')}</Text>}
          {s.long_trip && <Text style={[typography.bodySmall, { color: colors.textMuted, marginTop: 4, textAlign }]}>{t('nav.longTripNote')}</Text>}
          {route.duration_note === 'car_profile' && (
            <Text style={[typography.bodySmall, { color: colors.textMuted, marginTop: 4, textAlign }]}>{t('nav.carProfile')}</Text>
          )}
          {s.caution.length > 0 && (
            <View style={[styles.caution, { backgroundColor: '#FEF2F2' }]}>
              <Ionicons name="warning" size={16} color={colors.sosPrimary} />
              <Text style={[typography.bodySmall, { color: '#991B1B', flex: 1 }]}>
                {t('nav.cautionStretches', { count: s.caution.length })}:{' '}
                {[...new Set(s.caution.map((c) => t(`nav.reason.${c.reason}` as StringKey)))].join(', ')}
              </Text>
            </View>
          )}

          <Text style={[typography.h4, { color: colors.textPrimary, marginTop: 12, marginBottom: 4, textAlign }]}>{t('nav.places247')}</Text>
          {s.places_247.length === 0 ? (
            <Text style={[typography.bodySmall, { color: colors.textMuted, textAlign }]}>{t('nav.noPlaces247')}</Text>
          ) : s.places_247.slice(0, 8).map((p) => (
            <TouchableOpacity key={p.id} style={styles.place} onPress={() => onPlace(p)} accessibilityRole="button">
              <View style={[styles.placeIcon, { backgroundColor: PLACE_COLORS[p.kind] }]}>
                <Ionicons name={PLACE_ICONS[p.kind] as any} size={14} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
                  {p.name || t(PLACE_LABEL[p.kind])}
                </Text>
                <Text style={[typography.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
                  {t(PLACE_LABEL[p.kind])}{p.open_247 ? ` · ${t('common.allDay')}` : ''} · {t('nav.alongKm', { km: formatKm(p.along_m) })}
                </Text>
              </View>
              {!!p.phone && (
                <TouchableOpacity
                  onPress={() => callNumber(p.phone)}
                  style={[styles.placeCall, { backgroundColor: colors.statusSuccess }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.callNumber', { number: p.phone })}
                >
                  <Ionicons name="call" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity onPress={onStart} style={[styles.start, { backgroundColor: colors.brandAccent }]} accessibilityRole="button">
            <Ionicons name="navigate" size={18} color="#FFFFFF" />
            <Text style={[typography.button, { color: '#FFFFFF' }]}>{t('nav.start')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  score: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 2, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  scoreText: { fontSize: 17, fontWeight: '800' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 10 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  details: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  caution: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginTop: 10 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  placeIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  placeCall: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  start: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, marginTop: 14 },
});

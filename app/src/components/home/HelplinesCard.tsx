import { callPhone } from '../../services/phoneCall';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { DEFAULT_HELPLINES, NearbyPolice, nearbyPolice } from '../../services/policeService';
import { formatDistance } from '../../services/routeService';

const call = (number: string) => callPhone(number).catch(() => undefined);

/** One-tap helplines (112, 1091, 181) and the nearest police station and patrol van. */
export default function HelplinesCard() {
  const { colors, typography, radii } = useTheme();
  const [info, setInfo] = useState<NearbyPolice | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (pos) setInfo(await nearbyPolice(pos.coords.latitude, pos.coords.longitude));
      } catch {
        // Offline or no location: the helpline buttons still work
      }
    })();
  }, []);

  // Short on-button labels for the numbers we know; the server's longer text stays for screen readers
  const helplines = (info?.helplines?.length ? info.helplines : DEFAULT_HELPLINES).map((h) => ({
    ...h, label: DEFAULT_HELPLINES.find((d) => d.number === h.number)?.label ?? h.label,
  }));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg }]}>
      <View style={styles.row}>
        {helplines.map((h) => (
          <TouchableOpacity key={h.number} onPress={() => call(h.number)}
            style={[styles.line, { backgroundColor: h.number === '112' ? colors.sosPrimary : colors.surfaceSecondary, borderRadius: radii.lg }]}
            accessibilityRole="button" accessibilityLabel={`Call ${h.number}, ${h.label}`}>
            <Text style={[typography.h4, { color: h.number === '112' ? '#FFFFFF' : colors.textPrimary }]}>{h.number}</Text>
            <Text style={[typography.caption, { color: h.number === '112' ? '#FFFFFF' : colors.textSecondary }]} numberOfLines={1}>
              {h.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {info?.station && (
        <TouchableOpacity style={[styles.row, { marginTop: 10 }]} disabled={!info.station.phone}
          onPress={() => info.station?.phone && call(info.station.phone)}
          accessibilityRole="button" accessibilityLabel={`Nearest police station ${info.station.name}`}>
          <Ionicons name="shield" size={18} color={colors.brandAccent} />
          <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8, flex: 1 }]} numberOfLines={2}>
            Nearest police: {info.station.name} · {formatDistance(info.station.distance_m)}
            {info.patrol_unit_km !== null ? ` · patrol van about ${info.patrol_unit_km} km away` : ''}
          </Text>
          {info.station.phone && <Ionicons name="call" size={18} color={colors.brandAccent} />}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 12, marginHorizontal: 20, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 },
});

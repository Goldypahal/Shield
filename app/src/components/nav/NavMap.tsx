import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { optionalNative } from '../../utils/nativeModules';
import type { NavMapProps } from './navMapShared';

// MapLibre needs its native code, which Expo Go does not have: load it only when present.
const NativeMap = optionalNative<React.ComponentType<NavMapProps>>(
  () => require('./NavMapNative').default,
  'MapLibre map',
);

/** Shown instead of the map in Expo Go; routes, scores and 24x7 places still work. */
function MapUnavailable({ padding }: NavMapProps) {
  const { colors, typography } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.box, { backgroundColor: colors.surfaceSecondary, paddingTop: padding.top, paddingBottom: padding.bottom }]}>
      <Ionicons name="map-outline" size={40} color={colors.textMuted} />
      <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
        The map needs the full app build.{'\n'}Run: npx expo run:android
      </Text>
    </View>
  );
}

export default function NavMap(props: NavMapProps) {
  return NativeMap ? <NativeMap {...props} /> : <MapUnavailable {...props} />;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
});

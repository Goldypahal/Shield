import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

export default function DeviceStatusBar() {
  const { colors, isDark } = useTheme();

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      {Platform.OS === 'web' && (
        <View style={[styles.statusBarContainer, { backgroundColor: colors.background }]}>
          <Text style={[styles.timeText, { color: colors.textPrimary }]}>9:41</Text>

          <View style={styles.statusIcons}>
            <Ionicons
              name="cellular"
              size={14}
              color={colors.textPrimary}
              style={styles.icon}
            />
            <Ionicons
              name="wifi"
              size={14}
              color={colors.textPrimary}
              style={styles.icon}
            />
            <Ionicons
              name="battery-full"
              size={16}
              color={colors.textPrimary}
            />
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  statusBarContainer: {
    height: 38,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    zIndex: 10,
  },
  timeText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 6,
  },
});

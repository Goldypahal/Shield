import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Pressable, Animated, Easing, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import AlarmSoundService from '../../services/alarmSoundService';
import { useI18n, StringKey } from '../../i18n';

export type TabKey = 'Home' | 'Journey' | 'Helplines' | 'Profile' | 'Contacts' | 'Map' | 'Settings';

interface BottomNavigationProps {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
  /** Opens the global SOS countdown from anywhere in the app. */
  onSos?: () => void;
}

interface NavItem {
  key: TabKey;
  label: StringKey;
  iconActive: keyof typeof Ionicons.glyphMap;
  iconInactive: keyof typeof Ionicons.glyphMap;
  aliases?: TabKey[];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'Home', label: 'tab.home', iconActive: 'home', iconInactive: 'home-outline' },
  // 'Journey' and 'Map' both resolve to the Safe Routes screen in App.tsx
  { key: 'Journey', label: 'tab.routes', iconActive: 'navigate', iconInactive: 'navigate-outline', aliases: ['Map'] },
  { key: 'Helplines', label: 'tab.helplines', iconActive: 'call', iconInactive: 'call-outline' },
  { key: 'Profile', label: 'tab.profile', iconActive: 'person', iconInactive: 'person-outline', aliases: ['Settings', 'Contacts'] },
];

const SOS_SLOT_INDEX = 2; // SOS sits between Routes and Helplines

/** The SOS button must be held this long, so a pocket or a stray tap never starts one. */
export const SOS_HOLD_MS = 3000;

/**
 * Press and hold for 3 s to start the SOS. A ring fills while held, the phone ticks once a
 * second, and letting go early cancels. A short tap only shows "Hold 3 s".
 */
function HoldSosButton({ onSos, colors }: { onSos?: () => void; colors: { sosPrimary: string; navBackground: string } }) {
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticks = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    if (ticks.current) clearInterval(ticks.current);
    timer.current = null;
    ticks.current = null;
  };
  const begin = () => {
    if (!onSos) return;
    clear();
    setHolding(true);
    setHint(false);
    Vibration.vibrate(30);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: SOS_HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
    ticks.current = setInterval(() => Vibration.vibrate(30), 1000);
    timer.current = setTimeout(() => {
      clear();
      setHolding(false);
      progress.setValue(0);
      Vibration.vibrate([0, 120, 80, 120]);
      AlarmSoundService.playSosPressSound();
      onSos();
    }, SOS_HOLD_MS);
  };
  const end = () => {
    if (!timer.current) return;
    clear();
    setHolding(false);
    setHint(true);
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    setTimeout(() => setHint(false), 2000);
  };

  const size = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={styles.sosSlot}>
      {(holding || hint) && (
        <View style={styles.holdHint} pointerEvents="none">
          <Text style={styles.holdHintText}>{holding ? 'Keep holding...' : 'Hold 3 s for SOS'}</Text>
        </View>
      )}
      <Pressable
        onPressIn={begin}
        onPressOut={end}
        disabled={!onSos}
        style={[styles.sosButton, { backgroundColor: colors.sosPrimary, borderColor: colors.navBackground }]}
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS. Press and hold for 3 seconds to start the countdown before your guardians are alerted."
        accessibilityHint="Hold for 3 seconds"
      >
        <Animated.View style={[styles.holdFill, { height: size }]} pointerEvents="none" />
        <Ionicons name="warning" size={17} color="#FFFFFF" />
        <Text style={styles.sosText}>{holding ? 'HOLD' : 'SOS'}</Text>
      </Pressable>
    </View>
  );
}

export default function BottomNavigation({ activeTab, onTabPress, onSos }: BottomNavigationProps) {
  const { colors, typography } = useTheme();
  const { t } = useI18n();

  const renderTab = (item: NavItem) => {
    const isActive = activeTab === item.key || (item.aliases && item.aliases.includes(activeTab));
    const iconName = isActive ? item.iconActive : item.iconInactive;
    const tintColor = isActive ? colors.navActive : colors.navInactive;

    return (
      <TouchableOpacity
        key={item.key}
        onPress={() => onTabPress(item.key)}
        style={styles.tabButton}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={`${t(item.label)} tab`}
        activeOpacity={0.7}
      >
        <Ionicons name={iconName} size={22} color={tintColor} />
        <Text
          style={[
            styles.tabLabel,
            typography.caption,
            {
              color: tintColor,
              fontWeight: isActive ? '600' : '400',
            },
          ]}
        >
          {t(item.label)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.navBackground,
          borderTopColor: colors.navBorder,
        },
      ]}
      accessibilityRole="tablist"
    >
      {NAV_ITEMS.slice(0, SOS_SLOT_INDEX).map(renderTab)}

      <HoldSosButton onSos={onSos} colors={colors} />

      {NAV_ITEMS.slice(SOS_SLOT_INDEX).map(renderTab)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: Platform.OS === 'ios' ? 76 : 64,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 22 : 8,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 11,
  },
  sosSlot: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    marginTop: -16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  holdFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  holdHint: {
    position: 'absolute',
    bottom: 58,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  holdHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  sosText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: -1,
  },
});

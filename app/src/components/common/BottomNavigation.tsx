import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
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

      <View style={styles.sosSlot}>
        <TouchableOpacity
          onPress={() => {
            AlarmSoundService.playSosPressSound();
            onSos?.();
          }}
          disabled={!onSos}
          style={[
            styles.sosButton,
            { backgroundColor: colors.sosPrimary, borderColor: colors.navBackground },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Emergency SOS. Opens a five second countdown before alerting your guardians."
          activeOpacity={0.85}
        >
          <Ionicons name="warning" size={17} color="#FFFFFF" />
          <Text style={styles.sosText}>SOS</Text>
        </TouchableOpacity>
      </View>

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
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  sosText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: -1,
  },
});

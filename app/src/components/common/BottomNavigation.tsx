import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

export type TabKey = 'Home' | 'Contacts' | 'Map' | 'Settings';

interface BottomNavigationProps {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
}

interface NavItem {
  key: TabKey;
  label: string;
  iconActive: keyof typeof Ionicons.glyphMap;
  iconInactive: keyof typeof Ionicons.glyphMap;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'Home', label: 'Home', iconActive: 'home', iconInactive: 'home-outline' },
  { key: 'Contacts', label: 'Contacts', iconActive: 'people', iconInactive: 'people-outline' },
  { key: 'Map', label: 'Map', iconActive: 'map', iconInactive: 'map-outline' },
  { key: 'Settings', label: 'Settings', iconActive: 'settings', iconInactive: 'settings-outline' },
];

export default function BottomNavigation({ activeTab, onTabPress }: BottomNavigationProps) {
  const { colors, typography } = useTheme();

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
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.key;
        const iconName = isActive ? item.iconActive : item.iconInactive;
        const tintColor = isActive ? colors.navActive : colors.navInactive;

        return (
          <TouchableOpacity
            key={item.key}
            onPress={() => onTabPress(item.key)}
            style={styles.tabButton}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${item.label} tab`}
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
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
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
});

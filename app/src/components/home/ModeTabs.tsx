import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import { Mode } from '../../data/mockRoutes';

interface ModeOption {
  key: Mode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MODES: ModeOption[] = [
  { key: 'drive', label: 'Drive', icon: 'car-outline' },
  { key: 'bike', label: 'Bike', icon: 'bicycle-outline' },
  { key: 'walk', label: 'Walk', icon: 'walk' },
  { key: 'transit', label: 'Transit', icon: 'bus-outline' },
];

export default function ModeTabs() {
  const { mode, setMode } = useJourneyStore();

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {MODES.map((item) => {
        const isActive = mode === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.tab,
              isActive ? styles.activeTab : styles.inactiveTab,
            ]}
            onPress={() => setMode(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${item.label} mode`}
            activeOpacity={0.8}
          >
            <Ionicons
              name={item.icon}
              size={18}
              color={isActive ? '#FFFFFF' : TOKENS.colors.ink[600]}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: isActive ? '#FFFFFF' : TOKENS.colors.ink[600] },
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
    paddingHorizontal: 16,
    marginTop: 10,
    gap: 8,
    zIndex: 5,
  },
  tab: {
    flex: 1,
    height: 40,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {
    backgroundColor: TOKENS.colors.brand.orange,
    shadowColor: TOKENS.colors.brand.orange,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  inactiveTab: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tabIcon: {
    marginRight: 4,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});

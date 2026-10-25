import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Alert as RNAlert,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import MapPlaceholder from '../components/map/MapPlaceholder';

interface SafeRoutesScreenProps {
  onBack: () => void;
}

export default function SafeRoutesScreen({ onBack }: SafeRoutesScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();
  const [destination, setDestination] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);

  const [routeData, setRouteData] = useState({
    name: 'Safer Route',
    subtitle: 'Based on safety data',
    distance: '2.4 km',
    duration: '10 min',
    riskLevel: 'Low',
  });

  const handleSearch = () => {
    Keyboard.dismiss();
    if (!destination.trim()) {
      RNAlert.alert('Destination Required', 'Please enter a destination (e.g. College, Home).');
      return;
    }
    setRouteData({
      name: `Safer Route to ${destination}`,
      subtitle: 'Verified lighted segments & patrol corridors',
      distance: '3.1 km',
      duration: '14 min',
      riskLevel: 'Low',
    });
  };

  const handleStartNavigation = () => {
    if (!destination.trim()) {
      setDestination('Central Campus Library');
    }
    const nextState = !isNavigating;
    setIsNavigating(nextState);

    if (nextState) {
      RNAlert.alert(
        'Navigation Active',
        'Turn-by-turn guidance initiated along safest corridor. Deviations from route will trigger alert check.'
      );
    } else {
      RNAlert.alert('Navigation Ended', 'Journey concluded successfully.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <AppHeader title="Safe Routes" showBack onBack={onBack} />

      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.xl,
          },
        ]}
      >
        <Ionicons
          name="location-outline"
          size={20}
          color={colors.brandAccent}
          style={styles.searchIcon}
        />
        <TextInput
          style={[
            styles.input,
            typography.bodyMedium,
            {
              color: colors.textPrimary,
            },
          ]}
          placeholder="Your destination (e.g. College, Home)"
          placeholderTextColor={colors.textMuted}
          value={destination}
          onChangeText={setDestination}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          accessibilityLabel="Enter destination"
        />
        <TouchableOpacity
          onPress={handleSearch}
          style={styles.searchButton}
          accessibilityRole="button"
          accessibilityLabel="Search destination"
        >
          <Ionicons name="search" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.mapContainer}>
        <MapPlaceholder mode="route" style={styles.map} />
      </View>

      <View
        style={[
          styles.summaryCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.xl,
          },
        ]}
      >
        <View style={styles.summaryHeader}>
          <View
            style={[
              styles.shieldBadge,
              {
                backgroundColor: colors.statusSuccessBg,
                borderColor: colors.statusSuccessBorder,
              },
            ]}
          >
            <Ionicons name="shield-checkmark" size={18} color={colors.statusSuccess} />
          </View>

          <View style={styles.summaryHeaderText}>
            <Text style={[typography.h4, { color: colors.textPrimary }]}>
              {routeData.name}
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              {routeData.subtitle}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>

        <View style={[styles.metricsRow, { borderTopColor: colors.borderSubtle }]}>
          <View style={styles.metricColumn}>
            <Text style={[typography.metricValue, { color: colors.textPrimary }]}>
              {routeData.distance}
            </Text>
            <Text style={[typography.metricLabel, { color: colors.textSecondary }]}>
              Distance
            </Text>
          </View>

          <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.metricColumn}>
            <Text style={[typography.metricValue, { color: colors.textPrimary }]}>
              {routeData.duration}
            </Text>
            <Text style={[typography.metricLabel, { color: colors.textSecondary }]}>
              Est. time
            </Text>
          </View>

          <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.metricColumn}>
            <View style={styles.riskRow}>
              <View
                style={[
                  styles.riskDot,
                  { backgroundColor: colors.statusSuccess },
                ]}
              />
              <Text style={[typography.metricValue, { color: colors.statusSuccessText }]}>
                {routeData.riskLevel}
              </Text>
            </View>
            <Text style={[typography.metricLabel, { color: colors.textSecondary }]}>
              Risk level
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleStartNavigation}
          activeOpacity={0.8}
          style={[
            styles.navigationButton,
            {
              backgroundColor: isNavigating
                ? colors.sosPrimary
                : isDark
                ? colors.brandAccent
                : colors.brandPrimary,
              borderRadius: radii.pill,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isNavigating ? 'End Navigation' : 'Start Navigation'}
        >
          <Text style={[typography.button, { color: '#FFFFFF' }]}>
            {isNavigating ? 'End Navigation' : 'Start Navigation'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 12,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 44,
  },
  searchButton: {
    padding: 6,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
  },
  map: {
    flex: 1,
    height: '100%',
  },
  summaryCard: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  shieldBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  summaryHeaderText: {
    flex: 1,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  metricColumn: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 28,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  riskDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  navigationButton: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  PanResponder,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import RouteCard from './RouteCard';
import RouteDetailsModal from './RouteDetailsModal';
import { Place } from '../../data/mockRoutes';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface RoutePanelProps {
  onShowToast?: (message: string) => void;
}

const QUICK_DESTINATIONS: Place[] = [
  { label: 'Chandigarh University, Mohali', lat: 30.7685, lng: 76.5755 },
  { label: 'Elante Mall, Ind. Area', lat: 30.7055, lng: 76.8013 },
  { label: 'Sector 17 Plaza', lat: 30.7398, lng: 76.7827 },
  { label: 'Sohana Gurdwara', lat: 30.6865, lng: 76.7210 },
];

export default function RoutePanel({ onShowToast }: RoutePanelProps) {
  const {
    mode,
    setMode,
    routes,
    selectedRoute,
    selectRoute,
    destination,
    isJourneyActive,
    isLoading,
    transitUnavailable,
    startJourney,
    endJourney,
    setDestination,
  } = useJourneyStore();

  const [detailsVisible, setDetailsVisible] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleCollapsed = () => {
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setIsCollapsed((prev) => !prev);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 20) {
          if (Platform.OS !== 'web') {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          }
          setIsCollapsed(true);
        } else if (gestureState.dy < -20) {
          if (Platform.OS !== 'web') {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          }
          setIsCollapsed(false);
        }
      },
    })
  ).current;

  const activeRouteItem = routes ? routes[selectedRoute] : null;

  const handleStart = () => {
    if (!activeRouteItem) return;
    startJourney();
    onShowToast?.(`Journey started via ${activeRouteItem.title}!`);
  };

  const handleEnd = () => {
    endJourney();
    onShowToast?.('Journey completed safely!');
  };

  return (
    <View style={styles.container}>
      {/* Top Draggable Handle Area */}
      <View {...panResponder.panHandlers} style={styles.dragHandleTouchArea}>
        <TouchableOpacity
          style={styles.handleContainer}
          onPress={toggleCollapsed}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={isCollapsed ? 'Expand route panel' : 'Collapse route panel'}
        >
          <View style={styles.dragHandle} />
          <View style={styles.handleChevronRow}>
            <Ionicons
              name={isCollapsed ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={TOKENS.colors.ink[400]}
            />
            <Text style={styles.dragHintText}>
              {isCollapsed ? 'Swipe up to expand routes' : 'Swipe down to view full map'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* COLLAPSED VIEW (Peek bar for maximum map visibility) */}
      {isCollapsed && (
        <TouchableOpacity
          style={styles.collapsedPeekBar}
          onPress={toggleCollapsed}
          activeOpacity={0.9}
        >
          <View style={styles.peekLeft}>
            {activeRouteItem ? (
              <View style={styles.peekRouteInfo}>
                <View style={styles.peekTimePill}>
                  <Text style={styles.peekTimeText}>{activeRouteItem.minutes} min</Text>
                </View>
                <Text style={styles.peekDistanceText}>{activeRouteItem.distanceKm} km</Text>
                <Text style={styles.peekSummaryText} numberOfLines={1}>
                  • {activeRouteItem.title}
                </Text>
              </View>
            ) : transitUnavailable ? (
              <View style={styles.peekTransitNotice}>
                <Ionicons name="bus-outline" size={16} color="#DC2626" />
                <Text style={styles.peekTransitText}>No transit between hostel & campus</Text>
              </View>
            ) : (
              <View style={styles.peekTransitNotice}>
                <Ionicons name="location-outline" size={16} color={TOKENS.colors.brand.orange} />
                <Text style={styles.peekTransitText}>
                  {destination ? destination.label.split(',')[0] : 'Choose destination'}
                </Text>
              </View>
            )}
          </View>

          {activeRouteItem && !isJourneyActive && (
            <TouchableOpacity
              style={styles.peekStartBtn}
              onPress={handleStart}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate" size={14} color="#FFFFFF" />
              <Text style={styles.peekStartBtnText}>Start</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      {/* EXPANDED FULL VIEW */}
      {!isCollapsed && (
        <>
          {/* Header Row */}
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>
              {isJourneyActive
                ? 'Live Route Progress'
                : transitUnavailable
                ? 'Transit Unreachable'
                : routes
                ? 'Route Options'
                : 'Select Destination'}
            </Text>
            {activeRouteItem && !transitUnavailable && (
              <TouchableOpacity
                style={styles.viewDetailsLink}
                onPress={() => setDetailsVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="View route breakdown details"
              >
                <Text style={styles.viewDetailsText}>View Details</Text>
                <Ionicons name="arrow-forward" size={14} color={TOKENS.colors.brand.orange} />
              </TouchableOpacity>
            )}
          </View>

          {/* Transit Unavailable Notice with Quick Mode Switchers */}
          {transitUnavailable && (
            <View style={styles.transitNoticeCard}>
              <View style={styles.transitNoticeHeader}>
                <View style={styles.transitNoticeIconCircle}>
                  <Ionicons name="bus-outline" size={20} color="#DC2626" />
                </View>
                <View style={styles.transitNoticeHeaderText}>
                  <Text style={styles.transitNoticeTitle}>No Transit Route Available</Text>
                  <Text style={styles.transitNoticeSub}>
                    There is no direct public bus or metro transit line between your hostel and
                    university campus.
                  </Text>
                </View>
              </View>

              <Text style={styles.transitAlternativesLabel}>Recommended alternatives:</Text>
              <View style={styles.transitModePillsRow}>
                <TouchableOpacity
                  style={[styles.transitSwitchPill, styles.transitSwitchPillHighlight]}
                  onPress={() => setMode('walk')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="walk" size={16} color="#FFFFFF" />
                  <Text style={styles.transitSwitchPillTextHighlight}>Walk (Safe Path)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.transitSwitchPill}
                  onPress={() => setMode('bike')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="bicycle" size={16} color="#1F2937" />
                  <Text style={styles.transitSwitchPillText}>Bike</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.transitSwitchPill}
                  onPress={() => setMode('drive')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="car" size={16} color="#1F2937" />
                  <Text style={styles.transitSwitchPillText}>Drive</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* If loading real road routes from OSRM */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={TOKENS.colors.brand.orange} />
              <Text style={styles.loadingText}>Computing actual road routes...</Text>
            </View>
          )}

          {/* If routes exist, show 3 Route Cards */}
          {!isLoading && !transitUnavailable && routes && (
            <View
              style={styles.cardsRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Route options"
            >
              <RouteCard
                route={routes.safer}
                isSelected={selectedRoute === 'safer'}
                onSelect={() => selectRoute('safer')}
              />
              <RouteCard
                route={routes.moderate}
                isSelected={selectedRoute === 'moderate'}
                onSelect={() => selectRoute('moderate')}
              />
              <RouteCard
                route={routes.risk}
                isSelected={selectedRoute === 'risk'}
                onSelect={() => selectRoute('risk')}
              />
            </View>
          )}

          {/* If no destination or routes chosen yet: clean prompt without pseudo markings */}
          {!isLoading && !transitUnavailable && !routes && (
            <View style={styles.promptContainer}>
              <Text style={styles.promptSubtext}>
                Choose where you are heading to view real street-level safe routes.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickPillsRow}
              >
                {QUICK_DESTINATIONS.map((dest, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.quickPill}
                    onPress={() => setDestination(dest)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="location-outline" size={14} color={TOKENS.colors.brand.orange} />
                    <Text style={styles.quickPillText}>{dest.label.split(',')[0]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Primary "Start Journey" Button OR Active Tracking HUD */}
          {!isJourneyActive && !transitUnavailable && activeRouteItem && (
            <TouchableOpacity
              style={styles.startJourneyBtn}
              onPress={handleStart}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Start journey on ${activeRouteItem.title}`}
            >
              <Ionicons name="navigate" size={18} color="#FFFFFF" />
              <Text style={styles.startJourneyText}>
                Start Journey • {activeRouteItem.minutes} min ({activeRouteItem.title})
              </Text>
            </TouchableOpacity>
          )}

          {isJourneyActive && activeRouteItem && destination && (
            <View style={styles.activeJourneyCard}>
              <View style={styles.activeHeaderRow}>
                <View style={styles.liveIndicatorRow}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.liveJourneyTitle}>JOURNEY IN PROGRESS</Text>
                </View>
                <View style={styles.safetyShieldBadge}>
                  <Ionicons name="shield-checkmark" size={13} color="#16A34A" />
                  <Text style={styles.shieldBadgeText}>Guardian Guard Active</Text>
                </View>
              </View>

              <Text style={styles.activeDestinationText} numberOfLines={1}>
                Heading to {destination.label.split(',')[0]}
              </Text>

              <View style={styles.activeMetricsRow}>
                <Text style={styles.activeMetricsText}>
                  ⏱️ {activeRouteItem.minutes} min • 📍 {activeRouteItem.distanceKm} km
                </Text>
                <TouchableOpacity style={styles.endJourneyBtn} onPress={handleEnd} activeOpacity={0.8}>
                  <Ionicons name="checkmark-done" size={15} color="#FFFFFF" />
                  <Text style={styles.endJourneyText}>End Walk</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {/* Details Modal */}
      {activeRouteItem && (
        <RouteDetailsModal
          visible={detailsVisible}
          route={activeRouteItem}
          onClose={() => setDetailsVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    shadowColor: '#1F2937',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 10,
  },
  dragHandleTouchArea: {
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingBottom: 4,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    marginBottom: 4,
  },
  handleChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dragHintText: {
    fontSize: 10,
    fontWeight: '500',
    color: TOKENS.colors.ink[400],
  },
  collapsedPeekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  peekLeft: {
    flex: 1,
    marginRight: 10,
  },
  peekRouteInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peekTimePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  peekTimeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803D',
  },
  peekDistanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: TOKENS.colors.ink[700],
  },
  peekSummaryText: {
    fontSize: 12,
    color: TOKENS.colors.ink[500],
    flex: 1,
  },
  peekTransitNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peekTransitText: {
    fontSize: 13,
    fontWeight: '600',
    color: TOKENS.colors.ink[700],
  },
  peekStartBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: TOKENS.colors.brand.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  peekStartBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
  },
  viewDetailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  viewDetailsText: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.brand.orange,
  },
  transitNoticeCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    padding: 12,
    marginVertical: 4,
  },
  transitNoticeHeader: {
    flexDirection: 'row',
    gap: 10,
  },
  transitNoticeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitNoticeHeaderText: {
    flex: 1,
  },
  transitNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
  },
  transitNoticeSub: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
    lineHeight: 15,
  },
  transitAlternativesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: TOKENS.colors.ink[700],
    marginTop: 10,
    marginBottom: 6,
  },
  transitModePillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  transitSwitchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 7,
    borderRadius: 10,
  },
  transitSwitchPillHighlight: {
    backgroundColor: '#22C55E',
    borderColor: '#16A34A',
  },
  transitSwitchPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  transitSwitchPillTextHighlight: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
  },
  promptContainer: {
    paddingVertical: 8,
  },
  promptSubtext: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
    marginBottom: 8,
  },
  quickPillsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  quickPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
  },
  startJourneyBtn: {
    marginTop: 10,
    backgroundColor: TOKENS.colors.brand.orange,
    borderRadius: 14,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: TOKENS.colors.brand.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  startJourneyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  activeJourneyCard: {
    marginTop: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: 14,
    padding: 12,
  },
  activeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  liveIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  liveJourneyTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16A34A',
    letterSpacing: 0.5,
  },
  safetyShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 3,
  },
  shieldBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
  },
  activeDestinationText: {
    fontSize: 13,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
    marginTop: 2,
  },
  activeMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  activeMetricsText: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.ink[600],
  },
  endJourneyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16A34A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  endJourneyText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

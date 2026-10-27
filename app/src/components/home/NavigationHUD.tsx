import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import { NavigationStep } from '../../data/mockRoutes';

interface NavigationHUDProps {
  onShowToast: (message: string) => void;
}

export default function NavigationHUD({ onShowToast }: NavigationHUDProps) {
  const {
    routes,
    selectedRoute,
    destination,
    mode,
    currentStepIndex,
    isVoiceMuted,
    lastCheckInTimestamp,
    advanceStep,
    prevStep,
    toggleVoiceMute,
    sendCheckIn,
    reroute,
    endJourney,
  } = useJourneyStore();

  const [stepsModalVisible, setStepsModalVisible] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);

  const activeRoute = routes ? routes[selectedRoute] : null;
  const steps: NavigationStep[] = activeRoute?.steps && activeRoute.steps.length > 0
    ? activeRoute.steps
    : [
        {
          instruction: 'Head towards main highway avenue',
          maneuver: 'depart',
          distanceMeters: 200,
          streetName: 'Campus Access Road',
        },
        {
          instruction: 'Turn left onto Ludhiana-Chandigarh Highway (NH 205)',
          maneuver: 'turn-left',
          distanceMeters: 450,
          streetName: 'NH 205',
        },
        {
          instruction: 'Continue straight along illuminated corridor',
          maneuver: 'straight',
          distanceMeters: 1400,
          streetName: 'Highway Service Road',
        },
        {
          instruction: `Arrive safely at ${destination?.label.split(',')[0] || 'destination'}`,
          maneuver: 'arrive',
          distanceMeters: 50,
          streetName: destination?.label.split(',')[0] || 'Destination',
        },
      ];

  const currentStep = steps[currentStepIndex] || steps[0];
  const nextStep = steps[currentStepIndex + 1] || null;

  // Maneuver Icon Resolver
  const getManeuverIcon = (maneuver: NavigationStep['maneuver']): keyof typeof Ionicons.glyphMap => {
    switch (maneuver) {
      case 'turn-left':
        return 'arrow-undo';
      case 'turn-right':
        return 'arrow-redo';
      case 'slight-left':
        return 'trending-up';
      case 'slight-right':
        return 'trending-up';
      case 'arrive':
        return 'flag';
      case 'depart':
      case 'straight':
      default:
        return 'arrow-up';
    }
  };

  const getManeuverLabel = (step: NavigationStep) => {
    if (step.distanceMeters >= 1000) {
      return `In ${(step.distanceMeters / 1000).toFixed(1)} km`;
    }
    return `In ${step.distanceMeters} m`;
  };

  // Speedometer based on travel mode
  const currentSpeed = mode === 'walk' ? '4.8 km/h' : mode === 'bike' ? '16.5 km/h' : '38 km/h';

  // Calculate ETA time
  const now = new Date();
  const etaMinutes = activeRoute?.minutes || 13;
  const etaTime = new Date(now.getTime() + etaMinutes * 60000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const progressPct = Math.min(100, Math.round(((currentStepIndex + 1) / steps.length) * 100));

  const handleCheckIn = () => {
    sendCheckIn();
    onShowToast('🛡️ Check-In sent: Guardians notified you are safe');
  };

  const handleReroute = () => {
    reroute();
    onShowToast('🔄 Switched to alternative route corridor');
  };

  return (
    <View style={styles.hudOverlay} pointerEvents="box-none">
      {/* 1. TOP MANEUVER BANNER (Google Maps Style Navigation Card) */}
      <View style={styles.topManeuverCard}>
        <View style={styles.topManeuverRow}>
          {/* Big Maneuver Icon Badge */}
          <View style={styles.maneuverIconCircle}>
            <Ionicons
              name={getManeuverIcon(currentStep.maneuver)}
              size={28}
              color="#FFFFFF"
            />
          </View>

          {/* Maneuver Text Details */}
          <View style={styles.maneuverTextCol}>
            <Text style={styles.maneuverDistanceText}>
              {currentStepIndex === steps.length - 1
                ? 'Arriving at destination'
                : getManeuverLabel(currentStep)}
            </Text>
            <Text style={styles.maneuverInstructionText} numberOfLines={2}>
              {currentStep.instruction}
            </Text>
            {nextStep && (
              <Text style={styles.nextManeuverPreview} numberOfLines={1}>
                Then {nextStep.instruction.toLowerCase()}
              </Text>
            )}
          </View>

          {/* Quick HUD Actions (Sound & Steps List) */}
          <View style={styles.topActionBtnsCol}>
            <TouchableOpacity
              style={styles.hudSquareBtn}
              onPress={toggleVoiceMute}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={isVoiceMuted ? 'Unmute navigation' : 'Mute navigation'}
            >
              <Ionicons
                name={isVoiceMuted ? 'volume-mute' : 'volume-high'}
                size={18}
                color="#FFFFFF"
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.hudSquareBtn}
              onPress={() => setStepsModalVisible(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="View all route steps"
            >
              <Ionicons name="list" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Step Simulation Controls */}
        <View style={styles.simulationBar}>
          <TouchableOpacity
            style={[styles.simBtn, currentStepIndex === 0 && styles.simBtnDisabled]}
            disabled={currentStepIndex === 0}
            onPress={prevStep}
          >
            <Ionicons name="chevron-back" size={14} color="#FFFFFF" />
            <Text style={styles.simBtnText}>Prev Turn</Text>
          </TouchableOpacity>

          <Text style={styles.simStepCounter}>
            Turn {currentStepIndex + 1} of {steps.length}
          </Text>

          <TouchableOpacity
            style={[styles.simBtn, currentStepIndex === steps.length - 1 && styles.simBtnDisabled]}
            disabled={currentStepIndex === steps.length - 1}
            onPress={advanceStep}
          >
            <Text style={styles.simBtnText}>Next Turn</Text>
            <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. FLOATING TELEMETRY HUD (Speedometer & Compass) */}
      <View style={styles.telemetryFloatingBar} pointerEvents="box-none">
        <View style={styles.telemetryPill}>
          <Ionicons name="speedometer-outline" size={14} color="#15803D" />
          <Text style={styles.telemetrySpeedText}>{currentSpeed}</Text>
        </View>

        <View style={styles.telemetryPill}>
          <Ionicons name="compass-outline" size={14} color="#C2410C" />
          <Text style={styles.telemetryHeadingText}>340° NW</Text>
        </View>

        <View style={styles.safeCorridorBadge}>
          <View style={styles.pulseGreenDot} />
          <Text style={styles.safeCorridorText}>Safe Corridor Active</Text>
        </View>
      </View>

      {/* 3. BOTTOM LIVE NAVIGATION CONTROL DECK */}
      <View style={styles.bottomDeckContainer}>
        {/* Progress Bar */}
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
        </View>

        {/* Live Trip Metrics Row */}
        <View style={styles.metricsRow}>
          <View>
            <Text style={styles.etaTimeText}>{etaTime}</Text>
            <Text style={styles.etaSubText}>Estimated Arrival</Text>
          </View>

          <View style={styles.metricsDivider} />

          <View style={styles.metricCenterCol}>
            <Text style={styles.minutesRemainText}>
              {Math.max(1, Math.round(etaMinutes * (1 - currentStepIndex / steps.length)))} min
            </Text>
            <Text style={styles.distRemainText}>
              {(activeRoute?.distanceKm ? (activeRoute.distanceKm * (1 - currentStepIndex / steps.length)).toFixed(1) : '1.2')} km remaining
            </Text>
          </View>

          <TouchableOpacity
            style={styles.exitNavigationBtn}
            onPress={() => setExitConfirmVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={18} color="#FFFFFF" />
            <Text style={styles.exitBtnText}>End</Text>
          </TouchableOpacity>
        </View>

        {/* Action Pills Row */}
        <View style={styles.actionPillsRow}>
          <TouchableOpacity
            style={styles.actionPill}
            onPress={handleCheckIn}
            activeOpacity={0.8}
          >
            <Ionicons name="shield-checkmark" size={14} color="#16A34A" />
            <Text style={styles.actionPillText}>Send Check-In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionPill}
            onPress={handleReroute}
            activeOpacity={0.8}
          >
            <Ionicons name="git-branch-outline" size={14} color="#C2410C" />
            <Text style={styles.actionPillText}>Reroute</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionPill, styles.actionPillSos]}
            onPress={() => onShowToast('🚨 SOS Broadcast Armed: Hold SOS button 2s')}
            activeOpacity={0.8}
          >
            <Ionicons name="warning" size={14} color="#DC2626" />
            <Text style={styles.actionPillSosText}>SOS Alert</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. ALL STEPS MODAL SHEET */}
      <Modal
        visible={stepsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStepsModalVisible(false)}
      >
        <View style={styles.stepsModalBackdrop}>
          <View style={styles.stepsModalCard}>
            <View style={styles.stepsModalHeader}>
              <View>
                <Text style={styles.stepsModalTitle}>Turn-by-Turn Directions</Text>
                <Text style={styles.stepsModalSub}>
                  {activeRoute?.title} • {activeRoute?.minutes} min ({activeRoute?.distanceKm} km)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setStepsModalVisible(false)}
                style={styles.closeModalBtn}
              >
                <Ionicons name="close" size={20} color="#1F2937" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.stepsListScroll} showsVerticalScrollIndicator={false}>
              {steps.map((st, i) => {
                const isCurrent = i === currentStepIndex;
                const isPast = i < currentStepIndex;
                return (
                  <View
                    key={i}
                    style={[
                      styles.stepItemRow,
                      isCurrent && styles.stepItemRowActive,
                      isPast && styles.stepItemRowPast,
                    ]}
                  >
                    <View
                      style={[
                        styles.stepItemIconCircle,
                        isCurrent && styles.stepItemIconActive,
                        isPast && styles.stepItemIconPast,
                      ]}
                    >
                      <Ionicons
                        name={getManeuverIcon(st.maneuver)}
                        size={18}
                        color={isCurrent ? '#FFFFFF' : isPast ? '#9CA3AF' : '#15803D'}
                      />
                    </View>
                    <View style={styles.stepItemTextCol}>
                      <Text
                        style={[
                          styles.stepItemInstruction,
                          isCurrent && styles.stepItemInstructionActive,
                          isPast && styles.stepItemInstructionPast,
                        ]}
                      >
                        {st.instruction}
                      </Text>
                      <Text style={styles.stepItemDistText}>
                        {st.distanceMeters} m • {st.streetName}
                      </Text>
                    </View>
                    {isCurrent && (
                      <View style={styles.currentStepBadge}>
                        <Text style={styles.currentStepBadgeText}>NOW</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 5. EXIT CONFIRMATION MODAL */}
      <Modal
        visible={exitConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExitConfirmVisible(false)}
      >
        <View style={styles.stepsModalBackdrop}>
          <View style={styles.exitConfirmCard}>
            <Image
              source={require('../../../assets/images/heimdal_logo.png')}
              style={{ width: 68, height: 54, marginBottom: 6 }}
              resizeMode="contain"
            />
            <Text style={styles.exitConfirmTitle}>End Navigation?</Text>
            <Text style={styles.exitConfirmSub}>
              Guardian telemetry monitoring will stop once you end this navigation session.
            </Text>
            <View style={styles.exitConfirmButtonsRow}>
              <TouchableOpacity
                style={styles.exitCancelBtn}
                onPress={() => setExitConfirmVisible(false)}
              >
                <Text style={styles.exitCancelBtnText}>Keep Navigating</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.exitConfirmBtn}
                onPress={() => {
                  setExitConfirmVisible(false);
                  endJourney();
                  onShowToast('Journey ended safely');
                }}
              >
                <Text style={styles.exitConfirmBtnText}>End Journey</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  hudOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    zIndex: 30,
  },
  topManeuverCard: {
    backgroundColor: '#0F5132', // Deep navigation emerald
    marginHorizontal: 12,
    marginTop: Platform.OS === 'web' ? 12 : 36,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  topManeuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  maneuverIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  maneuverTextCol: {
    flex: 1,
  },
  maneuverDistanceText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  maneuverInstructionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    marginTop: 2,
    lineHeight: 17,
  },
  nextManeuverPreview: {
    fontSize: 11,
    color: '#86EFAC',
    marginTop: 3,
    fontWeight: '500',
  },
  topActionBtnsCol: {
    gap: 8,
  },
  hudSquareBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  simulationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 10,
  },
  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  simBtnDisabled: {
    opacity: 0.4,
  },
  simBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  simStepCounter: {
    color: '#A7F3D0',
    fontSize: 11,
    fontWeight: '600',
  },
  telemetryFloatingBar: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    alignItems: 'center',
  },
  telemetryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  telemetrySpeedText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803D',
  },
  telemetryHeadingText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#C2410C',
  },
  safeCorridorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  pulseGreenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  safeCorridorText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bottomDeckContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'web' ? 16 : 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 10,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#16A34A',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  etaTimeText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#15803D',
  },
  etaSubText: {
    fontSize: 10,
    color: TOKENS.colors.ink[500],
    fontWeight: '600',
  },
  metricsDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E5E7EB',
  },
  metricCenterCol: {
    alignItems: 'center',
  },
  minutesRemainText: {
    fontSize: 18,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
  },
  distRemainText: {
    fontSize: 11,
    color: TOKENS.colors.ink[500],
    fontWeight: '600',
  },
  exitNavigationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DC2626',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  exitBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  actionPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 8,
    borderRadius: 12,
  },
  actionPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: TOKENS.colors.ink[800],
  },
  actionPillSos: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  actionPillSosText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  stepsModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  stepsModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    padding: 16,
  },
  stepsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  stepsModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
  },
  stepsModalSub: {
    fontSize: 12,
    color: TOKENS.colors.ink[500],
    marginTop: 2,
  },
  closeModalBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepsListScroll: {
    marginBottom: 8,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  stepItemRowActive: {
    backgroundColor: '#F0FDF4',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  stepItemRowPast: {
    opacity: 0.55,
  },
  stepItemIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepItemIconActive: {
    backgroundColor: '#16A34A',
  },
  stepItemIconPast: {
    backgroundColor: '#F3F4F6',
  },
  stepItemTextCol: {
    flex: 1,
  },
  stepItemInstruction: {
    fontSize: 13,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
  },
  stepItemInstructionActive: {
    fontWeight: '800',
    color: '#15803D',
  },
  stepItemInstructionPast: {
    color: '#6B7280',
  },
  stepItemDistText: {
    fontSize: 11,
    color: TOKENS.colors.ink[500],
    marginTop: 2,
  },
  currentStepBadge: {
    backgroundColor: '#16A34A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  currentStepBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  exitConfirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 24,
    marginBottom: 'auto',
    marginTop: 'auto',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  exitConfirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
    marginTop: 8,
  },
  exitConfirmSub: {
    fontSize: 12,
    color: TOKENS.colors.ink[600],
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 17,
  },
  exitConfirmButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  exitCancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  exitCancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: TOKENS.colors.ink[700],
  },
  exitConfirmBtn: {
    flex: 1,
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  exitConfirmBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

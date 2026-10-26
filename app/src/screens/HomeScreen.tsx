import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Modal,
  TouchableOpacity,
  Alert as RNAlert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import MonitoringStatusCard from '../components/home/MonitoringStatusCard';
import PrimarySOSButton from '../components/home/PrimarySOSButton';
import SafetyToolCard from '../components/home/SafetyToolCard';
import BottomNavigation, { TabKey } from '../components/common/BottomNavigation';

import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { AxiosError } from 'axios';
import PinPromptModal from '../components/common/PinPromptModal';
import { checkPinOffline } from '../services/pinVault';
import { getActiveSos, setActiveSos, stopActiveSos, sendSilentSos } from '../services/sosSession';
import { getDiscreetSettings, onDiscreetSettingsChange } from '../services/discreetSettings';
import { useShakeTrigger } from '../hooks/useShakeTrigger';
import CheckinCard from '../components/home/CheckinCard';
import HelplinesCard from '../components/home/HelplinesCard';
import { alertPolice } from '../services/policeService';
import AuthService from '../services/authService';
import ContactService from '../services/contactService';
import OfflineQueue from '../services/OfflineQueue';
import { requestLocationPermissions } from '../services/locationService';
import { triggerEmergency } from '../services/sosService';
import { UserProfile } from '../types';

interface HomeScreenProps {
  onNavigate: (destination: string) => void;
  activeTab?: TabKey;
  onTabPress?: (tab: TabKey) => void;
}

export default function HomeScreen({
  onNavigate,
  activeTab = 'Home',
  onTabPress,
}: HomeScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [monitoringActive, setMonitoringActive] = useState(true);
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Only the SOS PIN stops an SOS: during the countdown and after it has been sent
  const [pinPrompt, setPinPrompt] = useState<'countdown' | 'active' | null>(null);
  const [activeSosId, setActiveSosId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [shakeEnabled, setShakeEnabled] = useState(false);
  const [silentHint, setSilentHint] = useState(false);
  const [policeText, setPoliceText] = useState<string | null>(null);

  // While an SOS is active, show what the police are doing (sent to station, unit on the way, ...)
  useEffect(() => {
    if (!activeSosId) return setPoliceText(null);
    const refresh = () => alertPolice(activeSosId).then((p) => setPoliceText(p?.text ?? null)).catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [activeSosId]);

  const [toolModalVisible, setToolModalVisible] = useState(false);
  const [toolModalContent, setToolModalContent] = useState<{
    title: string;
    description: string;
    status: string;
    icon: keyof typeof Ionicons.glyphMap;
    upcoming?: boolean;
  } | null>(null);

  useEffect(() => {
    async function initUser() {
      // Not awaited: an unanswered permission prompt must not block sign-in and SOS readiness
      requestLocationPermissions().catch((e) => console.warn('Location permission request failed', e));
      const session = await AuthService.ensureSession().catch(() => null);
      const contacts = await ContactService.listContacts().catch(() => []);
      setProfile({
        uid: session?.uid ?? 'signed-out',
        name: session?.name ?? 'SHIELD user',
        phone: session?.phone ?? '',
        emergencyContacts: contacts || [],
        sensitivityMode: 'NORMAL',
      });
      OfflineQueue.syncWhenOnline().catch(() => undefined);
    }
    initUser();
    // A silent SOS keeps nothing on the home screen; it can be stopped from Settings
    getActiveSos().then((a) => setActiveSosId(a && !a.silent ? a.alertId : null));
    getDiscreetSettings().then((d) => setShakeEnabled(d.shakeToSos));
    const offDiscreet = onDiscreetSettingsChange((d) => setShakeEnabled(d.shakeToSos));
    // Replay alerts that were raised without signal as soon as the network returns
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) OfflineQueue.syncWhenOnline().catch(() => undefined);
    });
    return () => {
      unsubscribe();
      offDiscreet();
    };
  }, []);

  const sendSOS = useCallback(async (silent = false) => {
    if (!profile) {
      if (!silent) RNAlert.alert('SOS not sent', 'SHIELD is still starting up. Call 112 if you are in danger.');
      return;
    }
    try {
      if (silent) {
        // Duress PIN while offline: the alert goes out, but nothing on screen shows it
        await sendSilentSos('DURESS_PIN');
        return;
      }
      const result = await triggerEmergency(profile, 90, 'HIGH');
      await setActiveSos(result.alertId);
      setActiveSosId(result.alertId);
      const where = result.locationKnown ? '' : ' Your location could not be determined.';
      if (result.delivery === 'server') {
        RNAlert.alert('SOS sent', `Your guardians are being alerted and can follow your live location.${where}`);
      } else if (result.fallback === 'firebase' || result.fallback === 'sms_composer') {
        RNAlert.alert('SOS queued', `No connection to SHIELD. The alert is saved and will send automatically; an SMS fallback was started.${where}`);
      } else {
        RNAlert.alert('SOS queued', `No connection. The alert is saved and will send when you are back online. Call 112 if you are in danger.${where}`);
      }
    } catch (err) {
      if (!silent) RNAlert.alert('SOS failed', 'The alert could not be saved. Call 112 now.');
    }
  }, [profile]);

  const clearCountdown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setCountdown(null);
    setSosActive(false);
  };

  const handleSOSTrigger = useCallback(() => {
    if (timerRef.current || activeSosId) return;
    setSosActive(true);
    let left = SOS_COUNTDOWN_SECONDS;
    setCountdown(left);
    timerRef.current = setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        clearCountdown();
        setPinPrompt(null);
        sendSOS();
      }
    }, 1000);
  }, [sendSOS, activeSosId]);

  // Shake three times to start the countdown (opt-in in Settings)
  useShakeTrigger(handleSOSTrigger, shakeEnabled);

  const sendSilent = async () => {
    setSilentHint(false);
    await sendSilentSos('SOS_BUTTON').catch(() => undefined);
    // Deliberately no popup, sound or banner. A tiny confirmation only the user would notice:
    setSilentHint(true);
    setTimeout(() => setSilentHint(false), 2500);
  };

  /** Countdown stand-down: the server checks the PIN (and handles a duress PIN silently); offline, this phone does. */
  const stopCountdownWithPin = async (pin: string): Promise<string | null> => {
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    try {
      const ok = await AuthService.checkPinOnline(pin, last?.coords.latitude, last?.coords.longitude);
      if (!ok) return 'Incorrect PIN. The SOS will still be sent.';
      clearCountdown();
      setPinPrompt(null);
      return null;
    } catch (e) {
      if ((e as AxiosError).response?.status === 423) return 'Too many wrong PINs. The SOS will be sent.';
      const kind = await checkPinOffline(pin);
      if (kind === 'unknown') return 'No connection, and this phone cannot check your PIN offline. The SOS will be sent.';
      if (kind === null) return 'Incorrect PIN. The SOS will still be sent.';
      clearCountdown();
      setPinPrompt(null);
      if (kind === 'duress') sendSOS(true);
      return null;
    }
  };

  const stopActiveWithPin = async (pin: string): Promise<string | null> => {
    const result = await stopActiveSos(pin);
    if ('message' in result) return result.message;
    setActiveSosId(null);
    setPinPrompt(null);
    RNAlert.alert('SOS stopped', 'Your alert has been stood down.');
    return null;
  };

  const handleOpenToolInfo = (toolKey: 'ai' | 'fall') => {
    if (toolKey === 'ai') {
      setToolModalContent({
        title: 'AI Detection',
        description:
          'On-device scream and distress frequency detection. Continuously evaluates acoustic distress patterns using edge inference when monitoring is enabled.',
        status: monitoringActive ? 'Active & listening locally' : 'Standby',
        icon: 'pulse-outline',
      });
    } else {
      // Future scope (SRS DET-5): the motion classifier is not calibrated on real falls yet, so nothing is armed.
      setToolModalContent({
        title: 'Fall Detection',
        description:
          'Coming in a future release. SHIELD will use the accelerometer and gyroscope to notice a hard impact followed by stillness, ask if you are okay, and alert your guardians if you do not respond. Until then, use the SOS button.',
        status: 'Future scope: not active yet',
        icon: 'fitness-outline',
        upcoming: true,
      });
    }
    setToolModalVisible(true);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <AppHeader
        subtitle="Good morning,"
        title={profile?.name || 'Alex'}
        rightIcon="settings-outline"
        onRightPress={() => onNavigate('Settings')}
        rightAccessibilityLabel="Go to Settings"
      />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <MonitoringStatusCard
          isActive={monitoringActive}
          onPress={() => setMonitoringActive(!monitoringActive)}
        />

        {activeSosId ? (
          <View style={[styles.activeSos, { backgroundColor: colors.sosRing, borderColor: colors.sosPrimary }]}>
            <Ionicons name="radio" size={28} color={colors.sosPrimary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[typography.h4, { color: colors.sosPrimary }]}>SOS ACTIVE</Text>
              <Text style={[typography.bodySmall, { color: colors.textPrimary }]}>
                Guardians are alerted and following your location. Only your SOS PIN can stop this.
              </Text>
              {policeText && (
                <Text style={[typography.bodySmall, { color: colors.brandAccent, fontWeight: '700', marginTop: 4 }]}>
                  Police: {policeText}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.activeSosStop, { backgroundColor: colors.sosPrimary }]}
              onPress={() => setPinPrompt('active')}
              accessibilityRole="button"
              accessibilityLabel="Stop SOS with PIN"
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>Stop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <PrimarySOSButton onTrigger={handleSOSTrigger} />
            <TouchableOpacity
              onLongPress={sendSilent}
              delayLongPress={1500}
              style={styles.silentLink}
              accessibilityRole="button"
              accessibilityLabel="Silent SOS. Press and hold for 2 seconds to alert guardians without sound or countdown."
            >
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {silentHint ? '✓' : 'Hold here for a silent SOS'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <HelplinesCard />

        <CheckinCard />

        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            <SafetyToolCard
              title="Live Location"
              description="Share your location with trusted contacts"
              iconName="location-outline"
              onPress={() => onNavigate('LiveLocation')}
            />
            <View style={styles.gridSpacer} />
            <SafetyToolCard
              title="Safe Routes"
              description="Get safer routes with real-time data"
              iconName="navigate-outline"
              onPress={() => onNavigate('SafeRoutes')}
            />
          </View>

          <View style={[styles.gridRow, { marginTop: 12 }]}>
            <SafetyToolCard
              title="AI Detection"
              description="Scream & distress detection active"
              iconName="pulse-outline"
              onPress={() => handleOpenToolInfo('ai')}
            />
            <View style={styles.gridSpacer} />
            <SafetyToolCard
              title="Fall Detection"
              description="Automatic fall alerts, planned for a future release"
              iconName="fitness-outline"
              badge="Coming soon"
              onPress={() => handleOpenToolInfo('fall')}
            />
          </View>

          <View style={[styles.gridRow, { marginTop: 12 }]}>
            <SafetyToolCard
              title="Fake Call"
              description="Get a call from Mom, Dad or anyone to leave safely"
              iconName="call-outline"
              onPress={() => onNavigate('FakeCall')}
            />
          </View>
        </View>
      </ScrollView>

      <Modal visible={sosActive && pinPrompt === null} transparent animationType="fade">
        <View style={styles.sosModalBackdrop}>
          <View style={[styles.sosModalCard, { backgroundColor: colors.surface, borderColor: colors.sosPrimary }]}>
            <View style={[styles.sosModalBadge, { backgroundColor: colors.sosRing }]}>
              <Ionicons name="alert-circle" size={36} color={colors.sosPrimary} />
            </View>
            <Text style={[typography.h2, { color: colors.textPrimary, marginTop: 12 }]}>
              Sending Emergency SOS
            </Text>
            <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
              Alerting trusted contacts in {countdown}s. If this was a mistake, stop it with your SOS PIN.
            </Text>

            <TouchableOpacity
              style={[styles.sosCancelButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => setPinPrompt('countdown')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Stop SOS with PIN"
            >
              <Text style={[typography.button, { color: colors.textPrimary }]}>Stop with PIN</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <PinPromptModal
        visible={pinPrompt !== null}
        title={pinPrompt === 'active' ? 'Stop SOS' : 'Stop the countdown'}
        message={pinPrompt === 'active'
          ? 'Enter your SOS PIN to stand the alert down.'
          : `Enter your SOS PIN. The SOS sends in ${countdown ?? 0}s.`}
        confirmLabel="Stop SOS"
        dismissLabel="Keep SOS going"
        onSubmit={pinPrompt === 'active' ? stopActiveWithPin : stopCountdownWithPin}
        onDismiss={() => setPinPrompt(null)}
      />

      <Modal visible={toolModalVisible} transparent animationType="fade" onRequestClose={() => setToolModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setToolModalVisible(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            {toolModalContent && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconBox, { backgroundColor: colors.surfaceSecondary }]}>
                    <Ionicons name={toolModalContent.icon} size={24} color={colors.brandAccent} />
                  </View>
                  <Text style={[typography.h3, { color: colors.textPrimary, flex: 1, marginLeft: 12 }]}>
                    {toolModalContent.title}
                  </Text>
                  <TouchableOpacity onPress={() => setToolModalVisible(false)}>
                    <Ionicons name="close" size={22} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    toolModalContent.upcoming
                      ? { backgroundColor: colors.statusWarningBg, borderColor: colors.statusWarning }
                      : { backgroundColor: colors.statusSuccessBg, borderColor: colors.statusSuccessBorder },
                  ]}
                >
                  <View style={[styles.statusDot, { backgroundColor: toolModalContent.upcoming ? colors.statusWarning : colors.statusSuccess }]} />
                  <Text style={[typography.caption, { color: toolModalContent.upcoming ? colors.statusWarning : colors.statusSuccessText }]}>
                    {toolModalContent.status}
                  </Text>
                </View>

                <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginTop: 14, lineHeight: 20 }]}>
                  {toolModalContent.description}
                </Text>

                <TouchableOpacity
                  style={[styles.modalDismissBtn, { backgroundColor: colors.brandAccent }]}
                  onPress={() => setToolModalVisible(false)}
                >
                  <Text style={[typography.button, { color: '#FFFFFF' }]}>Dismiss</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {onTabPress && (
        <BottomNavigation activeTab={activeTab} onTabPress={onTabPress} />
      )}
    </SafeAreaView>
  );
}

const SOS_COUNTDOWN_SECONDS = 10;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  silentLink: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  activeSos: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  activeSosStop: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    marginLeft: 8,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  gridContainer: {
    paddingHorizontal: 20,
    marginTop: 18,
  },
  gridRow: {
    flexDirection: 'row',
  },
  gridSpacer: {
    width: 12,
  },
  sosModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sosModalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 2,
    padding: 24,
    alignItems: 'center',
  },
  sosModalBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sosCancelButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  modalDismissBtn: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
});

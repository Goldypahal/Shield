import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Alert as RNAlert,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import SettingsRow from '../components/settings/SettingsRow';
import ThemeToggleModal from '../components/settings/ThemeToggleModal';
import ContactService from '../services/contactService';
import AuthService, { Session, authErrorMessage } from '../services/authService';
import { ChangePinModal, ChangePasswordModal } from '../components/settings/SecurityModals';
import PinPromptModal from '../components/common/PinPromptModal';
import { DiscreetSettings, getDiscreetSettings, updateDiscreetSettings } from '../services/discreetSettings';
import { getActiveSos, stopActiveSos } from '../services/sosSession';
import { getPoliceSharing, setPoliceSharing } from '../services/policeService';
import IncidentHistoryModal from '../components/settings/IncidentHistoryModal';

interface SettingsScreenProps {
  onNavigateToContacts?: () => void;
}

export default function SettingsScreen({ onNavigateToContacts }: SettingsScreenProps) {
  const { colors, typography, isDark, mode, radii } = useTheme();

  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [contactCount, setContactCount] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [discreet, setDiscreet] = useState<DiscreetSettings>({ calculatorDisguise: false, shakeToSos: false });
  const [sosRunning, setSosRunning] = useState(false);
  const [stopPinVisible, setStopPinVisible] = useState(false);
  const [policeSharing, setPoliceSharingState] = useState<boolean | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);

  useEffect(() => {
    async function checkContacts() {
      try {
        const list = await ContactService.listContacts();
        if (list && list.length > 0) {
          setContactCount(list.length);
        }
      } catch (_) {}
    }
    checkContacts();
    AuthService.ensureSession().then(setSession);
    getDiscreetSettings().then(setDiscreet);
    getActiveSos().then((a) => setSosRunning(!!a));
    getPoliceSharing().then(setPoliceSharingState).catch(() => undefined);
  }, []);

  const togglePoliceSharing = async () => {
    try {
      setPoliceSharingState(await setPoliceSharing(!policeSharing));
    } catch (e) {
      RNAlert.alert('Not changed', authErrorMessage(e));
    }
  };

  const toggleDiscreet = async (key: keyof DiscreetSettings) => {
    const next = await updateDiscreetSettings({ [key]: !discreet[key] });
    setDiscreet(next);
    if (key === 'calculatorDisguise' && next.calculatorDisguise) {
      RNAlert.alert('Calculator disguise on', 'Next time SHIELD opens it looks like a calculator. Type your SOS PIN then "=" to open SHIELD. Typing your duress PIN then "=" sends a silent SOS.');
    }
  };

  const confirmSignOut = (everywhere: boolean) => {
    const run = async () => {
      try {
        if (everywhere) await AuthService.logoutEverywhere();
        else await AuthService.logout();
      } catch (e) {
        RNAlert.alert('Sign out failed', authErrorMessage(e));
      }
    };
    const title = everywhere ? 'Sign out of all devices?' : 'Sign out?';
    const body = everywhere
      ? 'Every phone and browser signed in to your account will need your password again.'
      : 'You will need your email and password to sign in again. SOS will not work while signed out.';
    // RN Web has no multi-button Alert, so confirm with the browser dialog there
    if (Platform.OS === 'web') {
      if ((window as any).confirm(`${title}\n\n${body}`)) run();
      return;
    }
    RNAlert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: run },
    ]);
  };

  const initial = (session?.name || '?').trim().charAt(0).toUpperCase();

  const getThemeDisplayLabel = () => {
    if (mode === 'system') return 'System default';
    return mode === 'dark' ? 'Dark mode' : 'Light mode';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <AppHeader title="Settings" />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.profileCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.xl,
            },
          ]}
          onPress={() => {
            RNAlert.alert('Account', `${session?.name ?? ''}\n${session?.email ?? ''}\n${session?.phone ?? ''}\n\nEmail and phone were verified when you signed up.`);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Account of ${session?.name ?? 'you'}`}
        >
          <View style={[styles.avatarCircle, { backgroundColor: colors.brandAccent }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>

          <View style={styles.profileInfo}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>{session?.name ?? ''}</Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              {session?.email ?? ''}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.sectionContainer}>
          <SettingsRow
            iconName="people-outline"
            title="Trusted Contacts"
            subtitle={`Manage your ${contactCount} emergency contacts`}
            onPress={() => {
              if (onNavigateToContacts) onNavigateToContacts();
            }}
          />

          {sosRunning && (
            <SettingsRow
              iconName="radio-outline"
              title="Stop active SOS"
              subtitle="An SOS is running. Your PIN is required."
              onPress={() => setStopPinVisible(true)}
            />
          )}

          <SettingsRow
            iconName="shield-outline"
            title="Alert the police on SOS"
            subtitle={policeSharing === null ? 'Loading…' : policeSharing
              ? 'On: nearest station and 112 get your SOS while it is open'
              : 'Off: only your guardians are alerted'}
            onPress={togglePoliceSharing}
          />

          <SettingsRow
            iconName="document-text-outline"
            title="Incident history"
            subtitle="Past alerts; share one with police for an FIR"
            onPress={() => setHistoryVisible(true)}
          />

          <SettingsRow
            iconName="calculator-outline"
            title="Disguise as calculator"
            subtitle={discreet.calculatorDisguise ? 'On: PIN + "=" opens SHIELD' : 'Off'}
            onPress={() => toggleDiscreet('calculatorDisguise')}
          />

          <SettingsRow
            iconName="phone-portrait-outline"
            title="Shake to start SOS"
            subtitle={discreet.shakeToSos ? 'On: shake 3 times to start the countdown' : 'Off'}
            onPress={() => toggleDiscreet('shakeToSos')}
          />

          <SettingsRow
            iconName="keypad-outline"
            title="SOS PIN & duress PIN"
            subtitle="Change with a code sent to your email"
            onPress={() => setPinModalVisible(true)}
          />

          <SettingsRow
            iconName="key-outline"
            title="Password"
            subtitle="Change your sign-in password"
            onPress={() => setPasswordModalVisible(true)}
          />

          <SettingsRow
            iconName="lock-closed-outline"
            title="Privacy"
            subtitle="Control data and permissions"
            onPress={() => setPrivacyModalVisible(true)}
          />

          <SettingsRow
            iconName="options-outline"
            title="App Preferences"
            subtitle={`Theme: ${getThemeDisplayLabel()}`}
            onPress={() => setThemeModalVisible(true)}
          />

          <SettingsRow
            iconName="information-circle-outline"
            title="About"
            subtitle="App version 1.0.0"
            onPress={() => setAboutModalVisible(true)}
          />

          <SettingsRow
            iconName="log-out-outline"
            title="Sign out"
            subtitle="Sign out on this device"
            onPress={() => confirmSignOut(false)}
          />

          <SettingsRow
            iconName="phone-portrait-outline"
            title="Sign out of all devices"
            subtitle="Use this if you lost a phone"
            onPress={() => confirmSignOut(true)}
          />
        </View>
      </ScrollView>

      <PinPromptModal
        visible={stopPinVisible}
        title="Stop SOS"
        message="Enter your SOS PIN to stand the alert down."
        confirmLabel="Stop SOS"
        dismissLabel="Keep SOS going"
        onSubmit={async (pin) => {
          const r = await stopActiveSos(pin);
          if ('message' in r) return r.message;
          setStopPinVisible(false);
          setSosRunning(false);
          RNAlert.alert('SOS stopped', 'Your alert has been stood down.');
          return null;
        }}
        onDismiss={() => setStopPinVisible(false)}
      />

      <IncidentHistoryModal visible={historyVisible} onClose={() => setHistoryVisible(false)} />

      <ChangePinModal
        visible={pinModalVisible}
        onClose={() => setPinModalVisible(false)}
        onDone={(msg) => { setPinModalVisible(false); RNAlert.alert('Done', msg); }}
      />
      <ChangePasswordModal
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
        onDone={(msg) => { setPasswordModalVisible(false); RNAlert.alert('Done', msg); }}
      />

      <ThemeToggleModal
        visible={themeModalVisible}
        onClose={() => setThemeModalVisible(false)}
      />

      <Modal
        visible={privacyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPrivacyModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setPrivacyModalVisible(false)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.xl,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="lock-closed" size={20} color={colors.brandAccent} />
              </View>
              <Text style={[typography.h3, { color: colors.textPrimary, flex: 1, marginLeft: 12 }]}>
                Privacy & Data
              </Text>
              <TouchableOpacity onPress={() => setPrivacyModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginTop: 14, lineHeight: 22 }]}>
              Heimdal adheres to strict on-device data sovereignty. Location data is shared only when emergency SOS is triggered or during active Live Sharing sessions.
            </Text>

            <View style={styles.permissionItem}>
              <Ionicons name="checkmark-circle" size={18} color={colors.statusSuccess} />
              <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8 }]}>
                Foreground GPS coordinates: Active
              </Text>
            </View>
            <View style={styles.permissionItem}>
              <Ionicons name="checkmark-circle" size={18} color={colors.statusSuccess} />
              <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8 }]}>
                On-device acoustic processing: Secure
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.modalDismissBtn, { backgroundColor: colors.brandAccent }]}
              onPress={() => setPrivacyModalVisible(false)}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={aboutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAboutModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setAboutModalVisible(false)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.xl,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="shield-checkmark" size={20} color={colors.brandGold} />
              </View>
              <Text style={[typography.h3, { color: colors.textPrimary, flex: 1, marginLeft: 12 }]}>
                Heimdal
              </Text>
              <TouchableOpacity onPress={() => setAboutModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginTop: 14, lineHeight: 22 }]}>
              Heimdal Personal Safety Application{'\n'}
              Version 1.0.0 (Production Foundation){'\n'}
              "Your safety. Our priority."
            </Text>

            <TouchableOpacity
              style={[styles.modalDismissBtn, { backgroundColor: colors.brandAccent }]}
              onPress={() => setAboutModalVisible(false)}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  sectionContainer: {
    marginTop: 4,
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
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  modalDismissBtn: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
});

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, Text, AppState, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from './src/theme';

import SplashScreen from './src/screens/SplashScreen';
import AuthScreen from './src/screens/AuthScreen';
import CalculatorScreen from './src/screens/CalculatorScreen';
import { getDiscreetSettings, onDiscreetSettingsChange } from './src/services/discreetSettings';
import { sendSilentSos } from './src/services/sosSession';
import AuthService, { Session } from './src/services/authService';
import HomeScreen from './src/screens/HomeScreen';
import LiveLocationScreen from './src/screens/LiveLocationScreen';
import NavigationScreen from './src/screens/NavigationScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import FakeCallScreen from './src/screens/FakeCallScreen';
import HelplinesScreen from './src/screens/HelplinesScreen';
import { LanguageProvider } from './src/i18n';
import DeviceStatusBar from './src/components/common/DeviceStatusBar';
import BottomNavigation, { TabKey } from './src/components/common/BottomNavigation';
import SosOverlay from './src/components/common/SosOverlay';
import ScreamSosOverlay from './src/components/common/ScreamSosOverlay';
import { useScreamTrigger } from './src/hooks/useScreamTrigger';

import NotificationService from './src/services/notificationService';

/**
 * Owns the microphone for scream detection. Kept as its own render-less component because
 * the recorder updates state on every audio chunk; this keeps those re-renders out of the shell.
 */
function ScreamListener({ enabled, onScream }: { enabled: boolean; onScream: () => void }) {
  useScreamTrigger(onScream, enabled);
  return null;
}

// Mock default session so login is not required for now
const DEFAULT_GUEST_SESSION: Session = {
  user: {
    id: 'user_heimdal_1',
    email: 'user@heimdal.app',
    name: 'Heimdal User',
    phone: '+91 98765 43210',
    initials: 'HU',
  },
  tokens: {
    access: 'dev_guest_access_token',
    refresh: 'dev_guest_refresh_token',
  },
  emergencyContacts: [],
  discreet: {
    screamToSos: true,
    calculatorDisguise: false,
    alertPoliceOnSos: false,
  },
} as any;

type ActiveView = 'Splash' | 'Home' | 'LiveLocation' | 'SafeRoutes' | 'Settings' | 'Contacts' | 'FakeCall' | 'Helplines';

function HeimdalMain() {
  const { colors, isDark, mode, setMode } = useTheme();
  const [currentView, setCurrentView] = useState<ActiveView>('Splash');
  const [activeTab, setActiveTab] = useState<TabKey>('Home');
  // Default to guest session so login page is removed for now
  const [session, setSession] = useState<Session | null | undefined>(DEFAULT_GUEST_SESSION);
  // Calculator disguise: shown at launch and whenever the app returns from the background
  const [disguised, setDisguised] = useState(false);
  const [pendingInviteId, setPendingInviteId] = useState<string | undefined>(undefined);
  const [sosVisible, setSosVisible] = useState(false);
  // Hidden navbar while a fake call is ringing/in progress, so the simulation holds up
  const [callActive, setCallActive] = useState(false);
  // Scream detection: ~3 s of screaming opens the 10 s SOS countdown, then the PIN dialog
  const [screamSosVisible, setScreamSosVisible] = useState(false);
  const [screamDetection, setScreamDetection] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active' || Platform.OS === 'web');

  useEffect(() => {
    getDiscreetSettings().then((d) => setScreamDetection(d.screamToSos)).catch(() => undefined);
    const unsubscribe = onDiscreetSettingsChange((d) => setScreamDetection(d.screamToSos));
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => { unsubscribe(); sub.remove(); };
  }, []);

  // Handle guardian invitation deep links (?invite=<id> or /invite/<id>)
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url, 'http://localhost');
        const invite =
          parsed.searchParams.get('invite') ||
          (url.includes('/invite/') ? url.split('/invite/')[1]?.split('?')[0] : null);
        if (invite) {
          setPendingInviteId(invite);
          setCurrentView('Contacts');
          setActiveTab('Contacts');
        }
      } catch (_) {}
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      handleUrl(window.location.href);
    }
    Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const lockIfEnabled = () =>
      getDiscreetSettings().then((d) => { if (d.calculatorDisguise) setDisguised(true); }).catch(() => undefined);
    lockIfEnabled();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') lockIfEnabled();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    AuthService.ensureSession().then(setSession).catch(() => setSession(null));
    return AuthService.onSessionChange((s) => {
      setSession(s);
      if (s) {
        setCurrentView('Home');
        setActiveTab('Home');
      }
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    try {
      NotificationService.registerForPushNotifications().catch(() => {});
    } catch (_) {}
  }, [session]);

  // Login page disabled for now per user request
  const signedOut = false;
  const hidden = disguised && !!session;
  // One navbar for the whole app shell
  const showBottomNav = !disguised && currentView !== 'Splash' && !callActive;

  // The microphone is released while any SOS is on screen, during a fake call (it records
  // its own audio) and while the app is in the background.
  const listenForScreams =
    screamDetection && appActive &&
    !sosVisible && !screamSosVisible && !callActive && currentView !== 'FakeCall';

  const handleTabPress = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === 'Home') setCurrentView('Home');
    else if (tab === 'Journey' || tab === 'Map') setCurrentView('SafeRoutes');
    else if (tab === 'Safety') setCurrentView('LiveLocation');
    else if (tab === 'Profile' || tab === 'Settings') setCurrentView('Settings');
    else if (tab === 'Contacts') setCurrentView('Contacts');
  };

  const handleNavigate = (view: string) => {
    if (view === 'LiveLocation') {
      setCurrentView('LiveLocation');
    } else if (view === 'SafeRoutes') {
      setActiveTab('Map');
      setCurrentView('SafeRoutes');
    } else if (view === 'Settings') {
      setActiveTab('Settings');
      setCurrentView('Settings');
    } else if (view === 'Contacts') {
      setActiveTab('Contacts');
      setCurrentView('Contacts');
    } else if (view === 'Home') {
      setActiveTab('Home');
      setCurrentView('Home');
    } else if (view === 'Splash') {
      setCurrentView('Splash');
    } else if (view === 'FakeCall') {
      setCurrentView('FakeCall');
    } else if (view === 'Helplines') {
      setActiveTab('Home');
      setCurrentView('Helplines');
    }
  };

  const toggleThemeMode = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <View style={[styles.outerContainer, { backgroundColor: isDark ? '#050A12' : '#E2E8F0' }]}>
      {/* Screen-jump & theme bar: a development aid, never shipped in release builds */}
      {__DEV__ && (
      <View style={[styles.topInspectionBar, { backgroundColor: isDark ? '#0B111E' : '#FFFFFF', borderColor: colors.border }]}>
        <View style={styles.screenSelector}>
          <TouchableOpacity
            style={[styles.screenPill, currentView === 'Splash' && { backgroundColor: colors.brandAccent }]}
            onPress={() => setCurrentView('Splash')}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'Splash' ? '#FFFFFF' : colors.textSecondary }]}>
              Splash
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'Home' && { backgroundColor: colors.brandAccent }]}
            onPress={() => { setCurrentView('Home'); setActiveTab('Home'); }}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'Home' ? '#FFFFFF' : colors.textSecondary }]}>
              Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'LiveLocation' && { backgroundColor: colors.brandAccent }]}
            onPress={() => setCurrentView('LiveLocation')}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'LiveLocation' ? '#FFFFFF' : colors.textSecondary }]}>
              Location
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'SafeRoutes' && { backgroundColor: colors.brandAccent }]}
            onPress={() => { setCurrentView('SafeRoutes'); setActiveTab('Map'); }}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'SafeRoutes' ? '#FFFFFF' : colors.textSecondary }]}>
              Routes
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'Settings' && { backgroundColor: colors.brandAccent }]}
            onPress={() => { setCurrentView('Settings'); setActiveTab('Settings'); }}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'Settings' ? '#FFFFFF' : colors.textSecondary }]}>
              Settings
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'Contacts' && { backgroundColor: colors.brandAccent }]}
            onPress={() => { setCurrentView('Contacts'); setActiveTab('Contacts'); }}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'Contacts' ? '#FFFFFF' : colors.textSecondary }]}>
              Contacts
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.screenPill, currentView === 'FakeCall' && { backgroundColor: colors.brandAccent }]}
            onPress={() => setCurrentView('FakeCall')}
          >
            <Text style={[styles.screenPillText, { color: currentView === 'FakeCall' ? '#FFFFFF' : colors.textSecondary }]}>
              FakeCall
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={toggleThemeMode}
          style={[styles.themeToggleBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${isDark ? 'Light' : 'Dark'} mode`}
        >
          <Ionicons
            name={isDark ? 'sunny' : 'moon'}
            size={16}
            color={isDark ? '#FBBF24' : '#1E293B'}
          />
          <Text style={[styles.themeToggleText, { color: colors.textPrimary }]}>
            {isDark ? 'Light' : 'Dark'}
          </Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Centered Mobile Viewport Frame */}
      <View
        style={[
          styles.phoneFrame,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      >
        <DeviceStatusBar />

        <View style={styles.screenArea}>
        {disguised && session && (
          <CalculatorScreen
            onUnlock={() => setDisguised(false)}
            onDuress={() => { sendSilentSos('DURESS_PIN').catch(() => undefined); }}
          />
        )}

        {!hidden && currentView === 'Splash' && (
          <SplashScreen
            onContinue={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            autoDismissMs={3000}
          />
        )}

        {!hidden && currentView === 'Home' && (
          <HomeScreen onNavigate={handleNavigate} />
        )}

        {!hidden && currentView === 'LiveLocation' && (
          <LiveLocationScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            onNavigateToContacts={() => {
              setCurrentView('Contacts');
              setActiveTab('Contacts');
            }}
          />
        )}

        {!hidden && currentView === 'SafeRoutes' && (
          <NavigationScreen />
        )}

        {!hidden && currentView === 'Settings' && (
          <SettingsScreen
            onNavigateToContacts={() => {
              setCurrentView('Contacts');
              setActiveTab('Contacts');
            }}
          />
        )}

        {!hidden && currentView === 'FakeCall' && (
          <FakeCallScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            onActiveChange={setCallActive}
          />
        )}

        {!hidden && currentView === 'Helplines' && (
          <HelplinesScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
          />
        )}

        {!hidden && currentView === 'Contacts' && (
          <ContactsScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            initialInviteId={pendingInviteId}
          />
        )}
        </View>

        {showBottomNav && (
          <BottomNavigation activeTab={activeTab} onTabPress={handleTabPress} onSos={() => setSosVisible(true)} />
        )}
      </View>

      <SosOverlay visible={sosVisible} onClose={() => setSosVisible(false)} />
      <ScreamSosOverlay visible={screamSosVisible} onClose={() => setScreamSosVisible(false)} />
      <ScreamListener enabled={listenForScreams} onScream={() => setScreamSosVisible(true)} />
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <HeimdalMain />
      </LanguageProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
  },
  topInspectionBar: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    zIndex: 99,
  },
  screenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  screenPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  screenPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  themeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  themeToggleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  screenArea: {
    flex: 1,
    width: '100%',
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 420,
    height: '100%',
    flex: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
    borderLeftWidth: Platform.OS === 'web' ? 1 : 0,
    borderRightWidth: Platform.OS === 'web' ? 1 : 0,
  },
});

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, Text, AppState, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from './src/theme';

import SplashScreen from './src/screens/SplashScreen';
import AuthScreen from './src/screens/AuthScreen';
import CalculatorScreen from './src/screens/CalculatorScreen';
import { getDiscreetSettings } from './src/services/discreetSettings';
import { sendSilentSos } from './src/services/sosSession';
import AuthService, { Session } from './src/services/authService';
import HomeScreen from './src/screens/HomeScreen';
import LiveLocationScreen from './src/screens/LiveLocationScreen';
import SafeRoutesScreen from './src/screens/SafeRoutesScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import FakeCallScreen from './src/screens/FakeCallScreen';
import DeviceStatusBar from './src/components/common/DeviceStatusBar';
import BottomNavigation, { TabKey } from './src/components/common/BottomNavigation';
import SosOverlay from './src/components/common/SosOverlay';

import NotificationService from './src/services/notificationService';

type ActiveView = 'Splash' | 'Home' | 'LiveLocation' | 'SafeRoutes' | 'Settings' | 'Contacts' | 'FakeCall';

function HeimdalMain() {
  const { colors, isDark, mode, setMode } = useTheme();
  const [currentView, setCurrentView] = useState<ActiveView>('Splash');
  const [activeTab, setActiveTab] = useState<TabKey>('Home');
  // undefined while the stored session loads; null means signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Calculator disguise: shown at launch and whenever the app returns from the background
  const [disguised, setDisguised] = useState(false);
  const [pendingInviteId, setPendingInviteId] = useState<string | undefined>(undefined);
  const [sosVisible, setSosVisible] = useState(false);
  // Hidden navbar while a fake call is ringing/in progress, so the simulation holds up
  const [callActive, setCallActive] = useState(false);

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

  // Every screen except the splash needs an account: SOS, guardians and routes all act for a signed-in user
  const signedOut = currentView !== 'Splash' && session === null;
  const hidden = disguised && !!session;
  // One navbar for the whole app shell: every signed-in screen gets it, the disguise and
  // the sign-in/splash screens do not.
  const showBottomNav = !!session && !disguised && !signedOut && currentView !== 'Splash' && !callActive;

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

        {signedOut && <AuthScreen />}

        {!hidden && currentView === 'Splash' && (
          <SplashScreen
            onContinue={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            autoDismissMs={3000}
          />
        )}

        {!hidden && !signedOut && session && currentView === 'Home' && (
          <HomeScreen onNavigate={handleNavigate} />
        )}

        {!hidden && !signedOut && session && currentView === 'LiveLocation' && (
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

        {!hidden && !signedOut && session && currentView === 'SafeRoutes' && (
          <SafeRoutesScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
          />
        )}

        {!hidden && !signedOut && session && currentView === 'Settings' && (
          <SettingsScreen
            onNavigateToContacts={() => {
              setCurrentView('Contacts');
              setActiveTab('Contacts');
            }}
          />
        )}

        {!hidden && !signedOut && session && currentView === 'FakeCall' && (
          <FakeCallScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            onActiveChange={setCallActive}
          />
        )}

        {!hidden && !signedOut && session && currentView === 'Contacts' && (
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
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <HeimdalMain />
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

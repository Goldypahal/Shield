import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from './src/theme';

import SplashScreen from './src/screens/SplashScreen';
import HomeScreen from './src/screens/HomeScreen';
import LiveLocationScreen from './src/screens/LiveLocationScreen';
import SafeRoutesScreen from './src/screens/SafeRoutesScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import DeviceStatusBar from './src/components/common/DeviceStatusBar';
import { TabKey } from './src/components/common/BottomNavigation';

import NotificationService from './src/services/notificationService';

type ActiveView = 'Splash' | 'Home' | 'LiveLocation' | 'SafeRoutes' | 'Settings' | 'Contacts';

function HeimdalMain() {
  const { colors, isDark, mode, setMode } = useTheme();
  const [currentView, setCurrentView] = useState<ActiveView>('Splash');
  const [activeTab, setActiveTab] = useState<TabKey>('Home');

  useEffect(() => {
    try {
      NotificationService.registerForPushNotifications().catch(() => {});
    } catch (_) {}
  }, []);

  const handleTabPress = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === 'Home') setCurrentView('Home');
    else if (tab === 'Contacts') setCurrentView('Contacts');
    else if (tab === 'Map') setCurrentView('SafeRoutes');
    else if (tab === 'Settings') setCurrentView('Settings');
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
    }
  };

  const toggleThemeMode = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <View style={[styles.outerContainer, { backgroundColor: isDark ? '#050A12' : '#E2E8F0' }]}>
      {/* Quick Preview & Theme Control Bar */}
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

        {currentView === 'Splash' && (
          <SplashScreen
            onContinue={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            autoDismissMs={3000}
          />
        )}

        {currentView === 'Home' && (
          <HomeScreen
            onNavigate={handleNavigate}
            activeTab={activeTab}
            onTabPress={handleTabPress}
          />
        )}

        {currentView === 'LiveLocation' && (
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

        {currentView === 'SafeRoutes' && (
          <SafeRoutesScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
          />
        )}

        {currentView === 'Settings' && (
          <SettingsScreen
            onNavigateToContacts={() => {
              setCurrentView('Contacts');
              setActiveTab('Contacts');
            }}
            activeTab={activeTab}
            onTabPress={handleTabPress}
          />
        )}

        {currentView === 'Contacts' && (
          <ContactsScreen
            onBack={() => {
              setCurrentView('Home');
              setActiveTab('Home');
            }}
            activeTab={activeTab}
            onTabPress={handleTabPress}
          />
        )}
      </View>
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

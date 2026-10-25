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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import SettingsRow from '../components/settings/SettingsRow';
import ThemeToggleModal from '../components/settings/ThemeToggleModal';
import BottomNavigation, { TabKey } from '../components/common/BottomNavigation';
import ContactService from '../services/contactService';

interface SettingsScreenProps {
  onNavigateToContacts?: () => void;
  activeTab?: TabKey;
  onTabPress?: (tab: TabKey) => void;
}

export default function SettingsScreen({
  onNavigateToContacts,
  activeTab = 'Settings',
  onTabPress,
}: SettingsScreenProps) {
  const { colors, typography, isDark, mode, radii } = useTheme();

  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [contactCount, setContactCount] = useState(3);

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
  }, []);

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
            RNAlert.alert('Profile', 'Account managed locally. Data stored securely on-device.');
          }}
          accessibilityRole="button"
          accessibilityLabel="Profile settings for Alex"
        >
          <View style={[styles.avatarCircle, { backgroundColor: colors.brandAccent }]}>
            <Text style={styles.avatarText}>A</Text>
          </View>

          <View style={styles.profileInfo}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>Alex</Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              alex@example.com
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
        </View>
      </ScrollView>

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

      {onTabPress && (
        <BottomNavigation activeTab={activeTab} onTabPress={onTabPress} />
      )}
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

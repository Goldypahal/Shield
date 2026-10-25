import React, { useEffect, useState, useCallback } from 'react';
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

import ContactService from '../services/contactService';
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

  const [toolModalVisible, setToolModalVisible] = useState(false);
  const [toolModalContent, setToolModalContent] = useState<{
    title: string;
    description: string;
    status: string;
    icon: keyof typeof Ionicons.glyphMap;
  } | null>(null);

  useEffect(() => {
    async function initUser() {
      try {
        await requestLocationPermissions();
        const contacts = await ContactService.listContacts();
        setProfile({
          uid: 'user_alex',
          name: 'Alex',
          phone: '+1 (555) 234-5678',
          emergencyContacts: contacts || [],
          sensitivityMode: 'NORMAL',
        });
      } catch (e) {
        console.warn('Initial setup check in HomeScreen', e);
      }
    }
    initUser();
  }, []);

  const handleSOSTrigger = useCallback(() => {
    setSosActive(true);
    setCountdown(5);

    let left = 5;
    const timer = setInterval(async () => {
      left -= 1;
      setCountdown(left);

      if (left <= 0) {
        clearInterval(timer);
        setCountdown(null);
        setSosActive(false);

        if (profile) {
          try {
            await triggerEmergency(profile, 90, 'HIGH');
            RNAlert.alert('SOS Triggered', 'Emergency alerts initiated to your designated contacts.');
          } catch (err) {
            RNAlert.alert('Alert Queued', 'Emergency trigger recorded. Offline sync active if network is unavailable.');
          }
        } else {
          RNAlert.alert('SOS Triggered', 'Emergency alert initiated.');
        }
      }
    }, 1000);

    (handleSOSTrigger as any).timer = timer;
  }, [profile]);

  const cancelSOS = () => {
    if ((handleSOSTrigger as any).timer) {
      clearInterval((handleSOSTrigger as any).timer);
    }
    setCountdown(null);
    setSosActive(false);
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
      setToolModalContent({
        title: 'Fall Detection',
        description:
          'Multi-axis accelerometer monitoring configured to detect sudden impact, freefall deceleration, and subsequent immobility.',
        status: monitoringActive ? 'Sensors armed' : 'Standby',
        icon: 'fitness-outline',
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

        <PrimarySOSButton onTrigger={handleSOSTrigger} />

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
              description="Detects sudden falls and unusual motion"
              iconName="fitness-outline"
              onPress={() => handleOpenToolInfo('fall')}
            />
          </View>
        </View>
      </ScrollView>

      <Modal visible={sosActive} transparent animationType="fade">
        <View style={styles.sosModalBackdrop}>
          <View style={[styles.sosModalCard, { backgroundColor: colors.surface, borderColor: colors.sosPrimary }]}>
            <View style={[styles.sosModalBadge, { backgroundColor: colors.sosRing }]}>
              <Ionicons name="alert-circle" size={36} color={colors.sosPrimary} />
            </View>
            <Text style={[typography.h2, { color: colors.textPrimary, marginTop: 12 }]}>
              Sending Emergency SOS
            </Text>
            <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
              Alerting trusted contacts in {countdown}s. Tap cancel if this was accidental.
            </Text>

            <TouchableOpacity
              style={[styles.sosCancelButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={cancelSOS}
              activeOpacity={0.8}
            >
              <Text style={[typography.button, { color: colors.textPrimary }]}>Cancel Alert</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

                <View style={[styles.statusBadge, { backgroundColor: colors.statusSuccessBg, borderColor: colors.statusSuccessBorder }]}>
                  <View style={[styles.statusDot, { backgroundColor: colors.statusSuccess }]} />
                  <Text style={[typography.caption, { color: colors.statusSuccessText }]}>
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

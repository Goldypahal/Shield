import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import SOSButton from '../components/SOSButton';
import ThreatBanner from '../components/ThreatBanner';
import { getUserProfile, saveUserProfile } from '../services/firestoreService';
import { quickHackathonLogin } from '../services/authService';
import { UserProfile } from '../types';
import { useShakeTrigger } from '../hooks/useShakeTrigger';
import { useThreatMonitor } from '../hooks/useThreatMonitor';
import { startIncidentRecording } from '../services/audioService';
import { triggerEmergency } from '../services/sosService';
import { requestLocationPermissions } from '../services/locationService';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import ContactService from '../services/contactService';

type RootTabParamList = {
  Home: undefined;
  SOS: undefined;
  Map: undefined;
  Guardian: undefined;
  Setup: undefined;
};

export default function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    async function init() {
      await requestLocationPermissions();
      const user = await quickHackathonLogin();
      let p = await getUserProfile(user.uid);

      if (!p) {
        const contacts = await ContactService.listContacts();
        p = {
          uid: user.uid,
          phone: '+910000000000',
          name: 'Test User',
          emergencyContacts: contacts,
          sensitivityMode: 'NORMAL',
          voiceKeyword: 'help'
        };
        await saveUserProfile(p);
      } else {
        p = {
          ...p,
          emergencyContacts: await ContactService.listContacts()
        };
      }

      setProfile(p);
    }

    init();
  }, []);

  const startSOSCountdown = useCallback(async (forced = false) => {
    if (!profile) return;

    await startIncidentRecording();
    setCountdown(10);

    let left = 10;
    const timer = setInterval(async () => {
      left -= 1;
      setCountdown(left);

      if (left <= 0) {
        clearInterval(timer);
        setCountdown(null);
        await triggerEmergency(profile, forced ? 100 : 85, 'HIGH');
        Alert.alert('Emergency Triggered', 'Alerts sent to emergency contacts.');
      }
    }, 1000);
  }, [profile]);

  const { score, level } = useThreatMonitor(profile, async () => {
    if (countdown !== null) return;
    await startSOSCountdown(false);
  });

  useShakeTrigger(async () => {
    if (countdown !== null) return;
    await startSOSCountdown(true);
  });

  async function toggleMode(value: boolean) {
    if (!profile) return;
    const next = {
      ...profile,
      sensitivityMode: value ? 'HIGH_ALERT' : 'NORMAL'
    } as UserProfile;
    setProfile(next);
    await saveUserProfile(next);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>SHIELD</Text>
      <ThreatBanner score={score} level={level} />

      <View style={styles.row}>
        <Text style={styles.label}>High Alert Mode</Text>
        <Switch
          value={profile?.sensitivityMode === 'HIGH_ALERT'}
          onValueChange={toggleMode}
        />
      </View>

      <SOSButton onPress={() => navigation.navigate('SOS')} />

      {countdown !== null && (
        <Text style={styles.countdown}>Cancelling window: {countdown}s</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f1115'
  },
  heading: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 24
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24
  },
  label: {
    color: '#fff',
    fontSize: 16
  },
  countdown: {
    marginTop: 24,
    color: '#ffcc00',
    fontSize: 18,
    fontWeight: '700'
  }
});

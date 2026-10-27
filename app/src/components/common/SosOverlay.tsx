import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Vibration,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sendSos } from '../../services/sosSession';
import { SosResult } from '../../services/sosService';
import AlarmSoundService from '../../services/alarmSoundService';

interface SosOverlayProps {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'countdown' | 'sending' | 'sent' | 'error';

const COUNTDOWN_S = 5;

/**
 * Full-screen SOS with loud audible emergency siren and 3-method fallback:
 * 1. Internet Cloud Delivery (Primary)
 * 2. Cellular SMS Services Popup (No Internet)
 * 3. Bluetooth Mesh Relay (Dead Zone / Zero Network)
 */
export default function SosOverlay({ visible, onClose }: SosOverlayProps) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_S);
  const [result, setResult] = useState<SosResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const handleClose = () => {
    AlarmSoundService.stopSiren();
    onClose();
  };

  const toggleSirenMute = () => {
    if (isMuted) {
      AlarmSoundService.startSiren();
      setIsMuted(false);
    } else {
      AlarmSoundService.stopSiren();
      setIsMuted(true);
    }
  };

  useEffect(() => {
    if (!visible) {
      AlarmSoundService.stopSiren();
      return;
    }

    setPhase('countdown');
    setSecondsLeft(COUNTDOWN_S);
    setResult(null);
    setFailure(null);
    setIsMuted(false);

    // Start loud alarm siren immediately
    AlarmSoundService.startSiren();

    let left = COUNTDOWN_S;
    let cancelled = false;
    const timer = setInterval(() => {
      left -= 1;
      setSecondsLeft(left);
      if (left > 0) return;
      clearInterval(timer);

      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate([0, 100, 100, 200]);
        } catch (_) {}
      }

      setPhase('sending');
      sendSos('SOS_BUTTON')
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setPhase('sent');
        })
        .catch((e: any) => {
          if (cancelled) return;
          setFailure(e?.message ?? 'The alert could not be sent.');
          setPhase('error');
        });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      AlarmSoundService.stopSiren();
    };
  }, [visible]);

  const deliveryLine = result
    ? result.delivery === 'server'
      ? 'Your guardians have your live GPS location. Police alerted if emergency sharing is enabled.'
      : result.fallback === 'sms_composer'
      ? 'No internet connection. SMS emergency composer was opened to dispatch alert via mobile network.'
      : result.fallback === 'firebase'
      ? 'SHIELD server was unreachable; alerted through secondary cloud backup.'
      : 'No cellular or internet connection. SOS saved and broadcasting over Bluetooth mesh relay.'
    : '';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={[styles.overlay, phase === 'sent' && { backgroundColor: '#0F7B4F' }]}>
        {phase === 'countdown' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="warning" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.countdown}>{secondsLeft}</Text>
            <Text style={styles.title}>EMERGENCY SOS</Text>
            <Text style={styles.body}>
              Loud siren active. Alerting your emergency contacts with your live location.
            </Text>

            {/* Mute Siren Button */}
            <TouchableOpacity
              style={styles.muteButton}
              onPress={toggleSirenMute}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute siren' : 'Mute siren'}
            >
              <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={20} color="#FFFFFF" />
              <Text style={styles.muteButtonText}>
                {isMuted ? 'SIREN MUTED (TAP TO UNMUTE)' : 'MUTE SIREN'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel SOS"
            >
              <Text style={styles.primaryButtonText}>CANCEL SOS</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'sending' && (
          <View style={styles.content}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={[styles.title, { marginTop: 18 }]}>Alerting your guardians…</Text>
            <Text style={styles.body}>
              Checking network: Testing Internet Cloud, Cellular SMS, and Bluetooth Mesh.
            </Text>
          </View>
        )}

        {phase === 'sent' && (
          <View style={styles.content}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="checkmark-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>SOS Dispatched</Text>
            <Text style={styles.body}>{deliveryLine}</Text>

            {/* 3 Methods Status Summary Card */}
            <View style={styles.methodsCard}>
              <Text style={styles.methodsHeader}>FALLBACK CASCADE CHANNELS:</Text>

              <View style={styles.methodRow}>
                <Ionicons
                  name={result?.delivery === 'server' ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={result?.delivery === 'server' ? '#86EFAC' : '#FCA5A5'}
                />
                <Text style={styles.methodText}>
                  1. Internet Cloud API: {result?.delivery === 'server' ? 'Delivered & Live Tracking' : 'Offline / Unreachable'}
                </Text>
              </View>

              <View style={styles.methodRow}>
                <Ionicons
                  name={result?.fallback === 'sms_composer' || result?.channel === 'SMS' ? 'checkmark-circle' : 'radio-button-off'}
                  size={16}
                  color={result?.fallback === 'sms_composer' || result?.channel === 'SMS' ? '#86EFAC' : '#E2E8F0'}
                />
                <Text style={styles.methodText}>
                  2. Cellular SMS Popup: {result?.fallback === 'sms_composer' ? 'SMS Composer Opened' : 'Standby / Ready'}
                </Text>
              </View>

              <View style={styles.methodRow}>
                <Ionicons
                  name={result?.channel === 'BLUETOOTH_MESH' || result?.delivery === 'queued' ? 'checkmark-circle' : 'radio-button-off'}
                  size={16}
                  color={result?.channel === 'BLUETOOTH_MESH' || result?.delivery === 'queued' ? '#86EFAC' : '#E2E8F0'}
                />
                <Text style={styles.methodText}>
                  3. Bluetooth Relay: {result?.delivery === 'queued' ? 'Beacon Active (Offline Relay)' : 'Standby'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Dismiss alert"
            >
              <Text style={[styles.primaryButtonText, { color: '#0F7B4F' }]}>DISMISS</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="alert-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>SOS not sent</Text>
            <Text style={styles.body}>{failure}</Text>
            <Text style={styles.body}>
              If you are in danger, call 112 now. The app will not retry by itself.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => Linking.openURL('tel:112').catch(() => undefined)}
              accessibilityRole="button"
              accessibilityLabel="Call 112"
            >
              <Text style={styles.primaryButtonText}>CALL 112</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClose} style={styles.linkButton}>
              <Text style={styles.linkButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  countdown: {
    fontSize: 96,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -2,
    lineHeight: 100,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
  },
  body: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  muteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  muteButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  methodsCard: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  methodsHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  methodText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    flex: 1,
  },
  primaryButton: {
    marginTop: 24,
    width: '85%',
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1,
  },
  linkButton: {
    paddingVertical: 14,
  },
  linkButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
  },
});

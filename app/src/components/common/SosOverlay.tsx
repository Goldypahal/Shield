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

interface SosOverlayProps {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'countdown' | 'sending' | 'sent' | 'error';

const COUNTDOWN_S = 5;

/**
 * Full-screen SOS. Five seconds to cancel, then a real alert: triggerEmergency()
 * persists it on the device first and starts live location sharing when the server
 * has it. The result screen tells the walker whether guardians were actually reached
 * or the alert is still queued on the phone.
 */
export default function SosOverlay({ visible, onClose }: SosOverlayProps) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_S);
  const [result, setResult] = useState<SosResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPhase('countdown');
    setSecondsLeft(COUNTDOWN_S);
    setResult(null);
    setFailure(null);

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
    };
  }, [visible]);

  const deliveryLine = result
    ? result.delivery === 'server'
      ? 'Your guardians have your live location. Responders are alerted if you turned police alerts on.'
      : result.fallback === 'sms_composer'
      ? 'No connection to SHIELD. Your alert is saved on this phone and an SMS draft was opened.'
      : result.fallback === 'firebase'
      ? 'The SHIELD server was unreachable, so your guardians were alerted through the backup channel.'
      : 'No connection to SHIELD. Your alert is saved on this phone and will send as soon as you are online.'
    : '';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, phase === 'sent' && { backgroundColor: '#0F7B4F' }]}>
        {phase === 'countdown' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="warning" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.countdown}>{secondsLeft}</Text>
            <Text style={styles.title}>Emergency SOS</Text>
            <Text style={styles.body}>
              Sending an alert to your trusted contacts with your live location.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onClose}
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
            <Text style={styles.body}>Saving the alert on this phone first, then sending it.</Text>
          </View>
        )}

        {phase === 'sent' && (
          <View style={styles.content}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="checkmark-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Alert sent</Text>
            <Text style={styles.body}>{deliveryLine}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Dismiss alert"
            >
              <Text style={styles.primaryButtonText}>DISMISS</Text>
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
            <TouchableOpacity onPress={onClose} style={styles.linkButton}>
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
  primaryButton: {
    marginTop: 30,
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

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Vibration, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';

interface SosCountdownOverlayProps {
  visible: boolean;
  onCancel: () => void;
  onFinish?: () => void;
}

export default function SosCountdownOverlay({ visible, onCancel, onFinish }: SosCountdownOverlayProps) {
  const { origin, selectedRoute, setSosState } = useJourneyStore();
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [isAlertSent, setIsAlertSent] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!visible) {
      setSecondsLeft(5);
      setIsAlertSent(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setSecondsLeft(5);
    setIsAlertSent(false);

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setIsAlertSent(true);
          setSosState('sent');
          if (Platform.OS !== 'web') {
            try {
              Vibration.vibrate([0, 100, 100, 200]);
            } catch (_) {}
          }
          console.log('SOS triggered', {
            location: origin,
            routeId: selectedRoute,
            time: new Date().toISOString(),
          });
          onFinish?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        {!isAlertSent ? (
          <View style={styles.content}>
            <View style={styles.warningIconCircle}>
              <Ionicons name="warning" size={48} color="#FFFFFF" />
            </View>

            <Text style={styles.countdownNumber}>{secondsLeft}</Text>

            <Text style={styles.alertTitle}>Emergency SOS Triggered</Text>
            <Text style={styles.alertDesc}>
              Sending emergency alert to your trusted contacts with live tracking.
            </Text>

            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
              <Text style={styles.cancelButtonText}>CANCEL SOS</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            <View style={[styles.warningIconCircle, { backgroundColor: '#10B981' }]}>
              <Ionicons name="checkmark-circle" size={54} color="#FFFFFF" />
            </View>

            <Text style={styles.alertTitle}>Alert Sent!</Text>
            <Text style={styles.alertDesc}>
              Your emergency contacts and responders have received your live location.
            </Text>

            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: '#FFFFFF' }]}
              onPress={onCancel}
            >
              <Text style={[styles.cancelButtonText, { color: TOKENS.colors.ink[900] }]}>
                DISMISS
              </Text>
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
  warningIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -2,
    lineHeight: 100,
  },
  alertTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
  },
  alertDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  cancelButton: {
    marginTop: 36,
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
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1,
  },
});

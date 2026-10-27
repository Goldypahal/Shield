import React, { useEffect, useRef, useState } from 'react';
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
import PinPromptModal from './PinPromptModal';
import { sendSos, stopActiveSos, cancelCountdownWithPin } from '../../services/sosSession';
import { SosResult } from '../../services/sosService';

interface ScreamSosOverlayProps {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'countdown' | 'sending' | 'sent' | 'stopped' | 'error';

export const SCREAM_SOS_COUNTDOWN_S = 10;

/**
 * Shown when the scream model has heard a scream for ~3 seconds.
 *
 * 1. 10-second countdown, then the SOS goes out: live location to the guardians (parents)
 *    and, if the walker consented at sign-up, to the police.
 * 2. Right after it is sent, a dialog asks for the SOS PIN set during account setup.
 *    Only that PIN stops the SOS; the duress PIN looks the same but keeps it running.
 *
 * A false alarm can be stopped during the countdown too, but only with the PIN, so
 * someone else cannot simply tap it away.
 */
export default function ScreamSosOverlay({ visible, onClose }: ScreamSosOverlayProps) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [secondsLeft, setSecondsLeft] = useState(SCREAM_SOS_COUNTDOWN_S);
  const [result, setResult] = useState<SosResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pinVisible, setPinVisible] = useState(false);
  const [stoppedBeforeSend, setStoppedBeforeSend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    if (!visible) return;
    cancelledRef.current = false;
    setPhase('countdown');
    setSecondsLeft(SCREAM_SOS_COUNTDOWN_S);
    setResult(null);
    setFailure(null);
    setPinVisible(false);
    setStoppedBeforeSend(false);

    if (Platform.OS !== 'web') {
      try { Vibration.vibrate([0, 400, 200, 400]); } catch (_) {}
    }

    let left = SCREAM_SOS_COUNTDOWN_S;
    timerRef.current = setInterval(() => {
      left -= 1;
      setSecondsLeft(left);
      if (left > 0) return;
      clearTimer();
      setPinVisible(false);
      setPhase('sending');
      sendSos('AUDIO_DISTRESS')
        .then((r) => {
          if (cancelledRef.current) return;
          setResult(r);
          setPhase('sent');
          setPinVisible(true); // ask for the setup PIN as soon as the alert is out
        })
        .catch((e: any) => {
          if (cancelledRef.current) return;
          setFailure(e?.message ?? 'The alert could not be sent.');
          setPhase('error');
        });
    }, 1000);

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [visible]);

  /** PIN during the countdown: nothing has left the phone yet. */
  const submitDuringCountdown = async (pin: string): Promise<string | null> => {
    const outcome = await cancelCountdownWithPin(pin, 'AUDIO_DISTRESS');
    if ('message' in outcome) return outcome.message;
    if (timerRef.current === null) {
      // The countdown ran out while the PIN was being checked; the SOS is already going out
      return 'The SOS was already sent. Enter your PIN again to stop it.';
    }
    clearTimer();
    cancelledRef.current = true;
    setPinVisible(false);
    setStoppedBeforeSend(true);
    setPhase('stopped');
    return null;
  };

  /** PIN after sending: the server decides (and handles a duress PIN silently). */
  const submitAfterSend = async (pin: string): Promise<string | null> => {
    const outcome = await stopActiveSos(pin);
    if ('message' in outcome) return outcome.message;
    setPinVisible(false);
    setStoppedBeforeSend(false);
    setPhase('stopped');
    return null;
  };

  const deliveryLine = result
    ? result.delivery === 'server'
      ? 'Your parents can now follow your live location. Police are alerted if you turned police alerts on.'
      : result.fallback === 'sms_composer'
      ? 'No connection to SHIELD. Your alert is saved on this phone and an SMS draft with your location was opened.'
      : result.fallback === 'firebase'
      ? 'The SHIELD server was unreachable, so your parents were alerted through the backup channel.'
      : 'No connection to SHIELD. Your alert is saved on this phone and will send as soon as you are online.'
    : '';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      // The hardware back button must not dismiss an SOS
      onRequestClose={() => { if (phase === 'stopped' || phase === 'error') onClose(); }}
    >
      <View style={[styles.overlay, phase === 'stopped' && { backgroundColor: '#0F7B4F' }]}>
        {phase === 'countdown' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="mic" size={44} color="#FFFFFF" />
            </View>
            <Text style={styles.kicker}>SCREAM DETECTED</Text>
            <Text style={styles.countdown}>{secondsLeft}</Text>
            <Text style={styles.title}>Emergency SOS</Text>
            <Text style={styles.body}>
              Sharing your live location with your parents and the police in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setPinVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="I am safe. Enter PIN to cancel the SOS"
            >
              <Text style={styles.primaryButtonText}>I'M SAFE – ENTER PIN</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'sending' && (
          <View style={styles.content}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={[styles.title, { marginTop: 18 }]}>Sharing your location…</Text>
            <Text style={styles.body}>Alerting your parents and the police.</Text>
          </View>
        )}

        {phase === 'sent' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="location" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>SOS active</Text>
            <Text style={styles.body}>{deliveryLine}</Text>
            <Text style={styles.body}>Enter your SOS PIN to stop it.</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setPinVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Enter PIN to stop the SOS"
            >
              <Text style={styles.primaryButtonText}>ENTER PIN TO STOP</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL('tel:112').catch(() => undefined)}
              style={styles.linkButton}
              accessibilityRole="button"
              accessibilityLabel="Call 112"
            >
              <Text style={styles.linkButtonText}>Call 112</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.linkButton} accessibilityRole="button">
              <Text style={styles.linkButtonSubtle}>Hide (SOS keeps running, stop it in Settings)</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'stopped' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{stoppedBeforeSend ? 'SOS cancelled' : 'SOS stopped'}</Text>
            <Text style={styles.body}>
              {stoppedBeforeSend ? 'Glad you are safe.' : 'Location sharing has ended.'}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={onClose} accessibilityRole="button">
              <Text style={[styles.primaryButtonText, { color: '#0F7B4F' }]}>DONE</Text>
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
            <Text style={styles.body}>If you are in danger, call 112 now.</Text>
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

        <PinPromptModal
          visible={visible && pinVisible && (phase === 'countdown' || phase === 'sent')}
          title={phase === 'countdown' ? 'Are you safe?' : 'Enter your SOS PIN'}
          message={
            phase === 'countdown'
              ? `Enter the PIN you set up to cancel. Otherwise your location is shared in ${secondsLeft}s.`
              : 'Your location is being shared with your parents and the police. Enter the PIN you set up to stop the SOS.'
          }
          confirmLabel={phase === 'countdown' ? 'Cancel SOS' : 'Stop SOS'}
          dismissLabel="Back"
          onSubmit={phase === 'countdown' ? submitDuringCountdown : submitAfterSend}
          onDismiss={() => setPinVisible(false)}
        />
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
    marginBottom: 12,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.85)',
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
    paddingVertical: 12,
  },
  linkButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  linkButtonSubtle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
});

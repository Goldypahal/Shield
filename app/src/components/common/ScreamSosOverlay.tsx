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
import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
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
      ? t('sos.delivered')
      : result.fallback === 'sms_composer'
      ? t('sos.queuedSms')
      : result.fallback === 'firebase'
      ? t('sos.queuedBackup')
      : t('sos.queued')
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
            <Text style={styles.kicker}>{t('sos.screamDetected')}</Text>
            <Text style={styles.countdown}>{secondsLeft}</Text>
            <Text style={styles.title}>{t('sos.title')}</Text>
            <Text style={styles.body}>{t('sos.countdown', { seconds: secondsLeft })}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setPinVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="I am safe. Enter PIN to cancel the SOS"
            >
              <Text style={styles.primaryButtonText}>{t('sos.imSafe')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'sending' && (
          <View style={styles.content}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={[styles.title, { marginTop: 18 }]}>{t('sos.sending')}</Text>
            <Text style={styles.body}>{t('sos.sendingBody')}</Text>
          </View>
        )}

        {phase === 'sent' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="location" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{t('sos.active')}</Text>
            <Text style={styles.body}>{deliveryLine}</Text>
            <Text style={styles.body}>{t('sos.enterPinToStop')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setPinVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Enter PIN to stop the SOS"
            >
              <Text style={styles.primaryButtonText}>{t('sos.enterPinButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL('tel:112').catch(() => undefined)}
              style={styles.linkButton}
              accessibilityRole="button"
              accessibilityLabel="Call 112"
            >
              <Text style={styles.linkButtonText}>{t('sos.call112')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.linkButton} accessibilityRole="button">
              <Text style={styles.linkButtonSubtle}>{t('sos.hide')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'stopped' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{stoppedBeforeSend ? t('sos.cancelled') : t('sos.stopped')}</Text>
            <Text style={styles.body}>
              {stoppedBeforeSend ? t('sos.cancelledBody') : t('sos.stoppedBody')}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={onClose} accessibilityRole="button">
              <Text style={[styles.primaryButtonText, { color: '#0F7B4F' }]}>{t('sos.done')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="alert-circle" size={54} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{t('sos.notSent')}</Text>
            <Text style={styles.body}>{failure}</Text>
            <Text style={styles.body}>{t('sos.inDanger')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => Linking.openURL('tel:112').catch(() => undefined)}
              accessibilityRole="button"
              accessibilityLabel="Call 112"
            >
              <Text style={styles.primaryButtonText}>{t('sos.call112').toUpperCase()}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.linkButton}>
              <Text style={styles.linkButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <PinPromptModal
          visible={visible && pinVisible && (phase === 'countdown' || phase === 'sent')}
          title={phase === 'countdown' ? t('sos.pinTitleCountdown') : t('sos.pinTitleActive')}
          message={
            phase === 'countdown'
              ? t('sos.pinMsgCountdown', { seconds: secondsLeft })
              : t('sos.pinMsgActive')
          }
          confirmLabel={phase === 'countdown' ? t('sos.cancelSos') : t('sos.stopSos')}
          dismissLabel={t('sos.back')}
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

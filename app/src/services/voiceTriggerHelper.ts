import { Platform } from 'react-native';

type VoiceTriggerListener = () => void;
const listeners: Set<VoiceTriggerListener> = new Set();

/**
 * Dispatches a simulated or detected voice SOS trigger to all listeners.
 */
export function triggerVoiceSos(source: string = 'test'): void {
  console.log(`[VoiceTrigger] Triggered by: ${source}`);
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error('[VoiceTrigger] Error in listener callback:', e);
    }
  });

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('heimdal-voice-sos', { detail: { source } }));
    } catch (_) {}
  }
}

/**
 * Subscribes to voice SOS trigger events.
 */
export function onVoiceSosTrigger(callback: VoiceTriggerListener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export interface VoiceSupportInfo {
  isWeb: boolean;
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  hasSpeechRecognition: boolean;
  summary: string;
}

/**
 * Checks browser/device capabilities for voice and microphone SOS.
 */
export function getVoiceSupportInfo(): VoiceSupportInfo {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return {
      isWeb: false,
      isSecureContext: true,
      hasMediaDevices: true,
      hasSpeechRecognition: false,
      summary: 'Native mobile audio listener available.',
    };
  }

  const isSecure = Boolean(
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

  const hasMediaDevices = Boolean(
    navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  );

  const hasSpeech = Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  let summary = 'Voice & scream listener active.';
  if (!isSecure) {
    summary = 'Insecure HTTP: Mobile browsers block mic on HTTP IP. Use HTTPS, localhost, or the Test button.';
  } else if (!hasMediaDevices && !hasSpeech) {
    summary = 'Microphone access is not supported in this browser. Use the Test button.';
  }

  return {
    isWeb: true,
    isSecureContext: isSecure,
    hasMediaDevices,
    hasSpeechRecognition: hasSpeech,
    summary,
  };
}

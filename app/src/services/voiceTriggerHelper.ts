import { Platform } from 'react-native';

export const EMERGENCY_KEYWORDS = [
  'help',
  'help me',
  'save',
  'save me',
  'save me please',
  'please help',
  'please save me',
  'bachao',
  'madad',
  'emergency',
  'scream',
  'danger',
  'police',
  'stop',
  'attack',
  'someone help',
  'help us',
  'choro',
  'bhabho',
];

type VoiceTriggerListener = () => void;
const listeners: Set<VoiceTriggerListener> = new Set();

type PhraseListener = (phrase: string, isMatch: boolean) => void;
const phraseListeners: Set<PhraseListener> = new Set();
let lastHeardPhrase = '';

type StatusListener = (isListening: boolean) => void;
const statusListeners: Set<StatusListener> = new Set();
let isVoiceListeningActive = false;

type MediaStreamListener = (stream: any) => void;
const streamListeners: Set<MediaStreamListener> = new Set();
let activeMediaStream: any = null;

let lastVoiceSosTriggerTime = 0;

/**
 * Dispatches a voice SOS trigger to all listeners.
 */
export function triggerVoiceSos(source: string = 'test'): void {
  const now = Date.now();
  if (now - lastVoiceSosTriggerTime < 5000) {
    console.log(`[VoiceTrigger] Cooldown active, ignoring trigger from ${source}`);
    return;
  }
  lastVoiceSosTriggerTime = now;
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
 * Reports a recognized spoken phrase to active UI indicators.
 */
export function reportHeardPhrase(phrase: string, isMatch: boolean = false): void {
  lastHeardPhrase = phrase;
  phraseListeners.forEach((listener) => {
    try {
      listener(phrase, isMatch);
    } catch (_) {}
  });
}

export function onHeardPhrase(callback: PhraseListener): () => void {
  phraseListeners.add(callback);
  return () => {
    phraseListeners.delete(callback);
  };
}

export function getLastHeardPhrase(): string {
  return lastHeardPhrase;
}

export function isVoiceListening(): boolean {
  return isVoiceListeningActive;
}

export function onVoiceListeningChange(callback: StatusListener): () => void {
  statusListeners.add(callback);
  callback(isVoiceListeningActive);
  return () => {
    statusListeners.delete(callback);
  };
}

function setVoiceListening(active: boolean) {
  isVoiceListeningActive = active;
  statusListeners.forEach((cb) => {
    try {
      cb(active);
    } catch (_) {}
  });
}

export function getActiveMediaStream(): any {
  return activeMediaStream;
}

export function onActiveMediaStream(callback: MediaStreamListener): () => void {
  streamListeners.add(callback);
  if (activeMediaStream) {
    try {
      callback(activeMediaStream);
    } catch (_) {}
  }
  return () => {
    streamListeners.delete(callback);
  };
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

  let summary = 'Voice & scream listener ready.';
  if (!isSecure) {
    summary = 'Insecure HTTP: Browsers require HTTPS to access mic. Open via HTTPS tunnel.';
  } else if (!hasMediaDevices && !hasSpeech) {
    summary = 'Microphone access is not supported in this browser.';
  }

  return {
    isWeb: true,
    isSecureContext: isSecure,
    hasMediaDevices,
    hasSpeechRecognition: hasSpeech,
    summary,
  };
}

let activeSpeechRec: any = null;
let keepListening = false;

function startBrowserSpeechRecognition() {
  if (typeof window === 'undefined') return;
  const SpeechRecClass =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecClass) {
    console.warn('[SpeechRecognition] Speech API not supported in this browser.');
    return;
  }

  try {
    if (activeSpeechRec) {
      try {
        activeSpeechRec.abort();
      } catch (_) {}
      activeSpeechRec = null;
    }

    const rec = new SpeechRecClass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.lang = navigator.language || 'en-US';

    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = String(event.results[i][0]?.transcript || '').toLowerCase().trim();
        console.log('[SpeechRecognition] Heard phrase:', transcript);
        const clean = transcript.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ');
        const matched = EMERGENCY_KEYWORDS.some((kw) => {
          return clean.includes(kw) || transcript.includes(kw);
        });

        reportHeardPhrase(transcript, matched);

        if (matched) {
          console.log(`[SpeechRecognition] MATCH FOR EMERGENCY KEYWORD in "${transcript}" -> TRIGGERING SOS!`);
          triggerVoiceSos(`speech_keyword_${transcript}`);
        }
      }
    };

    rec.onerror = (err: any) => {
      console.warn('[SpeechRecognition] Status:', err?.error);
      if (err?.error === 'not-allowed') {
        setVoiceListening(false);
      }
    };

    rec.onend = () => {
      if (keepListening) {
        // Chrome automatically pauses on long silence; restart automatically
        setTimeout(() => {
          if (keepListening) {
            startBrowserSpeechRecognition();
          }
        }, 200);
      }
    };

    rec.start();
    activeSpeechRec = rec;
    setVoiceListening(true);
    console.log('[SpeechRecognition] Continuous listening active for "help", "save me", "bachao", etc.');
  } catch (e) {
    console.warn('[SpeechRecognition] Start error:', e);
    if (keepListening) {
      setTimeout(startBrowserSpeechRecognition, 1000);
    }
  }
}

/**
 * Explicit user-gesture trigger to request browser microphone permission
 * and start voice recognition within the user tap event.
 */
export async function requestWebMicrophonePermission(): Promise<{ granted: boolean; error?: string }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, error: 'Microphone API not available' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeMediaStream = stream;
    keepListening = true;
    setVoiceListening(true);
    console.log('[Microphone] Stream acquired via user gesture!');
    streamListeners.forEach((listener) => {
      try {
        listener(stream);
      } catch (_) {}
    });

    // Start Web Speech Recognition directly inside this user gesture
    startBrowserSpeechRecognition();

    return { granted: true };
  } catch (err: any) {
    console.warn('[Microphone] User denied or browser error:', err);
    setVoiceListening(false);
    return { granted: false, error: err?.message || String(err) };
  }
}

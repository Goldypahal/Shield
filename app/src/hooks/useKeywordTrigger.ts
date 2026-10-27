import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { optionalNative } from '../utils/nativeModules';
import { matchEmergency, RECOGNIZER_HINTS } from '../services/emergencyKeywords';
import { reportHeardPhrase } from '../services/voiceTriggerHelper';

type SpeechModule = typeof import('expo-speech-recognition');

// Native speech recognition (Android SpeechRecognizer / iOS SFSpeechRecognizer). Expo Go and
// the web don't have it; the web uses the browser's own recogniser (voiceTriggerHelper).
const speech = Platform.OS === 'web'
  ? null
  : optionalNative<SpeechModule>(() => require('expo-speech-recognition'), 'Speech recognition (expo-speech-recognition)');

/**
 * Continuous recognition needs Android 13+ (API 33). Older Android would have to restart
 * the recogniser every few seconds, which beeps each time, so it is not offered there.
 */
export const keywordDetectionAvailable =
  !!speech && (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 33));

/**
 * Listens for spoken cries for help ("help", "bachao", "call the police", see
 * emergencyKeywords.ts) while `enabled`, and calls `onKeyword` with the matched phrase.
 *
 * Runs only while the app is on screen (phones don't allow speech recognition in the
 * background). Prefers on-device recognition, so nothing is sent to a server when the phone
 * has the language pack. Hindi app language listens in Hindi (Devanagari words), others
 * in Indian English ("bachao" and "madad karo" are recognised in English too).
 */
export function useKeywordTrigger(onKeyword: (phrase: string) => void, enabled: boolean, appLang = 'en') {
  const onKeywordRef = useRef(onKeyword);
  onKeywordRef.current = onKeyword;

  useEffect(() => {
    if (!enabled || !speech || !keywordDetectionAvailable) return;
    const M = speech.ExpoSpeechRecognitionModule;
    let stopped = false;
    let failures = 0;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const subs: Array<{ remove: () => void }> = [];

    const start = () => {
      if (stopped) return;
      const onDevice = (() => { try { return M.supportsOnDeviceRecognition(); } catch { return false; } })();
      try {
        M.start({
          lang: appLang === 'hi' ? 'hi-IN' : 'en-IN',
          interimResults: true,
          continuous: true,
          maxAlternatives: 3,
          requiresOnDeviceRecognition: onDevice,
          contextualStrings: RECOGNIZER_HINTS,
          addsPunctuation: false,
          // no "listening" chime and don't take over the audio session on iOS
          iosTaskHint: 'search',
        });
      } catch (e) {
        console.warn('[KeywordTrigger] start failed', e);
        scheduleRestart();
      }
    };

    const scheduleRestart = () => {
      if (stopped || restartTimer) return;
      failures += 1;
      if (failures > 6) {
        console.warn('[KeywordTrigger] speech recognition keeps failing; voice keywords are off until the app restarts');
        return;
      }
      restartTimer = setTimeout(() => { restartTimer = null; start(); }, Math.min(30000, 1000 * 2 ** failures));
    };

    subs.push(M.addListener('result', (ev) => {
      failures = 0;
      for (const r of ev.results) {
        const phrase = matchEmergency(r.transcript, ev.isFinal);
        reportHeardPhrase(r.transcript, phrase !== null);
        if (phrase) {
          onKeywordRef.current(phrase);
          return;
        }
      }
    }));
    subs.push(M.addListener('error', (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'language-not-supported') {
        console.warn('[KeywordTrigger] unavailable:', ev.error, ev.message);
        stopped = true; // permanent for this session
      }
    }));
    // Continuous recognition still ends now and then (silence, Android service limits): restart
    subs.push(M.addListener('end', () => {
      if (!stopped) {
        restartTimer = setTimeout(() => { restartTimer = null; start(); }, 400);
      }
    }));

    (async () => {
      const perm = await M.requestPermissionsAsync().catch(() => null);
      if (!perm?.granted) {
        console.warn('[KeywordTrigger] microphone/speech permission not granted; voice keywords are off');
        return;
      }
      start();
    })();

    return () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      subs.forEach((s) => s.remove());
      try { M.abort(); } catch { /* not running */ }
    };
  }, [enabled, appLang]);
}

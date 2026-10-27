import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { optionalNative } from '../utils/nativeModules';
import { matchEmergency, RECOGNIZER_HINTS } from '../services/emergencyKeywords';
import { reportHeardPhrase } from '../services/voiceTriggerHelper';
import { judgeKeyword, pushLevel, reportHeard, setMicState, getVoiceState } from '../services/voiceMonitor';
import { recognizerRmsToDb, CryDetector } from '../ml/VoiceAnalyzer';
import { setCryProgress } from '../services/voiceMonitor';

type SpeechModule = typeof import('expo-speech-recognition');

// Native speech recognition (Android SpeechRecognizer / iOS SFSpeechRecognizer). Expo Go and
// the web don't have it; the web uses the browser's own recogniser (voiceTriggerHelper).
const speech = Platform.OS === 'web'
  ? null
  : optionalNative<SpeechModule>(() => require('expo-speech-recognition'), 'Speech recognition (expo-speech-recognition)');

const androidVersion = Platform.OS === 'android' ? Number(Platform.Version) : 0;

/** Speech recognition is in this build (Android 8+ or iOS). */
export const keywordDetectionAvailable = !!speech && (Platform.OS === 'ios' || androidVersion >= 26);

/**
 * Android 13+ records the microphone inside SHIELD and hands the audio to the recogniser
 * (continuous, no start beep), so the scream listener can run at the same time. On older
 * Android the recogniser records in the Google app; two apps cannot share the microphone
 * there, so while the app is open the recogniser has it and loudness comes from its volume.
 */
export const keywordsNeedExclusiveMic = Platform.OS === 'android' && androidVersion < 33;

interface Attempt { lang: string; onDevice: boolean }

/**
 * Listens for spoken cries for help ("help", "bachao", "call the police", see
 * emergencyKeywords.ts) while `enabled`. A recognised phrase starts an SOS when it was said
 * in a raised voice (voiceMonitor.judgeKeyword: at or above the walker's trigger level,
 * normal speech + 15 %), so a calm "can you help me with this" in a conversation does not.
 *
 * Phones don't allow speech recognition in the background, so it runs while the app is
 * open. Recognition is on the phone when it has the language pack, else Google's online
 * recogniser; if a language is not available it falls back to the next one.
 */
export function useKeywordTrigger(onKeyword: (phrase: string) => void, enabled: boolean, appLang = 'en', onCry?: () => void) {
  const onKeywordRef = useRef(onKeyword);
  onKeywordRef.current = onKeyword;
  const onCryRef = useRef(onCry);
  onCryRef.current = onCry;

  useEffect(() => {
    if (!enabled || !speech || !keywordDetectionAvailable) {
      if (Platform.OS !== 'web') setMicState('keywords', enabled && !keywordDetectionAvailable ? 'unavailable' : 'off');
      return;
    }
    const M = speech.ExpoSpeechRecognitionModule;
    let stopped = false;
    let quickEnds = 0; // sessions that ended within 2 s without hearing anything
    let sessionStart = 0;
    let heardThisSession = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const subs: Array<{ remove: () => void }> = [];
    const onDeviceOk = (() => { try { return M.supportsOnDeviceRecognition(); } catch { return false; } })();
    const primary = appLang === 'hi' ? 'hi-IN' : 'en-IN';
    const attempts: Attempt[] = [
      ...(onDeviceOk ? [{ lang: primary, onDevice: true }] : []),
      { lang: primary, onDevice: false },
      { lang: 'en-US', onDevice: false },
    ];
    let attempt = 0;
    const continuous = Platform.OS === 'ios' || androidVersion >= 33;

    const start = () => {
      if (stopped) return;
      const a = attempts[Math.min(attempt, attempts.length - 1)];
      try {
        M.start({
          lang: a.lang,
          interimResults: true,
          continuous,
          maxAlternatives: 3,
          requiresOnDeviceRecognition: a.onDevice,
          contextualStrings: RECOGNIZER_HINTS,
          addsPunctuation: false,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
          // Older Android: keep each session open as long as the recogniser allows
          ...(continuous ? {} : {
            androidIntentOptions: {
              EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
              EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
              EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 15000,
            },
          }),
          iosTaskHint: 'search',
        });
      } catch (e) {
        console.warn('[KeywordTrigger] start failed', e);
        quickEnds += 1;
        scheduleRestart();
      }
    };

    const scheduleRestart = () => {
      if (stopped || restartTimer) return;
      if (quickEnds > 10) {
        setMicState('keywords', 'error', 'Speech recognition keeps failing. Voice keywords are paused; scream detection still works.');
        return;
      }
      const delay = quickEnds === 0 ? (continuous ? 300 : 150) : Math.min(15000, 400 * 2 ** quickEnds);
      restartTimer = setTimeout(() => { restartTimer = null; start(); }, delay);
    };

    subs.push(M.addListener('start', () => {
      sessionStart = Date.now();
      heardThisSession = false;
      setMicState('keywords', 'on', getVoiceState().note?.startsWith('Speech recognition') ? null : undefined);
    }));
    // When the recogniser has the microphone to itself (older Android, app open), a long
    // loud cry is judged from its volume: 6 dB over the trigger level for 2.5 s
    const cry = new CryDetector();
    let lastVol = 0;
    subs.push(M.addListener('volumechange', (ev: { value: number }) => {
      const db = recognizerRmsToDb(ev.value);
      pushLevel(db, 'speech', { voiced: ev.value > 3 });
      if (keywordsNeedExclusiveMic && onCryRef.current) {
        const now = Date.now();
        const st = cry.push(db >= getVoiceState().triggerDb + 6, now, lastVol ? Math.min(500, now - lastVol) : 200);
        lastVol = now;
        setCryProgress(st.sustainedMs);
        if (st.triggered) onCryRef.current();
      }
    }));
    subs.push(M.addListener('result', (ev) => {
      heardThisSession = true;
      quickEnds = 0;
      for (const r of ev.results) {
        const phrase = matchEmergency(r.transcript, ev.isFinal);
        reportHeard(r.transcript);
        reportHeardPhrase(r.transcript, phrase !== null);
        if (phrase) {
          if (judgeKeyword(phrase)) onKeywordRef.current(phrase);
          return;
        }
      }
    }));
    subs.push(M.addListener('error', (ev) => {
      console.warn('[KeywordTrigger] error:', ev.error, ev.message);
      if (ev.error === 'not-allowed') {
        stopped = true;
        setMicState('keywords', 'denied', 'Microphone or speech permission is off. Allow it to use voice keywords.');
      } else if (ev.error === 'language-not-supported' || ev.error === 'service-not-allowed' || ev.error === 'network') {
        // next recogniser: on-device -> online -> English (US)
        if (attempt < attempts.length - 1) {
          attempt += 1;
          console.warn('[KeywordTrigger] falling back to', attempts[attempt]);
        }
      }
      // 'no-speech', 'speech-timeout', 'aborted', 'busy': 'end' follows and restarts
    }));
    // Continuous recognition still ends now and then (silence, service limits): restart
    subs.push(M.addListener('end', () => {
      const quick = !heardThisSession && Date.now() - sessionStart < 2000;
      quickEnds = quick ? quickEnds + 1 : 0;
      if (!stopped) scheduleRestart();
    }));

    (async () => {
      setMicState('keywords', 'starting');
      const perm = await M.requestPermissionsAsync().catch(() => null);
      if (!perm?.granted) {
        setMicState('keywords', 'denied', 'Microphone or speech permission is off. Allow it to use voice keywords.');
        return;
      }
      if (!M.isRecognitionAvailable()) {
        setMicState('keywords', 'unavailable', 'This phone has no speech recogniser (install or update the Google app). Scream detection still works.');
        return;
      }
      start();
    })();

    return () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      subs.forEach((s) => s.remove());
      try { M.abort(); } catch { /* not running */ }
      setMicState('keywords', 'off');
    };
  }, [enabled, appLang]);
}

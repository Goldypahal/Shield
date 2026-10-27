import { AppState, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { sendSos, stopActiveSos, cancelCountdownWithPin, StopResult } from './sosSession';
import type { SosResult } from './sosService';

/**
 * The scream SOS, independent of what is on screen.
 *
 * In the foreground the overlay shows it. With the app in the background (screen off, phone
 * in a bag) JavaScript timers are paused on Android, so the countdown is also advanced by
 * every microphone chunk the scream listener receives (`tick`). Whichever comes first sends
 * the SOS, exactly once. The walker is told by a notification and stops it with the PIN
 * when they open the app.
 */
export const SCREAM_SOS_COUNTDOWN_S = 10;

export type ScreamSosPhase = 'idle' | 'countdown' | 'sending' | 'sent' | 'stopped' | 'error';

export interface ScreamSosState {
  phase: ScreamSosPhase;
  /** ms epoch at which the countdown ends (countdown phase) */
  deadline: number;
  result: SosResult | null;
  failure: string | null;
  stoppedBeforeSend: boolean;
}

const IDLE: ScreamSosState = { phase: 'idle', deadline: 0, result: null, failure: null, stoppedBeforeSend: false };

const CHANNEL_ID = 'scream-sos';
const NOTIFICATION_ID = 'scream-sos';

let state: ScreamSosState = IDLE;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(s: ScreamSosState) => void>();

function set(patch: Partial<ScreamSosState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

const inBackground = () => Platform.OS !== 'web' && AppState.currentState !== 'active';

let channelReady: Promise<void> | null = null;
function ensureChannel() {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Scream SOS',
    description: 'Shown when SHIELD heard a scream and is about to send, or has sent, an SOS.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  }).then(() => undefined).catch(() => undefined);
  return channelReady;
}

/** Replaces the single scream-SOS notification (only used while the app is not on screen). */
async function notify(title: string, body: string) {
  if (Platform.OS === 'web') return;
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: { title, body, priority: Notifications.AndroidNotificationPriority.MAX, sticky: true },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch (e) {
    console.warn('[ScreamSOS] notification failed', e);
  }
}

function clearNotification() {
  if (Platform.OS === 'web') return;
  Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => undefined);
}

function send() {
  stopTimer();
  set({ phase: 'sending' });
  sendSos('AUDIO_DISTRESS')
    .then((result) => {
      if (state.phase !== 'sending') return; // stopped meanwhile
      set({ phase: 'sent', result });
      if (inBackground()) {
        notify('SOS sent', 'Your location went to your guardians. Open SHIELD and enter your PIN to stop it.');
      }
    })
    .catch((e: any) => {
      if (state.phase !== 'sending') return;
      const failure = e?.message ?? 'The alert could not be sent.';
      set({ phase: 'error', failure });
      if (inBackground()) notify('SOS could not be sent', `${failure} If you are in danger, call 112.`);
    });
}

const ScreamSosController = {
  getState: () => state,

  subscribe(listener: (s: ScreamSosState) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  /** The scream model heard ~3 s of screaming. Ignored while a scream SOS is already running. */
  start() {
    if (state.phase === 'countdown' || state.phase === 'sending' || state.phase === 'sent') return;
    set({ ...IDLE, phase: 'countdown', deadline: Date.now() + SCREAM_SOS_COUNTDOWN_S * 1000 });
    if (Platform.OS !== 'web') {
      try { Vibration.vibrate([0, 400, 200, 400]); } catch (_) {}
    }
    if (inBackground()) {
      notify('Scream detected: SOS in 10 seconds',
        'Open SHIELD and enter your PIN if you are safe. Otherwise your location goes to your guardians.');
    }
    stopTimer();
    timer = setInterval(() => ScreamSosController.tick(), 250);
  },

  /** Advances the countdown; called by the foreground timer and by each microphone chunk. */
  tick(now = Date.now()) {
    if (state.phase === 'countdown' && now >= state.deadline) send();
  },

  secondsLeft(now = Date.now()) {
    return Math.max(0, Math.ceil((state.deadline - now) / 1000));
  },

  /** PIN during the countdown: nothing has left the phone yet. */
  async cancelWithPin(pin: string): Promise<StopResult> {
    const outcome = await cancelCountdownWithPin(pin, 'AUDIO_DISTRESS');
    if ('message' in outcome) return outcome;
    if (state.phase !== 'countdown') {
      return { ok: false, message: 'The SOS was already sent. Enter your PIN again to stop it.' };
    }
    stopTimer();
    clearNotification();
    set({ phase: 'stopped', stoppedBeforeSend: true });
    return { ok: true };
  },

  /** PIN after sending: the server decides (and handles a duress PIN silently). */
  async stopWithPin(pin: string): Promise<StopResult> {
    const outcome = await stopActiveSos(pin);
    if ('message' in outcome) return outcome;
    clearNotification();
    set({ phase: 'stopped', stoppedBeforeSend: false });
    return { ok: true };
  },

  /** Closes the overlay. A sent SOS keeps running; only the PIN stops it. */
  dismiss() {
    if (state.phase === 'countdown' || state.phase === 'sending') return;
    clearNotification();
    stopTimer();
    state = IDLE;
    listeners.forEach((l) => l(state));
  },
};

export default ScreamSosController;

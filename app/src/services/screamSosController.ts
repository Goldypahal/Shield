import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { sendSos, stopActiveSos, cancelCountdownWithPin, getActiveSos, StopResult } from './sosSession';
import type { SosResult } from './sosService';
import AlarmSoundService from './alarmSoundService';

/** What started the SOS. */
export type AutoSosTrigger = 'SOS_BUTTON' | 'AUDIO_DISTRESS' | 'FALL' | 'SHAKE' | 'VOICE';

/**
 * Every visible SOS (SOS button, scream, fall, voice keyword, shake), independent of what is
 * on screen. One rule for all of them: once started, only the SOS PIN stands it down,
 * during the countdown and after sending. The siren and vibration run from the start until
 * the PIN is accepted.
 *
 * In the foreground the overlay shows it. With the app in the background (screen off, phone
 * in a bag) JavaScript timers are paused on Android, so the countdown is also advanced by
 * every microphone chunk the scream listener receives (`tick`). Whichever comes first sends
 * the SOS, exactly once. The walker is told by a notification and stops it with the PIN
 * when they open the app. A sent SOS survives an app restart (see `restore`).
 */
export const SCREAM_SOS_COUNTDOWN_S = 10;
/** Seconds before the alert goes out, per trigger. The button is deliberate, so shorter. */
export const COUNTDOWN_S: Record<AutoSosTrigger, number> = {
  SOS_BUTTON: 5, AUDIO_DISTRESS: SCREAM_SOS_COUNTDOWN_S, FALL: 10, SHAKE: 10, VOICE: 10,
};

const NOTIFY_TITLE: Record<AutoSosTrigger, string> = {
  SOS_BUTTON: 'SOS starting',
  AUDIO_DISTRESS: 'Scream detected',
  FALL: 'Fall detected',
  SHAKE: 'Shake detected',
  VOICE: 'Help call detected',
};

export type ScreamSosPhase = 'idle' | 'countdown' | 'sending' | 'sent' | 'stopped' | 'error';

export interface ScreamSosState {
  phase: ScreamSosPhase;
  trigger: AutoSosTrigger;
  /** ms epoch at which the countdown ends (countdown phase) */
  deadline: number;
  result: SosResult | null;
  failure: string | null;
  stoppedBeforeSend: boolean;
}

const IDLE: ScreamSosState = { phase: 'idle', trigger: 'AUDIO_DISTRESS', deadline: 0, result: null, failure: null, stoppedBeforeSend: false };

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
    name: 'SOS',
    description: 'Shown when an SOS is about to be sent, or has been sent.',
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
  AlarmSoundService.startSiren(); // in case it was interrupted
  set({ phase: 'sending' });
  sendSos(state.trigger)
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
      AlarmSoundService.stopSiren(); // nothing is active, so nothing to stand down
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

  /** Is an SOS running (counting down, sending or sent)? */
  isActive() {
    return state.phase === 'countdown' || state.phase === 'sending' || state.phase === 'sent';
  },

  /**
   * Starts the SOS countdown with the siren. Ignored while one is already running.
   * Triggers: the SOS button, ~3 s of screaming, a fall followed by stillness, a help
   * keyword, or shaking the phone.
   */
  start(trigger: AutoSosTrigger = 'AUDIO_DISTRESS') {
    if (ScreamSosController.isActive()) return;
    const seconds = COUNTDOWN_S[trigger];
    set({ ...IDLE, trigger, phase: 'countdown', deadline: Date.now() + seconds * 1000 });
    AlarmSoundService.startSiren();
    if (inBackground()) {
      notify(`${NOTIFY_TITLE[trigger]}: SOS in ${seconds} seconds`,
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
    const outcome = await cancelCountdownWithPin(pin, state.trigger);
    if ('message' in outcome) return outcome;
    if (state.phase !== 'countdown') {
      return { ok: false, message: 'The SOS was already sent. Enter your PIN again to stop it.' };
    }
    stopTimer();
    clearNotification();
    AlarmSoundService.stopSiren();
    set({ phase: 'stopped', stoppedBeforeSend: true });
    return { ok: true };
  },

  /** PIN after sending: the server decides (and handles a duress PIN silently). */
  async stopWithPin(pin: string): Promise<StopResult> {
    const outcome = await stopActiveSos(pin);
    if ('message' in outcome) return outcome;
    clearNotification();
    AlarmSoundService.stopSiren();
    set({ phase: 'stopped', stoppedBeforeSend: false });
    return { ok: true };
  },

  /**
   * After an app restart: a visible SOS that was sent and never stood down comes back on
   * screen, with the siren, until the PIN is entered.
   */
  async restore() {
    if (state.phase !== 'idle') return;
    const active = await getActiveSos().catch(() => null);
    if (!active || active.silent || state.phase !== 'idle') return;
    set({ ...IDLE, phase: 'sent', result: { alertId: active.alertId, delivery: 'queued', locationKnown: false, fallback: 'none' } });
    AlarmSoundService.startSiren();
  },

  /** Closes the overlay; only allowed once nothing is running (stopped with the PIN, or never sent). */
  dismiss() {
    if (ScreamSosController.isActive()) return;
    clearNotification();
    stopTimer();
    AlarmSoundService.stopSiren();
    state = IDLE;
    listeners.forEach((l) => l(state));
  },
};

export default ScreamSosController;

/** Same controller under a clearer name: it serves every SOS trigger, not only screams. */
export const SosController = ScreamSosController;

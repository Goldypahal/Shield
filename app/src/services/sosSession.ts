import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError } from 'axios';
import AuthService from './authService';
import LocationTracker from './LocationTracker';
import OfflineQueue from './OfflineQueue';
import { checkPinOffline } from './pinVault';
import ContactService from './contactService';
import { triggerEmergency, SosResult } from './sosService';
import { TriggerType } from './OfflineQueue';

/**
 * The SOS that is currently running on this phone, kept across app restarts so it
 * cannot be "stopped" by killing the app. Only the SOS PIN stands it down.
 */
const ACTIVE_KEY = '@shield_active_sos';

export type StopResult =
  | { ok: true }
  | { ok: false; message: string };

/** `silent`: sent without sound or on-screen banner; it can still be stopped from Settings. */
export async function setActiveSos(alertId: string, silent = false): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify({ alertId, startedAt: Date.now(), silent }));
}

export async function getActiveSos(): Promise<{ alertId: string; startedAt: number; silent?: boolean } | null> {
  try {
    return JSON.parse((await AsyncStorage.getItem(ACTIVE_KEY)) || 'null');
  } catch {
    return null;
  }
}

/**
 * Sends an SOS with nothing on screen: no countdown, sound, popup or banner. Used for the
 * silent SOS button and the duress code in the calculator disguise.
 */
export async function sendSilentSos(trigger: TriggerType = 'SOS_BUTTON'): Promise<void> {
  const session = await AuthService.ensureSession();
  if (!session) return;
  const contacts = await ContactService.listContacts().catch(() => []);
  const result = await triggerEmergency(
    { uid: session.uid, name: session.name, phone: session.phone, emergencyContacts: contacts, sensitivityMode: 'NORMAL' },
    90, 'HIGH', trigger, { silent: true });
  await setActiveSos(result.alertId, true);
}

/**
 * Visible SOS (navbar button or press-and-hold): the countdown already passed, so this
 * raises the real alert, persists it on the device and starts live sharing.
 */
export async function sendSos(trigger: TriggerType = 'SOS_BUTTON'): Promise<SosResult> {
  const session = await AuthService.ensureSession();
  if (!session) throw new Error('Sign in to send an SOS.');
  const contacts = await ContactService.listContacts().catch(() => []);
  const result = await triggerEmergency(
    { uid: session.uid, name: session.name, phone: session.phone, emergencyContacts: contacts, sensitivityMode: 'NORMAL' },
    90, 'HIGH', trigger);
  await setActiveSos(result.alertId, false);
  return result;
}

async function finish() {
  LocationTracker.stopBroadcastingSOS();
  await AsyncStorage.removeItem(ACTIVE_KEY);
}

/**
 * Stops the running SOS with the PIN. The server decides when it can be reached
 * (a duress PIN there looks like success but keeps the alert going). Without a
 * connection, an alert that never left the phone is checked against the PIN hashes
 * on this device; one the server already has can only be stopped online.
 */
export async function stopActiveSos(pin: string): Promise<StopResult> {
  const active = await getActiveSos();
  if (!active) return { ok: true };

  if (await OfflineQueue.isQueued(active.alertId)) {
    const kind = await checkPinOffline(pin);
    if (kind === 'unknown') {
      return { ok: false, message: 'No connection, and this phone cannot check your PIN offline. The SOS stays on and will send when you are back online.' };
    }
    if (kind === null) return { ok: false, message: 'Incorrect PIN. The SOS is still active.' };
    // Duress: leave the alert queued so it still goes out, but look stopped
    if (kind === 'normal') await OfflineQueue.remove(active.alertId);
    await finish();
    return { ok: true };
  }

  try {
    const client = await AuthService.getAuthenticatedClient();
    await client.put(`/api/v1/alerts/${active.alertId}/state`, { state: 'CANCELLED', pin, reason: 'Stopped by walker' });
    await finish();
    return { ok: true };
  } catch (e) {
    const status = (e as AxiosError).response?.status;
    if (status === 403) return { ok: false, message: 'Incorrect PIN. The SOS is still active.' };
    if (status === 423) return { ok: false, message: 'Too many wrong PINs. Your guardians have been alerted; try again in 15 minutes.' };
    if (status === 404 || status === 409) {
      await finish(); // already closed on the server (e.g. resolved by a responder)
      return { ok: true };
    }
    return { ok: false, message: 'No connection to SHIELD. The SOS stays active until it can be stopped online.' };
  }
}

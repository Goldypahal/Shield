import 'react-native-get-random-values'; // must load before uuid
import { v4 as uuidv4 } from 'uuid';
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { functions, storage, isFirebaseConfigured } from '../firebase/config';
import { createIncident, updateIncident } from './firestoreService';
import { buildMapsLink } from './locationService';
import { stopIncidentRecording } from './audioService';
import { IncidentLog, UserProfile } from '../types';
import LocationTracker from './LocationTracker';
import ContactService from './contactService';
import OfflineQueue, { TriggerType } from './OfflineQueue';
import { startSosBroadcast } from './bleRelay';

const GPS_TIMEOUT_MS = 8000;

export type SosChannel = 'INTERNET' | 'SMS' | 'BLUETOOTH_MESH';

export type SosResult = {
  alertId: string;
  /** 'server': guardians are being notified by the backend; 'queued': stored on device, retrying. */
  delivery: 'server' | 'queued';
  locationKnown: boolean;
  fallback: 'none' | 'firebase' | 'sms_composer' | 'unavailable';
  channel?: SosChannel;
};

async function uploadAudio(uri: string, userId: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const path = `incident-audio/${userId}/${Date.now()}.m4a`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}

/**
 * Best available fix: a fresh one if it comes quickly, else the last known one, else none.
 * In the background (a scream SOS with the screen off) a fresh fix is not attempted:
 * Android pauses JS timers there, so the 8 s timeout could never fire, and location
 * "while in use" is not granted to a backgrounded app anyway. The last known fix is sent.
 */
async function bestEffortLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const backgrounded = Platform.OS !== 'web' && AppState.currentState !== 'active';
  if (!backgrounded) {
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS))
      ]);
      if (fresh) return fresh.coords;
    } catch {
      // fall through to last known
    }
  }
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last) return last.coords;
  } catch {
    // no fix at all
  }
  return null;
}

/**
 * Raises an SOS. Never throws before the alert is stored on the device, and
 * never invents a location: without a fix the alert says so, instead of
 * pointing guardians somewhere wrong.
 */
export async function triggerEmergency(
  profile: UserProfile,
  threatScore: number,
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH',
  trigger: TriggerType = 'SOS_BUTTON',
  options: { silent?: boolean } = {}
): Promise<SosResult> {
  const alertId = uuidv4();
  const coords = await bestEffortLocation();
  const latitude = coords?.latitude ?? 0;
  const longitude = coords?.longitude ?? 0;
  const mapsLink = coords ? buildMapsLink(latitude, longitude) : null;

  // 1. Persist first, then attempt delivery
  const delivery = await OfflineQueue.queueAlert({
    id: alertId,
    trigger_type: trigger,
    lat: latitude,
    lon: longitude,
    priority: threatLevel,
    message: coords ? undefined : 'Location unavailable at trigger time'
  });

  // 2. Live location for guardians once the server knows the alert
  if (delivery === 'synced') {
    LocationTracker.startBroadcastingSOS(alertId).catch((e) => console.warn('Live location failed to start', e));
  }

  // 3. Local incident history (best effort; must never block the SOS)
  const incident: IncidentLog = {
    id: alertId,
    userId: profile.uid,
    timestamp: Date.now(),
    latitude,
    longitude,
    threatScore,
    threatLevel,
    status: delivery === 'synced' ? 'SENT' : 'PENDING'
  };
  let incidentId = alertId;
  try {
    incidentId = await createIncident(incident);
  } catch (e) {
    console.warn('Could not record local incident history', e);
  }

  // =========================================================================
  // METHOD 1: INTERNET IS AVAILABLE
  // When network data connectivity exists, sync alert to SHIELD cloud API
  // and broadcast live telemetry to guardians and police.
  // =========================================================================
  if (delivery === 'synced') {
    return {
      alertId,
      delivery: 'server',
      locationKnown: !!coords,
      fallback: 'none',
      channel: 'INTERNET',
    };
  }

  // =========================================================================
  // METHOD 2: INTERNET NOT AVAILABLE -> CELLULAR SMS SERVICES (SMS POPUP)
  // When internet connection is absent, pop up the device's native SMS composer
  // with pre-filled coordinates and distress message to trusted contacts.
  // =========================================================================
  let smsOpened = false;
  const contacts = profile.emergencyContacts.length > 0
    ? profile.emergencyContacts
    : await ContactService.listContacts().catch(() => []);

  if (!options.silent && contacts.length > 0) {
    const text = `SHIELD SOS: ${profile.name} needs emergency help! ` +
      (mapsLink ? `Current Location: ${mapsLink}` : 'Location unavailable.') +
      ' Immediate assistance required. Call 112.';
    smsOpened = await OfflineQueue.openSmsFallback(contacts.map((c) => c.phone), text);
  }

  // =========================================================================
  // METHOD 3: NO NETWORK / CELLULAR DEAD ZONE -> BLUETOOTH MESH RELAY
  // When internet is unavailable, broadcast signed SOS packet over Bluetooth LE
  // so nearby SHIELD devices can pick up the packet and relay it to the cloud.
  // =========================================================================
  let bleActive = false;
  if (coords) {
    try {
      bleActive = await startSosBroadcast({
        alertId,
        uid: profile.uid,
        trigger,
        latitude: coords.latitude,
        longitude: coords.longitude,
        priority: threatLevel,
      });
      if (bleActive) {
        console.info('[SOS] Bluetooth relay beacon active: broadcasting SOS packet to nearby devices');
      }
    } catch (e) {
      console.warn('[SOS] BLE relay broadcast could not start', e);
    }
  }

  // Optional Firebase fallback if configured
  if (!options.silent && isFirebaseConfigured) {
    try {
      let audioUrl: string | undefined;
      const localAudioUri = await stopIncidentRecording();
      if (localAudioUri) audioUrl = await uploadAudio(localAudioUri, profile.uid);
      await httpsCallable(functions, 'sendEmergencyAlerts')({
        incidentId, userName: profile.name, contacts, mapsLink: mapsLink ?? 'location unavailable',
        audioUrl, threatScore, threatLevel
      });
      await updateIncident(incidentId, { status: 'SENT', delivery: { sms: true, call: true }, audioUrl });
      return { alertId, delivery: 'queued', locationKnown: !!coords, fallback: 'firebase', channel: 'INTERNET' };
    } catch (e) {
      console.warn('Firebase fallback failed', e);
    }
  }

  return {
    alertId,
    delivery: 'queued',
    locationKnown: !!coords,
    fallback: smsOpened ? 'sms_composer' : 'unavailable',
    channel: smsOpened ? 'SMS' : (bleActive ? 'BLUETOOTH_MESH' : 'SMS'),
  };
}

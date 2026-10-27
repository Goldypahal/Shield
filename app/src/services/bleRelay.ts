import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError } from 'axios';
import {
  addDeviceFoundListener,
  addEventListener,
  connect,
  disconnect,
  discoverServices,
  getCapabilities,
  isBluetoothEnabled,
  readCharacteristic,
  requestBluetoothPermission,
  setServices,
  startAdvertising,
  startScan,
  stopAdvertising,
  stopScan,
} from 'munim-bluetooth';
import AuthService from './authService';
import {
  buildRelayPayload,
  decodeFromRadio,
  encodeForRadio,
  RelayAlertInput,
  RelayPayload,
  relayIsConfigured,
} from './bleRelayPayload';
import type { BLEDevice } from 'munim-bluetooth';

/**
 * The Bluetooth SOS relay: how an alert gets out with no network at all.
 *
 * Two roles, and any SHIELD phone can be either:
 *
 * - Broadcast (the walker in trouble). No signal, so the alert cannot be uploaded. The
 *   phone advertises a SHIELD service and publishes the signed payload on a readable
 *   GATT characteristic. It keeps doing this until the alert reaches the server.
 * - Relay (anyone else nearby). Scans for that service, connects, reads the payload,
 *   checks the signature and uploads it to the API on the walker's behalf.
 *
 * What this is not: Bluetooth cannot reach a guardian or 112 by itself. Its range is tens
 * of metres, so the alert only travels as far as the next SHIELD phone, which is what
 * makes a campus or a busy street work and an empty road not.
 *
 * The payload is readable by any device in range while an alert is active, because GATT
 * reads that require encryption need a pairing step that cannot happen mid-emergency.
 * The signature makes the payload unforgeable in transit; it does not keep the walker's
 * coordinates private on the air. See docs/ROADMAP.md.
 */

/** Advertised by a phone that cannot reach the network; scanned for by everyone else. */
const SOS_SERVICE_UUID = '6f1e9d40-1c2b-4a7e-9f31-8b2d5c7a4e10';
/** Holds the signed payload as UTF-8 JSON, hex encoded (BLE characteristic values are hex). */
const SOS_PAYLOAD_UUID = '6f1e9d40-1c2b-4a7e-9f31-8b2d5c7a4e11';
/** Short on purpose: a long local name squeezes a 128-bit service UUID out of a legacy advert. */
const LOCAL_NAME = 'SHIELD-SOS';

const SEEN_KEY = '@shield_relayed_alerts';
const PENDING_KEY = '@shield_relay_pending';
const SEEN_MAX = 200; // enough to suppress repeats inside one alert's lifetime
const PENDING_MAX = 50;
/** Don't re-connect to the same phone over and over while its advert keeps appearing. */
const DEVICE_COOLDOWN_MS = 60_000;
const READ_TIMEOUT_MS = 12_000;

type UploadOutcome = 'sent' | 'skip' | 'queued';

let broadcasting = false;
let scanning = false;
// Kept per role: tearing down a broadcast must not also remove the scanner's listeners.
let broadcastListeners: (() => void)[] = [];
let scanListeners: (() => void)[] = [];
let scanRetry: ReturnType<typeof setTimeout> | null = null;
let warnedUnconfigured = false;
const inFlight = new Set<string>();
const recentDevices = new Map<string, number>();

function release(listeners: (() => void)[]): void {
  for (const off of listeners) {
    try {
      off();
    } catch {
      // already removed
    }
  }
}

export function isBroadcasting(): boolean {
  return broadcasting;
}

export function isScanningForRelays(): boolean {
  return scanning;
}

// --- small device-side caches ------------------------------------------------------

async function readList(key: string): Promise<string[]> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

async function alreadyRelayed(alertId: string): Promise<boolean> {
  return (await readList(SEEN_KEY)).includes(alertId);
}

async function markRelayed(alertId: string): Promise<void> {
  const seen = (await readList(SEEN_KEY)).filter((id) => id !== alertId);
  seen.push(alertId);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
}

async function readPending(): Promise<RelayPayload[]> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || '[]');
    return Array.isArray(raw) ? (raw as RelayPayload[]) : [];
  } catch {
    return [];
  }
}

async function enqueuePending(payload: RelayPayload): Promise<void> {
  const pending = (await readPending()).filter((p) => p.id !== payload.id);
  pending.push(payload);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-PENDING_MAX)));
}

// --- upload ------------------------------------------------------------------------

/**
 * Hands a relayed payload to the API.
 *
 * 'skip' means the server will never accept it (already stored, an id clash, or we are
 * the walker), so retrying would only cost battery. Anything else counts as 'queued':
 * an emergency alert is worth retrying for a long time, and the API dedups on the
 * client-generated id, so a duplicate upload is harmless.
 */
async function upload(payload: RelayPayload): Promise<UploadOutcome> {
  try {
    const client = await AuthService.getAuthenticatedClient();
    await client.post('/api/v1/alerts/relay', payload, { timeout: 8000 });
    return 'sent';
  } catch (error) {
    const status = (error as AxiosError).response?.status;
    if (status !== undefined && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) {
      return 'skip';
    }
    return 'queued';
  }
}

/** Carries anything we picked up while this phone was offline too. */
export async function flushRelayQueue(): Promise<void> {
  const pending = await readPending();
  if (pending.length === 0) return;
  const remaining: RelayPayload[] = [];
  for (const payload of pending) {
    const outcome = await upload(payload);
    if (outcome === 'queued') remaining.push(payload);
    else await markRelayed(payload.id);
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
}

// --- the walker in trouble: broadcast ----------------------------------------------

/**
 * Advertises an SOS that could not be uploaded. Returns false when there is nothing to
 * advertise (no key configured, no GPS fix) or Bluetooth is off or refused - in which
 * case the caller keeps the alert queued and the SMS fallback still applies.
 */
export async function startSosBroadcast(input: RelayAlertInput): Promise<boolean> {
  if (broadcasting) return true;
  if (!relayIsConfigured()) return false;
  const payload = await buildRelayPayload(input);
  if (!payload) return false;

  try {
    const granted = await requestBluetoothPermission(['advertise']);
    if (!granted) return false;
    if (!(await isBluetoothEnabled())) return false;
    const caps = await getCapabilities().catch(() => null);
    if (caps && !caps.supportsBlePeripheral) return false;

    // A phone raising an SOS should not also be acting as a relay; one radio, one job.
    stopRelayScanner();

    setServices([{
      uuid: SOS_SERVICE_UUID,
      characteristics: [{
        uuid: SOS_PAYLOAD_UUID,
        properties: ['read'],
        permissions: ['read'],
        value: encodeForRadio(payload),
      }],
    }]);
    // startAdvertising is fire-and-forget; failure arrives on advertisingStartFailed.
    broadcastListeners.push(addEventListener('advertisingStartFailed', (info) => {
      console.warn('BLE SOS advertising failed', info);
      broadcasting = false;
    }));
    startAdvertising({ serviceUUIDs: [SOS_SERVICE_UUID], localName: LOCAL_NAME });
    broadcasting = true;
    return true;
  } catch (error) {
    console.warn('Could not start the Bluetooth SOS broadcast', error);
    broadcasting = false;
    return false;
  }
}

/** Called once the alert reaches the server, or when the SOS is stood down. */
export async function stopSosBroadcast(): Promise<void> {
  if (!broadcasting) return;
  broadcasting = false;
  try {
    stopAdvertising();
  } catch (error) {
    console.warn('Could not stop the Bluetooth SOS broadcast', error);
  }
  release(broadcastListeners);
  broadcastListeners = [];
}

// --- everyone else: scan, read, carry ----------------------------------------------

async function carry(device: BLEDevice): Promise<void> {
  if (inFlight.has(device.id)) return;
  const lastAttempt = recentDevices.get(device.id) ?? 0;
  if (Date.now() - lastAttempt < DEVICE_COOLDOWN_MS) return;
  recentDevices.set(device.id, Date.now());
  inFlight.add(device.id);

  try {
    await connect(device.id, { timeoutMs: READ_TIMEOUT_MS });
    const services = await discoverServices(device.id);
    const hasService = services.some((s) => s.uuid?.toLowerCase() === SOS_SERVICE_UUID);
    if (!hasService) return;

    const read = await readCharacteristic(device.id, SOS_SERVICE_UUID, SOS_PAYLOAD_UUID);
    const payload = await decodeFromRadio(read.value);
    if (!payload) return; // not ours, or the signature does not check out
    if (await alreadyRelayed(payload.id)) return;

    const outcome = await upload(payload);
    if (outcome === 'queued') {
      await enqueuePending(payload);
    } else {
      await markRelayed(payload.id);
    }
  } catch (error) {
    // Out of range, busy, or gone: the next advert brings another attempt.
    console.warn(`Could not carry an alert from ${device.id}`, error);
  } finally {
    inFlight.delete(device.id);
    try {
      disconnect(device.id);
    } catch {
      // already gone
    }
  }
}

/**
 * Starts relaying other people's SOS packets. Passive: it only reads alerts that nearby
 * phones are already broadcasting, and never asks for or keeps a location of its own.
 *
 * Android sends BLUETOOTH_SCAN with neverForLocation, because nothing here derives a
 * position from the scan - the coordinates come from the alerting phone's own fix.
 */
export async function startRelayScanner(): Promise<boolean> {
  if (scanning) return true;
  if (broadcasting) return false; // this phone is raising an alert; one radio, one job
  if (!relayIsConfigured()) {
    // Said once, because a silently disabled relay looks exactly like a broken one.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info('Bluetooth SOS relay is off: set EXPO_PUBLIC_BLE_RELAY_SECRET (app) and BLE_RELAY_SECRET (API) to the same value to enable it.');
    }
    return false;
  }

  try {
    const granted = await requestBluetoothPermission(['scan', 'connect']);
    if (!granted) return false;
    if (!(await isBluetoothEnabled())) return false;
    const caps = await getCapabilities().catch(() => null);
    if (caps && !caps.supportsBleCentral) return false;

    scanListeners.push(addDeviceFoundListener((device) => {
      void carry(device);
    }));
    // Android throttles repeated scan starts (5 per 30s); back off for as long as it asks.
    scanListeners.push(addEventListener('scanFailed', (info) => {
      console.warn('BLE relay scan failed', info);
      scanning = false;
      if (scanRetry) clearTimeout(scanRetry);
      scanRetry = setTimeout(() => {
        scanRetry = null;
        void startRelayScanner();
      }, Math.max(info.retryAfterMs ?? 5_000, 1_000));
    }));

    startScan({
      serviceUUIDs: [SOS_SERVICE_UUID],
      allowDuplicates: false,
      scanMode: 'lowLatency',
    });
    scanning = true;
    void flushRelayQueue();
    return true;
  } catch (error) {
    console.warn('Could not start scanning for Bluetooth relays', error);
    scanning = false;
    release(scanListeners);
    scanListeners = [];
    return false;
  }
}

export function stopRelayScanner(): void {
  if (!scanning && scanListeners.length === 0) return;
  scanning = false;
  if (scanRetry) {
    clearTimeout(scanRetry);
    scanRetry = null;
  }
  try {
    stopScan();
  } catch (error) {
    console.warn('Could not stop the Bluetooth relay scan', error);
  }
  release(scanListeners);
  scanListeners = [];
  inFlight.clear();
  recentDevices.clear();
}

import type { RelayAlertInput } from './bleRelayPayload';

/**
 * Web build of the Bluetooth relay.
 *
 * Browsers have no phone-to-phone BLE: Web Bluetooth is central-only and needs a user
 * gesture per device, so it cannot advertise an SOS or scan in the background. Metro
 * resolves this file instead of bleRelay.ts for the web platform, which also keeps the
 * native module out of the web bundle. Every call reports "unavailable" so the SOS path
 * falls through to the offline queue and the SMS composer exactly as before.
 *
 * The signature helpers in bleRelayPayload.ts are plain TypeScript and stay usable here.
 */
export function isBroadcasting(): boolean {
  return false;
}

export function isScanningForRelays(): boolean {
  return false;
}

export async function flushRelayQueue(): Promise<void> {
  // nothing to flush: this platform never picked up a relayed alert
}

export async function startSosBroadcast(_input: RelayAlertInput): Promise<boolean> {
  return false;
}

export async function stopSosBroadcast(): Promise<void> {
  // nothing was ever broadcast
}

export async function startRelayScanner(): Promise<boolean> {
  return false;
}

export function stopRelayScanner(): void {
  // nothing was ever scanned
}

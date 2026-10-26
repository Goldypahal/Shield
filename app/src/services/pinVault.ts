import * as Crypto from 'expo-crypto';
import { getSecret, setSecret, deleteSecret } from './secureStorage';

/**
 * Lets the app check the SOS PIN with no signal, so an SOS can still be stood down
 * (or, with the duress PIN, silently kept going) offline. Only salted hashes are kept,
 * in the OS keystore. They exist only on a device where the PINs were set; elsewhere
 * the check goes to the server.
 */
const SALT = 'pin_salt';
const NORMAL = 'pin_hash';
const DURESS = 'duress_hash';

export type PinKind = 'normal' | 'duress';

async function digest(salt: string, pin: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function rememberPins(pin: string, duressPin?: string | null): Promise<void> {
  const salt = Crypto.randomUUID();
  await setSecret(SALT, salt);
  await setSecret(NORMAL, await digest(salt, pin));
  if (duressPin) await setSecret(DURESS, await digest(salt, duressPin));
  else await deleteSecret(DURESS);
}

/** 'unknown' when this device holds no PIN hashes (signed in on a new phone). */
export async function checkPinOffline(pin: string): Promise<PinKind | null | 'unknown'> {
  const [salt, normal, duress] = await Promise.all([getSecret(SALT), getSecret(NORMAL), getSecret(DURESS)]);
  if (!salt || !normal) return 'unknown';
  const h = await digest(salt, pin);
  if (duress && h === duress) return 'duress';
  return h === normal ? 'normal' : null;
}

export async function forgetPins(): Promise<void> {
  await Promise.all([deleteSecret(SALT), deleteSecret(NORMAL), deleteSecret(DURESS)]);
}

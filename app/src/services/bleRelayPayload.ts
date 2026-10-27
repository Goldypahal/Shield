import * as Crypto from 'expo-crypto';

import type { TriggerType } from './OfflineQueue';

/**
 * Signed payloads for the Bluetooth SOS relay, the path that works with no network.
 *
 * A walker with no signal has nothing to send the backend. Their phone broadcasts this
 * payload over BLE; a nearby SHIELD phone that does have connectivity reads it and
 * uploads it to the API on the walker's behalf.
 *
 * The wire format is a contract with the API: `canonical()` here must produce exactly
 * the same string as `canonical()` in backend/api/ble_relay.py, or every relayed SOS is
 * refused. Coordinates therefore travel as integer micro-degrees, never floats -
 * JavaScript's toFixed() rounds ties away from zero while Python's :.5f rounds to even,
 * so a float in the signed bytes would fail intermittently on exact ties.
 */

export const RELAY_VERSION = 1;

/** Degrees x 1e5. */
const E5 = 100000;

/**
 * Bytes this module owns. Spelled with the buffer parameter because expo-crypto's
 * `digest` takes a BufferSource, which a bare `Uint8Array` (i.e. one backed by
 * ArrayBufferLike) does not satisfy.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Baked into the bundle at build time (EXPO_PUBLIC_* is inlined by Expo).
 *
 * Only as secret as an installed app: it proves a packet came from a SHIELD build and
 * not from an arbitrary BLE tool, but it does not prove who sent it. See the trust
 * model in backend/api/ble_relay.py and the Ed25519 upgrade in docs/ROADMAP.md.
 * Empty means the relay is switched off rather than silently unsigned.
 */
const RELAY_SECRET = process.env.EXPO_PUBLIC_BLE_RELAY_SECRET || '';

export type RelayPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface UnsignedRelayPayload {
  v: number;
  id: string;
  uid: string;
  tt: TriggerType;
  lat_e5: number;
  lon_e5: number;
  pri: RelayPriority;
  ts: number;
}

export interface RelayPayload extends UnsignedRelayPayload {
  sig: string;
}

const MAX_LAT_E5 = 90 * E5;
const MAX_LON_E5 = 180 * E5;

export function relayIsConfigured(): boolean {
  return RELAY_SECRET.length > 0;
}

/** The exact bytes that get signed. Field order is part of the contract. */
export function canonical(p: UnsignedRelayPayload): string {
  return [p.v, p.id, p.uid, p.tt, p.lat_e5, p.lon_e5, p.pri, p.ts].join('|');
}

// --- bytes, hex and hashing -------------------------------------------------------
// expo-crypto digests bytes but has no HMAC, so HMAC-SHA256 is built from two digests.

function utf8(text: string): Bytes {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

function fromUtf8(bytes: Bytes): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let code: number;
    if (b < 0x80) { code = b; i += 1; }
    else if ((b & 0xe0) === 0xc0) { code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2; }
    else if ((b & 0xf0) === 0xe0) { code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 3; }
    else { code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); i += 4; }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

export function toHex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Bytes {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** BLE characteristic values are hex strings, so the JSON payload is UTF-8 encoded first. */
export function encodeForRadio(payload: RelayPayload): string {
  return toHex(utf8(JSON.stringify(payload)));
}

function concat(parts: Bytes[]): Bytes {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data));
}

const HMAC_BLOCK = 64;

/** HMAC-SHA256 (RFC 2104), hex encoded, byte-identical to Python's hmac.new(..., sha256). */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  let k = utf8(key);
  if (k.length > HMAC_BLOCK) k = await sha256(k);
  const padded = new Uint8Array(HMAC_BLOCK);
  padded.set(k);
  const inner = new Uint8Array(HMAC_BLOCK);
  const outer = new Uint8Array(HMAC_BLOCK);
  for (let i = 0; i < HMAC_BLOCK; i += 1) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  const innerDigest = await sha256(concat([inner, utf8(message)]));
  return toHex(await sha256(concat([outer, innerDigest])));
}

/** Length-independent comparison, so a wrong signature is not leaked byte by byte. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- building and checking ---------------------------------------------------------

export interface RelayAlertInput {
  alertId: string;
  uid: string;
  trigger: TriggerType;
  latitude: number;
  longitude: number;
  priority?: RelayPriority;
}

/** Signs an alert for broadcast. Returns null when the relay is not configured or has no fix. */
export async function buildRelayPayload(input: RelayAlertInput): Promise<RelayPayload | null> {
  if (!RELAY_SECRET) return null;
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return null;
  const latE5 = Math.round(input.latitude * E5);
  const lonE5 = Math.round(input.longitude * E5);
  if (Math.abs(latE5) > MAX_LAT_E5 || Math.abs(lonE5) > MAX_LON_E5) return null;

  const unsigned: UnsignedRelayPayload = {
    v: RELAY_VERSION,
    // Lowercase: the API normalises UUIDs to lowercase before it checks the signature,
    // so the canonical string must be built from the same form.
    id: input.alertId.toLowerCase(),
    uid: input.uid.toLowerCase(),
    tt: input.trigger,
    lat_e5: latE5,
    lon_e5: lonE5,
    pri: input.priority ?? 'HIGH',
    ts: Date.now(),
  };
  return { ...unsigned, sig: await hmacSha256Hex(RELAY_SECRET, canonical(unsigned)) };
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Checks a packet read off the radio before we carry it to the API.
 *
 * A packet is only a candidate: the API refuses anything whose signature does not check
 * out, so this is a cheap local filter that keeps bad packets from costing a connection.
 */
export async function verifyRelayPayload(raw: unknown): Promise<RelayPayload | null> {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== RELAY_VERSION) return null;
  if (typeof p.id !== 'string' || typeof p.uid !== 'string' || typeof p.tt !== 'string') return null;
  if (typeof p.pri !== 'string' || typeof p.sig !== 'string' || p.sig.length !== 64) return null;

  const latE5 = asInteger(p.lat_e5);
  const lonE5 = asInteger(p.lon_e5);
  const ts = asInteger(p.ts);
  if (latE5 === null || lonE5 === null || ts === null) return null;
  if (Math.abs(latE5) > MAX_LAT_E5 || Math.abs(lonE5) > MAX_LON_E5) return null;

  const unsigned: UnsignedRelayPayload = {
    v: RELAY_VERSION,
    id: p.id.toLowerCase(),
    uid: p.uid.toLowerCase(),
    tt: p.tt as TriggerType,
    lat_e5: latE5,
    lon_e5: lonE5,
    pri: p.pri as RelayPriority,
    ts,
  };
  const expect = await hmacSha256Hex(RELAY_SECRET, canonical(unsigned));
  if (!sameHex(expect, p.sig.toLowerCase())) return null;
  return { ...unsigned, sig: p.sig.toLowerCase() };
}

/** Reads a payload back out of a GATT characteristic value. */
export async function decodeFromRadio(hex: string): Promise<RelayPayload | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(fromHex(hex)));
  } catch {
    return null;
  }
  return verifyRelayPayload(parsed);
}

/** The coordinates in degrees, for the payload we upload. */
export function degrees(payload: RelayPayload): { latitude: number; longitude: number } {
  return { latitude: payload.lat_e5 / E5, longitude: payload.lon_e5 / E5 };
}

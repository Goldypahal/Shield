import { AxiosError } from 'axios';
import * as Location from 'expo-location';
import AuthService from './authService';

/** Server-side "I should be safe by then" timer: guardians are alerted if it runs out, even if the phone is off. */
export interface Checkin {
  id: string;
  label: string | null;
  due_at: number;
  seconds_left: number;
}

async function lastKnown() {
  const p = await Location.getLastKnownPositionAsync().catch(() => null);
  return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : {};
}

export async function startCheckin(minutes: number, label?: string): Promise<Checkin> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.post('/api/v1/checkins', { minutes, label, ...(await lastKnown()) })).data.checkin;
}

export async function activeCheckin(): Promise<Checkin | null> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get('/api/v1/checkins/active')).data.checkin;
}

/** Keeps the timer's last position fresh so an expiry tells guardians where to look. */
export async function sendCheckinLocation(id: string): Promise<void> {
  const where = await lastKnown();
  if (!('lat' in where)) return;
  const client = await AuthService.getAuthenticatedClient();
  await client.post(`/api/v1/checkins/${id}/location`, where);
}

function pinError(e: unknown) {
  const s = (e as AxiosError).response?.status;
  return s === 403 ? 'Incorrect PIN.' : s === 423 ? 'Too many wrong PINs. Try again later.'
    : s === 409 ? 'This check-in has already ended.' : 'No connection. Try again.';
}

export async function confirmCheckin(id: string, pin: string): Promise<string | null> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    await client.post(`/api/v1/checkins/${id}/confirm`, { pin });
    return null;
  } catch (e) {
    return pinError(e);
  }
}

export async function extendCheckin(id: string, pin: string, minutes = 10): Promise<Checkin | string> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    return (await client.post(`/api/v1/checkins/${id}/extend`, { pin, minutes })).data.checkin;
  } catch (e) {
    return pinError(e);
  }
}

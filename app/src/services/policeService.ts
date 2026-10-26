import { AxiosError } from 'axios';
import AuthService from './authService';

export interface Helpline { number: string; label: string }

export interface NearbyPolice {
  helplines: Helpline[];
  station: { name: string; phone?: string | null; distance_m: number } | null;
  /** Distance to the nearest available patrol van, rounded to 0.5 km (its position is never shared). */
  patrol_unit_km: number | null;
}

export interface AlertPolice {
  status: string | null;
  text: string | null;
  station: { name: string; phone?: string | null } | null;
  incident_112: string | null;
}

export interface MyAlert {
  id: string;
  trigger_type: string;
  state: string;
  started_at: string;
  resolved_at: string | null;
  police_status: string | null;
  fir_consent_at: string | null;
}

/** Shown even when the server cannot be reached. */
export const DEFAULT_HELPLINES: Helpline[] = [
  { number: '112', label: 'Emergency' },
  { number: '1091', label: 'Women helpline' },
  { number: '181', label: 'Women support' },
];

export async function nearbyPolice(lat: number, lon: number): Promise<NearbyPolice> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get('/api/v1/police/nearby', { params: { lat, lon } })).data;
}

export async function alertPolice(alertId: string): Promise<AlertPolice | null> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get(`/api/v1/alerts/${alertId}`)).data.police ?? null;
}

export async function getPoliceSharing(): Promise<boolean> {
  const client = await AuthService.getAuthenticatedClient();
  return !!(await client.get('/api/v1/me')).data.police_sharing;
}

export async function setPoliceSharing(enabled: boolean): Promise<boolean> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.put('/api/v1/me/police-sharing', { enabled })).data.police_sharing;
}

export async function myAlerts(): Promise<MyAlert[]> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get('/api/v1/alerts/mine')).data.alerts;
}

/** Lets the police use this incident for an FIR. Returns an error message or null. */
export async function consentFir(alertId: string, pin: string): Promise<string | null> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    await client.post(`/api/v1/alerts/${alertId}/fir-consent`, { pin });
    return null;
  } catch (e) {
    const s = (e as AxiosError).response?.status;
    return s === 403 ? 'Incorrect PIN.' : s === 423 ? 'Too many wrong PINs. Try again later.' : 'No connection. Try again.';
  }
}

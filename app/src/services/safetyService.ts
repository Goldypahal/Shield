import { AxiosError } from 'axios';
import AuthService from './authService';
import { LatLon } from './routeService';

export type HavenKind = 'police' | 'hospital' | 'pharmacy' | 'fuel';

export interface SafeHaven extends LatLon {
  kind: HavenKind;
  name: string;
  distance_m: number;
  open_24_7: boolean;
  phone?: string | null;
}

export type HazardCategory = 'broken_light' | 'harassment_spot' | 'blocked_path' | 'dark_alley' | 'unsafe_zone' | 'other';

export interface Hazard extends LatLon {
  id?: string;
  category: HazardCategory;
  description?: string | null;
}

export interface HeatCell extends LatLon {
  risk: number;
  isolated_share: number;
}

export const HAZARD_LABELS: Record<HazardCategory, string> = {
  broken_light: 'Broken streetlight',
  dark_alley: 'Dark stretch',
  harassment_spot: 'Harassment here',
  unsafe_zone: 'Feels unsafe',
  blocked_path: 'Path blocked',
  other: 'Other',
};

export const HAVEN_LABELS: Record<HavenKind, string> = {
  police: 'Police',
  hospital: 'Hospital',
  pharmacy: 'Pharmacy',
  fuel: 'Fuel station',
};

export async function nearbyHavens(at: LatLon, radiusKm = 3): Promise<SafeHaven[]> {
  const client = await AuthService.getAuthenticatedClient();
  const res = await client.get('/api/v1/safe-havens', { params: { lat: at.lat, lon: at.lon, radius_km: radiusKm, limit: 25 } });
  return res.data.places;
}

export async function listHazards(at: LatLon, radiusKm = 10): Promise<Hazard[]> {
  const client = await AuthService.getAuthenticatedClient();
  const res = await client.get('/api/v1/hazards', { params: { lat: at.lat, lon: at.lon, radius_km: radiusKm } });
  return res.data.hazards;
}

export async function reportHazard(h: Hazard): Promise<string | null> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    await client.post('/api/v1/hazards', { lat: h.lat, lon: h.lon, category: h.category, description: h.description || undefined });
    return null;
  } catch (e) {
    return (e as AxiosError).response?.status === 429 ? 'You have sent several reports just now. Try again in a minute.' : 'Could not send the report.';
  }
}

export async function fetchHeatmap(hour: number): Promise<{ cells: HeatCell[]; cellDeg: number }> {
  const client = await AuthService.getAuthenticatedClient();
  const res = await client.get('/api/v1/routes/tricity/heatmap', { params: { hour, mode: 'walk' } });
  return { cells: res.data.cells, cellDeg: res.data.cell_deg };
}

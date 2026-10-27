import AuthService from './authService';
import type { PlannedRoute, RouteSegment, LatLon } from './routeService';

/** Client for the all-India planner (/api/v1/nav). */

export type TravelMode = 'walk' | 'bicycle' | 'two_wheeler' | 'car' | 'transit';
export type RouteBadge = 'safest' | 'shortest' | 'fastest';
export type SortKey = RouteBadge;

export interface NavPlace {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  place_id?: string | null;
}

export interface Place247 {
  id: string;
  name: string;
  kind: 'pharmacy' | 'hospital' | 'police' | 'fuel' | 'convenience' | 'atm' | 'other';
  lat: number;
  lon: number;
  phone: string;
  distance_from_route_m: number;
  along_m: number;
  open_247: boolean;
}

export interface CautionStretch {
  reason: 'unlit' | 'isolated' | 'incident';
  start_m: number;
  end_m: number;
  coords: [number, number][];
}

export interface RouteSafety {
  score: number | null;
  partial: boolean;
  long_trip: boolean;
  period: 'day' | 'evening' | 'night';
  lit_pct: number | null;
  unlit_pct: number | null;
  unknown_light_pct: number | null;
  busy_road_pct: number | null;
  help_coverage_pct: number | null;
  incidents: number;
  incident_reports: { lat: number; lon: number; category: string }[];
  places_247: Place247[];
  caution: CautionStretch[];
  components: { lighting: number | null; activity: number | null; incidents: number | null; help: number | null };
}

export interface NavStep {
  instruction: string;
  distance_m: number;
  duration_s: number;
  lat: number;
  lon: number;
  maneuver: string;
  road: string;
}

export interface NavRoute {
  id: string;
  coords: [number, number][];
  distance_m: number;
  duration_s: number;
  duration_note: string;
  summary: string;
  steps: NavStep[];
  safety: RouteSafety;
  badges: RouteBadge[];
}

export interface NavPlan {
  routes: NavRoute[];
  provider: 'openstreetmap' | 'google';
  period: 'day' | 'evening' | 'night';
  mode: TravelMode;
  attribution?: string;
}

export interface NavCapabilities {
  provider: 'openstreetmap' | 'google';
  modes: TravelMode[];
  all_modes: TravelMode[];
  two_wheeler_uses_car_profile: boolean;
  attribution: string;
}

export const ALL_MODES: TravelMode[] = ['walk', 'bicycle', 'two_wheeler', 'car', 'transit'];
export const FREE_MODES: TravelMode[] = ['walk', 'bicycle', 'two_wheeler', 'car'];

export async function getCapabilities(): Promise<NavCapabilities> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get('/api/v1/nav/capabilities')).data;
}

export async function searchPlaces(q: string, near: LatLon | null, language: string): Promise<NavPlace[]> {
  const client = await AuthService.getAuthenticatedClient();
  const params: Record<string, string | number> = { q, language };
  if (near) Object.assign(params, { lat: near.lat, lon: near.lon });
  return (await client.get('/api/v1/nav/search', { params })).data.places;
}

/** Google suggestions come without coordinates; this fills them in. */
export async function resolvePlace(p: NavPlace): Promise<NavPlace> {
  if (p.lat !== null && p.lon !== null) return p;
  if (!p.place_id) throw new Error('Place has no location');
  const client = await AuthService.getAuthenticatedClient();
  return (await client.get(`/api/v1/nav/place/${encodeURIComponent(p.place_id)}`)).data;
}

export async function planNav(origin: LatLon, destination: LatLon, mode: TravelMode, language: string, departAt?: Date): Promise<NavPlan> {
  const client = await AuthService.getAuthenticatedClient();
  return (await client.post('/api/v1/nav/plan', {
    origin, destination, mode, language, depart_at: (departAt ?? new Date()).toISOString(),
  }, { timeout: 60000 })).data;
}

/** Orders routes for the chosen tab; ties fall back to the safest. */
export function sortRoutes(routes: NavRoute[], key: SortKey): NavRoute[] {
  const score = (r: NavRoute) => r.safety.score ?? -1;
  const cmp: Record<SortKey, (a: NavRoute, b: NavRoute) => number> = {
    safest: (a, b) => score(b) - score(a) || a.distance_m - b.distance_m,
    shortest: (a, b) => a.distance_m - b.distance_m || score(b) - score(a),
    fastest: (a, b) => a.duration_s - b.duration_s || score(b) - score(a),
  };
  return [...routes].sort(cmp[key]);
}

export function scoreColor(score: number | null): string {
  if (score === null) return '#64748B';
  return score >= 70 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626';
}

export function formatDuration(s: number, minLabel = 'min'): string {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m} ${minLabel}`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} ${minLabel}`;
}

export function formatKm(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

const R = 6371000;
export function distanceBetween(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Adapts a planner route to the PlannedRoute shape the live-trip panel (guardian sharing,
 * check-ins, spoken turns) already understands. Caution stretches become high-risk segments.
 */
export function toPlannedRoute(r: NavRoute): PlannedRoute {
  const label = r.badges.includes('safest') ? 'safest' : r.badges.includes('fastest') ? 'fastest' : 'balanced';
  const stepNames = r.steps.filter((s) => s.road);
  const segments: RouteSegment[] = [];
  let along = 0;
  for (let i = 0; i < r.coords.length - 1; i++) {
    const len = distanceBetween(r.coords[i], r.coords[i + 1]);
    const mid = along + len / 2;
    const caution = r.safety.caution.find((c) => mid >= c.start_m && mid <= c.end_m);
    let name = '';
    for (const s of stepNames) {
      if (distanceBetween([s.lat, s.lon], r.coords[i]) < 30) name = s.road;
    }
    segments.push({
      from_node: i, to_node: i + 1, length_m: len, time_s: (len / Math.max(1, r.distance_m)) * r.duration_s,
      risk: caution ? 0.6 : 0.2, name, cls: '', lit: caution?.reason === 'unlit' ? 'no' : 'unknown',
      isolated: caution?.reason === 'isolated',
    });
    along += len;
  }
  return {
    label, coords: r.coords, segments, distance_m: r.distance_m, duration_s: r.duration_s,
    safety_index: (r.safety.score ?? 50) / 100, max_risk: segments.reduce((m, s) => Math.max(m, s.risk), 0),
    lit_pct: r.safety.lit_pct ?? 0, unknown_light_pct: r.safety.unknown_light_pct ?? 100, isolated_m: 0,
    police_near: r.safety.places_247.filter((p) => p.kind === 'police').length, incidents: r.safety.incidents,
    confidence: r.safety.partial ? 0.4 : 0.8, main_roads: r.summary ? r.summary.split(', ') : [], highlights: [],
  };
}

export type { LatLon };

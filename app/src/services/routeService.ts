import AuthService from './authService';

export type LatLon = { lat: number; lon: number };
export type RouteLabel = 'safest' | 'balanced' | 'fastest';

export interface RouteSegment {
  from_node: number;
  to_node: number;
  length_m: number;
  time_s: number;
  risk: number;
  name: string;
  cls: string;
  lit: string;
  isolated: boolean;
}

/** One route from the Tricity engine (`SafeRouter.plan`). coords[i] -> coords[i + 1] is segments[i]. */
export interface PlannedRoute {
  label: RouteLabel;
  coords: [number, number][];
  segments: RouteSegment[];
  distance_m: number;
  duration_s: number;
  safety_index: number;
  max_risk: number;
  lit_pct: number;
  unknown_light_pct: number;
  isolated_m: number;
  police_near: number;
  incidents: number;
  confidence: number;
  main_roads: string[];
  highlights: string[];
}

export interface RoutePlan {
  routes: PlannedRoute[];
  notes: string[];
  /** Recent community reports that raised the risk of streets on these routes. */
  communityReports: { lat: number; lon: number; category: string }[];
}

export interface Landmark extends LatLon {
  name: string;
  kind?: string;
}

/** Display order: the engine's recommendation first. */
export const ROUTE_ORDER: RouteLabel[] = ['safest', 'balanced', 'fastest'];

export const ROUTE_TITLES: Record<RouteLabel, string> = {
  safest: 'Higher safety score',
  balanced: 'Balanced',
  fastest: 'Fastest',
};

// Engine segment risk is in [0, 1]; 0.5 sits above the 90th percentile of a typical safest route at night.
export const CAUTION_RISK = 0.5;

export const isCautionSegment = (s: RouteSegment) => s.isolated || s.risk >= CAUTION_RISK;

// Extent of the Tricity routing graph (Chandigarh, Mohali, Panchkula, Zirakpur) with a small margin.
const COVERAGE = { minLat: 30.6, maxLat: 30.8, minLon: 76.66, maxLon: 76.92 };

export const isInCoverage = (p: LatLon) =>
  p.lat >= COVERAGE.minLat && p.lat <= COVERAGE.maxLat && p.lon >= COVERAGE.minLon && p.lon <= COVERAGE.maxLon;

const asQueryPoint = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Accepts "30.7333, 76.7794" typed into the search box. */
export function parseLatLon(text: string): LatLon | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const p = { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? p : null;
}

export async function fetchLandmarks(): Promise<Landmark[]> {
  const client = await AuthService.getAuthenticatedClient();
  const res = await client.get('/api/v1/routes/tricity/landmarks');
  return res.data?.landmarks ?? [];
}

export async function planRoutes(origin: LatLon, destination: LatLon, when: Date = new Date(),
                                 mode: 'walk' | 'drive' = 'walk'): Promise<RoutePlan> {
  const client = await AuthService.getAuthenticatedClient();
  const res = await client.get('/api/v1/routes/tricity/plan', {
    params: {
      origin: asQueryPoint(origin),
      destination: asQueryPoint(destination),
      hour: when.getHours() + when.getMinutes() / 60,
      mode,
    },
  });
  const byLabel: Record<string, PlannedRoute> = res.data?.plan?.routes ?? {};
  return {
    routes: ROUTE_ORDER.filter((l) => byLabel[l]).map((l) => ({ ...byLabel[l], label: l })),
    notes: res.data?.plan?.notes ?? [],
    communityReports: res.data?.plan?.community_reports ?? [],
  };
}

export const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export const formatDuration = (s: number) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

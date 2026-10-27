import { LatLon, PlannedRoute, RouteLabel, isCautionSegment } from '../../services/routeService';
import type { Hazard, HeatCell, SafeHaven } from '../../services/safetyService';

/** Optional layers drawn on top of the basemap. */
export interface MapExtras {
  havens?: SafeHaven[];
  hazards?: Hazard[];
  heat?: { cells: HeatCell[]; cellDeg: number } | null;
  me?: LatLon | null;
}

export interface RouteMapProps {
  routes: PlannedRoute[];
  selected: RouteLabel | null;
  origin: LatLon | null;
  destination: LatLon | null;
  onSelectRoute?: (label: RouteLabel) => void;
  onRecenter?: () => void;
  extras?: MapExtras;
  onSelectHaven?: (haven: SafeHaven) => void;
  style?: any;
}

export const HAVEN_COLORS: Record<string, string> = {
  police: '#0B132B',
  hospital: '#DB2777',
  pharmacy: '#059669',
  fuel: '#D97706',
};

export const HAZARD_COLOR = '#EA580C';

/** Heatmap colour for a relative risk: green (low) through amber to red (high). */
export function riskColor(risk: number): string {
  const t = Math.max(0, Math.min(1, (risk - 0.15) / 0.4));
  const hue = Math.round(130 * (1 - t));
  return `hsl(${hue}, 75%, 45%)`;
}

// Route colours are fixed (not themed) so the line reads the same on light and dark basemaps.
export const ROUTE_COLORS = {
  selected: '#FF5A1F',
  casing: '#FFFFFF',
  caution: '#DC2626',
  alternative: '#64748B',
  start: '#16A34A',
  end: '#DC2626',
};

// Chandigarh Sector 17, the centre of the routing graph.
export const DEFAULT_CENTER: LatLon = { lat: 30.7333, lon: 76.7794 };

/** Consecutive caution segments merged into runs, so each run draws as one unbroken overlay. */
export function cautionRuns(route: PlannedRoute): [number, number][][] {
  const runs: [number, number][][] = [];
  let current: [number, number][] | null = null;
  route.segments.forEach((s, i) => {
    if (isCautionSegment(s)) {
      if (!current) {
        current = [route.coords[i]];
        runs.push(current);
      }
      current.push(route.coords[i + 1]);
    } else {
      current = null;
    }
  });
  return runs;
}

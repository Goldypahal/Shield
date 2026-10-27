import type { CautionStretch, Place247 } from '../../services/navService';

/**
 * Basemap: OpenFreeMap vector tiles (OpenStreetMap data, free, no API key, no usage limits).
 * Set EXPO_PUBLIC_MAP_STYLE_URL to use another MapLibre style, for example a Mappls or
 * self-hosted style that draws India's boundaries as per the Survey of India.
 */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

export interface NavMapRoute {
  id: string;
  coords: [number, number][];
  caution: CautionStretch[];
  /** Line colour (safety tier); grey when missing. */
  color?: string;
}

export interface NavMapProps {
  routes: NavMapRoute[];
  selectedId: string | null;
  origin: { lat: number; lon: number } | null;
  destination: { lat: number; lon: number } | null;
  places: Place247[];
  incidents: { lat: number; lon: number }[];
  me: { lat: number; lon: number; accuracy: number | null; heading?: number | null } | null;
  /** Change it to re-fit the camera to the routes (e.g. after a new plan). */
  fitKey: string;
  /** Increment to fly back to the user's position. */
  recenterKey: number;
  /** Keep the camera on the user (during a trip). */
  follow: boolean;
  /** Screen space covered by panels, so fitted routes are not hidden under them. */
  padding: { top: number; bottom: number };
  onSelectRoute: (id: string) => void;
  onSelectPlace: (place: Place247) => void;
  /** Long-press on the map, like dropping a pin in Google Maps. */
  onLongPress: (p: { lat: number; lon: number }) => void;
}

export const NAV_COLORS = {
  selected: '#FF5A1F',
  casing: '#FFFFFF',
  alternative: '#94A3B8',
  caution: '#DC2626',
  start: '#16A34A',
  end: '#DC2626',
  me: '#2563EB',
  incident: '#EA580C',
};

export const PLACE_COLORS: Record<Place247['kind'], string> = {
  police: '#0B132B',
  hospital: '#DB2777',
  pharmacy: '#059669',
  fuel: '#D97706',
  convenience: '#7C3AED',
  atm: '#0891B2',
  other: '#475569',
};

export const PLACE_ICONS: Record<Place247['kind'], string> = {
  police: 'shield',
  hospital: 'medkit',
  pharmacy: 'medical',
  fuel: 'car',
  convenience: 'storefront',
  atm: 'card',
  other: 'time',
};

/** Polygon approximating a circle of `radius` metres, for the GPS accuracy halo. */
export function circlePolygon(lat: number, lon: number, radius: number, points = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** [west, south, east, north] around every route and endpoint. */
export function boundsOf(props: Pick<NavMapProps, 'routes' | 'origin' | 'destination'>): [number, number, number, number] | null {
  const pts: [number, number][] = props.routes.flatMap((r) => r.coords);
  if (props.origin) pts.push([props.origin.lat, props.origin.lon]);
  if (props.destination) pts.push([props.destination.lat, props.destination.lon]);
  if (!pts.length) return null;
  let s = 90, n = -90, w = 180, e = -180;
  for (const [lat, lon] of pts) {
    s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon);
  }
  return [w, s, e, n];
}

export const INDIA_CENTER = { lat: 22.5, lon: 79.0 };

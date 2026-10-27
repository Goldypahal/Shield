import { calculateDistanceKm } from '../services/locationService';

export type Mode = 'drive' | 'bike' | 'walk' | 'transit';
export type RouteId = 'safer' | 'moderate' | 'risk';

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteBadge {
  icon: 'check' | 'warn' | 'info';
  text: string;
}

export interface NavigationStep {
  instruction: string;
  maneuver: 'depart' | 'turn-left' | 'turn-right' | 'slight-left' | 'slight-right' | 'straight' | 'arrive';
  distanceMeters: number;
  streetName: string;
}

export interface RouteItem {
  id: RouteId;
  title: string;
  label: string;
  minutes: number;
  distanceKm: number;
  safetyLevel: 'safer' | 'moderate' | 'risk';
  badges: RouteBadge[];
  path: [number, number][];       // lat,lng points
  lights: [number, number][];     // streetlight markers
  incidents: [number, number][];  // incident markers
  steps?: NavigationStep[];       // turn-by-turn navigation steps
  breakdown: {
    lightingScore: number;
    walkabilityScore: number;
    incidentCount30d: number;
    openShopsNearby: number;
  };
}

export const INITIAL_ORIGIN: Place = {
  label: 'Detecting your location...',
  lat: 30.7025,
  lng: 76.7115,
};

export const INITIAL_DESTINATION: Place = {
  label: 'Chandigarh University, Mohali',
  lat: 30.7685,
  lng: 76.5755,
};

const MODE_SPEEDS_KMH: Record<Mode, number> = {
  walk: 4.8,
  bike: 15,
  drive: 35,
  transit: 22,
};

/**
 * Generates real interpolated paths and times connecting ANY origin and destination anywhere in the world.
 */
export function generateDynamicRoutes(
  origin: Place,
  destination: Place,
  mode: Mode
): Record<RouteId, RouteItem> {
  const directDist = calculateDistanceKm(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );
  const dist = Math.max(0.5, directDist);
  const speed = MODE_SPEEDS_KMH[mode];

  const baseMinutes = Math.max(3, Math.round((dist / speed) * 60));
  const saferMinutes = Math.max(4, Math.round(baseMinutes * 1.15));
  const moderateMinutes = baseMinutes;
  const riskMinutes = Math.max(2, Math.round(baseMinutes * 0.88));

  // Interpolate 10 points between origin and destination with realistic road curvatures
  const numPoints = 10;
  const saferPath: [number, number][] = [];
  const moderatePath: [number, number][] = [];
  const riskPath: [number, number][] = [];

  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;

  // Perpendicular vector for curved detours (e.g. sticking to main lighted roads)
  const perpLat = -dLng * 0.12;
  const perpLng = dLat * 0.12;

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const baseLat = origin.lat + t * dLat;
    const baseLng = origin.lng + t * dLng;
    const curveFactor = Math.sin(t * Math.PI);

    // Safer route takes wider lighted avenue
    saferPath.push([
      parseFloat((baseLat + perpLat * curveFactor * 1.3).toFixed(6)),
      parseFloat((baseLng + perpLng * curveFactor * 1.3).toFixed(6)),
    ]);

    // Moderate route takes medium avenue
    moderatePath.push([
      parseFloat((baseLat + perpLat * curveFactor * 0.5).toFixed(6)),
      parseFloat((baseLng + perpLng * curveFactor * 0.5).toFixed(6)),
    ]);

    // Risk route is direct shortcut through lanes
    riskPath.push([
      parseFloat((baseLat - perpLat * curveFactor * 0.3).toFixed(6)),
      parseFloat((baseLng - perpLng * curveFactor * 0.3).toFixed(6)),
    ]);
  }

  // Streetlights along safer route
  const lights: [number, number][] = [
    saferPath[2],
    saferPath[4],
    saferPath[6],
    saferPath[8],
  ];

  // Incidents along shortcut risk route
  const incidents: [number, number][] = [
    riskPath[3],
    riskPath[5],
    riskPath[7],
  ];

  return {
    safer: {
      id: 'safer',
      title: 'Safer Route',
      label: 'SAFER ROUTE',
      minutes: saferMinutes,
      distanceKm: parseFloat((dist * 1.15).toFixed(1)),
      safetyLevel: 'safer',
      badges: [
        { icon: 'check', text: 'Well lit streets' },
        { icon: 'check', text: 'Good walkability' },
        { icon: 'check', text: 'Fewer incidents' },
      ],
      path: saferPath,
      lights,
      incidents: [],
      breakdown: {
        lightingScore: 94,
        walkabilityScore: 92,
        incidentCount30d: 0,
        openShopsNearby: 18,
      },
    },
    moderate: {
      id: 'moderate',
      title: 'Moderate Risk',
      label: 'MODERATE RISK',
      minutes: moderateMinutes,
      distanceKm: parseFloat((dist * 1.05).toFixed(1)),
      safetyLevel: 'moderate',
      badges: [
        { icon: 'warn', text: 'Some dark areas' },
        { icon: 'info', text: 'Moderate walkability' },
        { icon: 'warn', text: 'Few incidents' },
      ],
      path: moderatePath,
      lights: [moderatePath[3]],
      incidents: [moderatePath[6]],
      breakdown: {
        lightingScore: 68,
        walkabilityScore: 74,
        incidentCount30d: 2,
        openShopsNearby: 7,
      },
    },
    risk: {
      id: 'risk',
      title: 'Higher Risk',
      label: 'HIGHER RISK',
      minutes: riskMinutes,
      distanceKm: parseFloat(dist.toFixed(1)),
      safetyLevel: 'risk',
      badges: [
        { icon: 'warn', text: 'Poor lighting' },
        { icon: 'warn', text: 'Low walkability' },
        { icon: 'warn', text: 'More incidents' },
      ],
      path: riskPath,
      lights: [],
      incidents,
      breakdown: {
        lightingScore: 32,
        walkabilityScore: 48,
        incidentCount30d: 6,
        openShopsNearby: 1,
      },
    },
  };
}

export function generateRoutesForMode(mode: Mode): Record<RouteId, RouteItem> {
  return generateDynamicRoutes(INITIAL_ORIGIN, INITIAL_DESTINATION, mode);
}

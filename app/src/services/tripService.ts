import * as Location from 'expo-location';
import { AxiosError } from 'axios';
import AuthService from './authService';
import { PlannedRoute } from './routeService';

/**
 * A walk or ride on a planned route, shared live with guardians (WALK-1 to WALK-8).
 * The phone sends its position every few seconds; the server answers with deviation,
 * arrival and check-in signals, which the screen turns into prompts.
 */
export type TripMode = 'walk' | 'ride';

export interface TripStatus {
  position: { lat: number; lon: number } | null;
  deviationM: number;
  deviationAlert: boolean;
  checkinRequired: boolean;
  arrived: boolean;
}

export interface Trip {
  id: string;
  mode: TripMode;
  stop: () => void;
}

const SEND_EVERY_MS = 8000;

export async function startTrip(
  route: PlannedRoute,
  destinationName: string,
  mode: TripMode,
  vehiclePlate: string | null,
  onPosition: (p: { lat: number; lon: number }) => void,
  onServer: (s: TripStatus) => void,
): Promise<Trip> {
  const client = await AuthService.getAuthenticatedClient();
  // Share with every guardian; only verified ones can open it in the app, all get the SMS link
  const guardians: { id: string }[] = (await client.get('/api/v1/guardians')).data.guardians ?? [];
  const res = await client.post('/api/v1/walks', {
    origin_name: 'Current location',
    destination_name: destinationName,
    chosen_route_id: route.label,
    route_coords: route.coords.map(([lat, lon]) => ({ lat, lon })),
    safety_score: route.safety_index,
    fastest_time_seconds: Math.round(route.duration_s),
    shared_guardian_ids: guardians.map((g) => g.id).slice(0, 5),
    mode,
    vehicle_plate: mode === 'ride' ? vehiclePlate : undefined,
  });
  const tripId: string = res.data.walk.id;

  let buffer: { lat: number; lon: number; speed: number; accuracy: number; heading: number; ts: string }[] = [];
  let latest: TripStatus['position'] = null;
  let stopped = false;

  const { status } = await Location.requestForegroundPermissionsAsync();
  const watch = status === 'granted'
    ? await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
        (p) => {
          latest = { lat: p.coords.latitude, lon: p.coords.longitude };
          buffer.push({ ...latest, speed: p.coords.speed ?? 0, accuracy: p.coords.accuracy ?? 10,
            heading: p.coords.heading ?? 0, ts: new Date(p.timestamp).toISOString() });
          onPosition(latest);
        })
    : null;

  const flush = async () => {
    if (stopped || buffer.length === 0) return;
    const points = buffer.slice(-100);
    buffer = [];
    try {
      const r = (await client.post(`/api/v1/walks/${tripId}/points`, { points })).data;
      onServer({ position: latest, deviationM: r.deviation_distance_m, deviationAlert: r.deviation_alert,
        checkinRequired: r.checkin_required, arrived: r.arrived_at_destination });
    } catch (e) {
      if ((e as AxiosError).response?.status === 409) return; // trip already ended
      buffer = [...points, ...buffer].slice(-500); // keep for the next attempt
    }
  };
  const timer = setInterval(flush, SEND_EVERY_MS);

  return {
    id: tripId,
    mode,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      watch?.remove();
    },
  };
}

/** "I'm OK" after a deviation or long stop; the SOS PIN is required. Returns an error message or null. */
export async function confirmTripSafe(tripId: string, pin: string): Promise<string | null> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    await client.post(`/api/v1/walks/${tripId}/checkin`, { acknowledged: true, safe: true, pin });
    return null;
  } catch (e) {
    const s = (e as AxiosError).response?.status;
    return s === 403 ? 'Incorrect PIN.' : s === 423 ? 'Too many wrong PINs. Try again later.' : 'No connection. Try again.';
  }
}

/** Unanswered check-in: alerts the guardians. */
export async function reportMissedCheckin(tripId: string): Promise<void> {
  const client = await AuthService.getAuthenticatedClient();
  await client.post(`/api/v1/walks/${tripId}/checkin`, { acknowledged: false, safe: false });
}

/** Ends the trip. Away from the destination the server asks for the PIN (403 without it). */
export async function endTrip(tripId: string, pin?: string): Promise<'ended' | 'pin_required' | string> {
  const client = await AuthService.getAuthenticatedClient();
  try {
    await client.post(`/api/v1/walks/${tripId}/end`, pin ? { pin } : {});
    return 'ended';
  } catch (e) {
    const err = e as AxiosError<{ detail?: string }>;
    if (err.response?.status === 403 && !pin) return 'pin_required';
    if (err.response?.status === 409) return 'ended';
    return err.response?.status === 403 ? 'Incorrect PIN.' : err.response?.data?.detail ?? 'No connection. Try again.';
  }
}

import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface LocationResult {
  latitude: number;
  longitude: number;
  label: string;
}

export async function requestLocationPermissions(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    return fg.status === 'granted';
  } catch (e) {
    console.warn('Error requesting foreground permissions', e);
    return false;
  }
}

export async function getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  const granted = await requestLocationPermissions();
  if (!granted) {
    throw new Error('Location permission denied');
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

/**
 * Gets real accurate GPS coordinates from the device and reverse-geocodes to a human-readable address.
 */
export async function getAccurateUserLocation(): Promise<LocationResult> {
  // If running on web, try browser geolocation API first with high accuracy
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const label = await reverseGeocodeCoord(lat, lng);
      return { latitude: lat, longitude: lng, label };
    } catch (e) {
      console.warn('Web geolocation failed, falling back to expo-location', e);
    }
  }

  // Native / Expo fallback
  const coords = await getCurrentLocation();
  const label = await reverseGeocodeCoord(coords.latitude, coords.longitude);
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    label,
  };
}

export async function reverseGeocodeCoord(latitude: number, longitude: number): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        { headers: { 'User-Agent': 'HeimdalSafetyApp/1.0' } }
      );
      if (res.ok) {
        const data = await res.json();
        const addr = data.address;
        const name =
          addr.road ||
          addr.suburb ||
          addr.neighbourhood ||
          addr.residential ||
          addr.village ||
          addr.city_district ||
          addr.city ||
          data.display_name.split(',')[0];
        const city = addr.city || addr.town || addr.state_district || '';
        return city ? `${name}, ${city}` : name;
      }
    } else {
      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (reverse.length > 0) {
        const r = reverse[0];
        const name = r.name || r.street || r.district || r.subregion || 'My Location';
        const city = r.city || r.region || '';
        return city ? `${name}, ${city}` : name;
      }
    }
  } catch (err) {
    console.warn('Reverse geocoding error:', err);
  }
  return `My Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
}

/**
 * Searches real places worldwide using OpenStreetMap Nominatim API.
 */
export async function searchRealPlaces(query: string): Promise<LocationResult[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query.trim()
      )}&limit=6&addressdetails=1`,
      { headers: { 'User-Agent': 'HeimdalSafetyApp/1.0' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((item: any) => ({
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      label: item.display_name.split(',').slice(0, 3).join(', '),
    }));
  } catch (e) {
    console.warn('Place search error:', e);
    return [];
  }
}

export function buildMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

import * as Location from 'expo-location';

export async function requestLocationPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  const bg = await Location.requestBackgroundPermissionsAsync();

  return fg.status === 'granted' && bg.status === 'granted';
}

export async function getCurrentLocation() {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude
  };
}

export function buildMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

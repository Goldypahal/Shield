import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Expo Go ships a fixed set of native modules. MapLibre (map), react-native-fast-tflite
 * (scream model) and @siteed/audio-studio (microphone stream) are not among them, and they
 * throw as soon as they are imported. Load them through this helper so the app still starts
 * in Expo Go; the features that need them switch off until you run a development build
 * (`npx expo run:android`).
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function optionalNative<T>(load: () => T, name: string): T | null {
  if (isExpoGo) return null;
  try {
    return load();
  } catch (e) {
    console.warn(`[native] ${name} is not available in this build:`, e);
    return null;
  }
}

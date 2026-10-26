import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Secrets (session tokens, PIN hashes) live in the OS keystore: Android Keystore / iOS Keychain.
 * Browsers have no equivalent, so the web build falls back to storage scoped to this origin.
 */
const useKeystore = Platform.OS !== 'web';

// SecureStore keys allow only [A-Za-z0-9._-]
const keyFor = (key: string) => `shield.${key}`;

export async function getSecret(key: string): Promise<string | null> {
  return useKeystore ? SecureStore.getItemAsync(keyFor(key)) : AsyncStorage.getItem(keyFor(key));
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (useKeystore) {
    await SecureStore.setItemAsync(keyFor(key), value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  } else {
    await AsyncStorage.setItem(keyFor(key), value);
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (useKeystore) await SecureStore.deleteItemAsync(keyFor(key));
  else await AsyncStorage.removeItem(keyFor(key));
}

import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { optionalNative } from '../utils/nativeModules';

type IntentLauncher = typeof import('expo-intent-launcher');
const intents = Platform.OS === 'android'
  ? optionalNative<IntentLauncher>(() => require('expo-intent-launcher'), 'Phone calls (expo-intent-launcher)')
  : null;

const clean = (n: string) => n.replace(/[^\d+*#]/g, '');

/**
 * Calls a number with the phone's own (default) calling app.
 *
 * Android: places the call straight away (ACTION_CALL) once the walker has allowed SHIELD
 * to make calls; otherwise opens the default dialer with the number filled in (ACTION_DIAL),
 * never the "Open with..." chooser that a plain tel: link shows when several apps (Truecaller,
 * WhatsApp, Skype) can handle numbers. iOS: the system call prompt.
 *
 * `direct: false` always just opens the dialer (e.g. helplines the walker may want to check).
 */
export async function callPhone(number: string, opts: { direct?: boolean } = {}): Promise<void> {
  const n = clean(number);
  if (!n) return;
  const direct = opts.direct ?? true;
  if (Platform.OS === 'android' && intents) {
    try {
      if (direct) {
        let ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
        if (!ok) {
          const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE, {
            title: 'Call guardians directly',
            message: 'Allow SHIELD to start calls, so a guardian or helpline is called with one tap from your phone app.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          });
          ok = r === PermissionsAndroid.RESULTS.GRANTED;
        }
        if (ok) {
          await intents.startActivityAsync('android.intent.action.CALL', { data: `tel:${n}` });
          return;
        }
      }
      await intents.startActivityAsync('android.intent.action.DIAL', { data: `tel:${n}` });
      return;
    } catch (e) {
      console.warn('[call] intent failed, falling back to tel: link', e);
    }
  }
  await Linking.openURL(`tel:${n}`);
}

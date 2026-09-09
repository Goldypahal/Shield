import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AuthService from './authService';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

class NotificationService {
  async registerForPushNotifications() {
    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;

    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    try {
      // In Expo SDK 53+, remote push notifications are not supported in Expo Go on Android.
      // This check prevents the red error screen.
      const tokenData = await Notifications.getExpoPushTokenAsync();

      const client = await AuthService.getAuthenticatedClient();
      await client.post('/api/v1/auth/push-token', {
        expo_push_token: tokenData.data
      });

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('guardian-alerts', {
          name: 'Guardian Alerts',
          importance: Notifications.AndroidImportance.HIGH
        });
      }

      return tokenData.data;
    } catch (error: any) {
      if (error.message?.includes('removed from Expo Go')) {
        console.warn('Push Notifications: Skipping token registration because this is Expo Go. Use a development build for remote push.');
      } else {
        console.warn('Push token registration failed', error);
      }
      return null;
    }
  }

  async notifyGuardianAlert(title: string, body: string) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body
      },
      trigger: null
    });
  }
}

export default new NotificationService();

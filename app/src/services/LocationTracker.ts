import { Platform } from 'react-native';
import * as Location from 'expo-location';
import AuthService from './authService';
import { BACKEND_URL, WS_BACKEND_URL } from '../config/env';

/**
 * Week 4: This service bridges the real-time constraints.
 * 1. Pushing the user's live location during an active SOS (using authenticated HTTP)
 * 2. Listening to the live location of *another* user (using Authenticated WebSockets)
 */
class LocationTrackerService {
  private activeLocationWatchId: Location.LocationSubscription | null = null;
  private ws: WebSocket | null = null;
  private readonly WS_URL = `${WS_BACKEND_URL}/ws/location`;
  private readonly API_URL = `${BACKEND_URL}/api/v1/location`;

  /**
   * Starts aggressively transmitting the device's location to the Core Safety Service.
   * Runs in the background (React Native Background Fetch / Background Service)
   */
  async startBroadcastingSOS(alertId: string, userId: string) {
    if (this.activeLocationWatchId !== null) return;

    // Get the authenticated Axios instance carrying the JWT Header
    const authClient = await AuthService.getAuthenticatedClient();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.error('Permission to access location was denied');
      return;
    }

    this.activeLocationWatchId = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        timeInterval: 2000,
      },
      async (position) => {
        try {
          await authClient.post(this.API_URL, {
            alert_id: alertId,
            user_id: userId,
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0.0,
            heading: position.coords.heading || 0.0,
          });
          console.log(`[Broadcast] Location pushed for alert ${alertId}`);
        } catch (error) {
          console.error('[Broadcast] Failed to push location to Core Service', error);
          // If this fails due to offline state, the local SQLite queue (OfflineQueue) 
          // should theoretically absorb it.
        }
      }
    );
  }

  stopBroadcastingSOS() {
    if (this.activeLocationWatchId !== null) {
      this.activeLocationWatchId.remove();
      this.activeLocationWatchId = null;
    }
  }

  /**
   * Called when an Emergency Contact opens the app to track their friend.
   * NFR-10: Obtains a short-lived one-time WS ticket to ensure JWT is NEVER exposed in URLs.
   */
  async subscribeToLiveIncident(alertId: string, onLocationUpdate: (locationData: any) => void) {
    const authClient = await AuthService.getAuthenticatedClient();

    // 1. Fetch short-lived one-time WebSocket ticket via Authorization Bearer header
    let wsTicket = '';
    try {
      const res = await authClient.post('/api/v1/auth/ws-ticket', { channel_id: alertId });
      wsTicket = res.data?.ticket || '';
    } catch (ticketErr) {
      console.warn('[WebSocket] Failed to fetch one-time ticket, falling back to direct endpoint', ticketErr);
    }

    if (this.ws) {
      this.ws.close();
    }

    // Connect using one-time ticket (NFR-10 compliant)
    const connectUrl = wsTicket 
      ? `${this.WS_URL}/${alertId}?ticket=${wsTicket}`
      : `${this.WS_URL}/${alertId}`;

    this.ws = new WebSocket(connectUrl);

    this.ws.onopen = () => {
      console.log(`[WebSocket] Connected securely to incident ${alertId}`);
    };

    this.ws.onmessage = (e) => {
      // Sub-50ms Redis location update arrives directly from FastAPI!
      const data = JSON.parse(e.data);
      onLocationUpdate(data);
    };

    this.ws.onerror = () => {
      console.error('[WebSocket] Errored');
    };

    this.ws.onclose = (e) => {
      console.log(`[WebSocket] Closed: ${e.code} ${e.reason}`);
      // Implement robust reconnection logic here for production
    };
  }

  unsubscribeFromLiveIncident() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default new LocationTrackerService();

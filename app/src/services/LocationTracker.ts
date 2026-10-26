import * as Location from 'expo-location';
import AuthService from './authService';
import { WS_BACKEND_URL } from '../config/env';

const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Live location during an SOS.
 * 1. The walker's phone pushes fixes to POST /api/v1/alerts/{id}/location.
 * 2. Guardians follow /ws/alert/{id}, authenticated by a one-time ticket so the
 *    JWT never appears in a URL (NFR-10).
 */
class LocationTrackerService {
  private activeLocationWatchId: Location.LocationSubscription | null = null;
  private ws: WebSocket | null = null;
  private subscribedAlertId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1000;

  async startBroadcastingSOS(alertId: string) {
    if (this.activeLocationWatchId !== null) return;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.error('Permission to access location was denied');
      return;
    }
    const authClient = await AuthService.getAuthenticatedClient();

    this.activeLocationWatchId = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 2000 },
      async (position) => {
        try {
          await authClient.post(`/api/v1/alerts/${alertId}/location`, {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy ?? undefined,
            speed: position.coords.speed ?? undefined,
            heading: position.coords.heading ?? undefined
          });
        } catch (error: any) {
          // 409: the alert was closed (cancelled or resolved), so stop streaming
          if (error?.response?.status === 409) this.stopBroadcastingSOS();
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

  /** Guardian side: follow a walker's live SOS location, reconnecting with backoff. */
  async subscribeToLiveIncident(alertId: string, onLocationUpdate: (locationData: any) => void) {
    this.unsubscribeFromLiveIncident();
    this.subscribedAlertId = alertId;
    this.reconnectDelayMs = 1000;
    await this.connect(alertId, onLocationUpdate);
  }

  private async connect(alertId: string, onLocationUpdate: (locationData: any) => void) {
    if (this.subscribedAlertId !== alertId) return;
    let ticket = '';
    try {
      const authClient = await AuthService.getAuthenticatedClient();
      const res = await authClient.post('/api/v1/auth/ws-ticket', { channel_id: alertId });
      ticket = res.data?.ticket || '';
    } catch (ticketErr: any) {
      if (ticketErr?.response?.status === 404) return; // no access to this alert: do not retry
    }
    if (!ticket) {
      this.scheduleReconnect(alertId, onLocationUpdate);
      return;
    }

    const ws = new WebSocket(`${WS_BACKEND_URL}/ws/alert/${alertId}?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;
    ws.onopen = () => { this.reconnectDelayMs = 1000; };
    ws.onmessage = (e) => {
      try {
        onLocationUpdate(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      // Any drop, including an expired ticket (1008), retries with a fresh ticket; access loss stops at the 404 above
      this.scheduleReconnect(alertId, onLocationUpdate);
    };
  }

  private scheduleReconnect(alertId: string, onLocationUpdate: (locationData: any) => void) {
    if (this.subscribedAlertId !== alertId || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(alertId, onLocationUpdate);
    }, delay);
  }

  unsubscribeFromLiveIncident() {
    this.subscribedAlertId = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
  }
}

export default new LocationTrackerService();

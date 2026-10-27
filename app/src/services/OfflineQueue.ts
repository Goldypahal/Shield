import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import AuthService from './authService';

/** Trigger types accepted by POST /api/v1/alerts/sync. */
export type TriggerType =
  | 'SOS_BUTTON' | 'AUDIO' | 'AUDIO_DISTRESS' | 'MOTION' | 'FALL' | 'SHAKE' | 'VOICE'
  | 'DEVIATION' | 'DURESS_PIN' | 'CHECKIN_TIMEOUT' | 'AUTO_TRIGGER';

export interface AlertData {
  id: string; // UUID generated on the device: makes retries idempotent (ALERT-4)
  trigger_type: TriggerType;
  lat: number;
  lon: number;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  walk_id?: string;
  message?: string;
}

type QueuedAlert = { payload: AlertData; createdAt: number; attempts: number };

const QUEUE_KEY = '@shield_pending_alerts';
const MAX_ATTEMPTS = 50; // an SOS is worth retrying for a long time

/**
 * Persist-first alert queue (ALERT-4, ALERT-6, ALERT-7).
 *
 * The alert is written to device storage before any network call, so an SOS
 * survives no signal, a crash or an app restart; syncWhenOnline() replays it.
 * Pure JS on AsyncStorage: no native modules, so it runs in Expo Go as well.
 */
class OfflineQueueService {
  private syncing: Promise<void> | null = null;
  private listeners: Set<(count: number) => void> = new Set();

  onQueueChange(callback: (count: number) => void): () => void {
    this.listeners.add(callback);
    this.pendingCount().then(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify() {
    this.pendingCount().then((count) => {
      this.listeners.forEach((l) => l(count));
    }).catch(() => undefined);
  }

  private async read(): Promise<QueuedAlert[]> {
    try {
      return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]') as QueuedAlert[];
    } catch {
      return [];
    }
  }

  private async write(items: QueuedAlert[]) {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    this.notify();
  }

  async pendingCount(): Promise<number> {
    return (await this.read()).length;
  }

  /** Stores the alert, then tries to deliver it. Returns whether the server has it yet. */
  async queueAlert(alert: AlertData): Promise<'synced' | 'queued'> {
    const items = await this.read();
    if (!items.some((i) => i.payload.id === alert.id)) {
      items.push({ payload: alert, createdAt: Date.now(), attempts: 0 });
      await this.write(items);
    }
    await this.syncWhenOnline();
    return (await this.read()).some((i) => i.payload.id === alert.id) ? 'queued' : 'synced';
  }

  async isQueued(alertId: string): Promise<boolean> {
    return (await this.read()).some((i) => i.payload.id === alertId);
  }

  /** Drops an alert that never reached the server (stood down with the PIN while offline). */
  async remove(alertId: string): Promise<void> {
    await this.write((await this.read()).filter((i) => i.payload.id !== alertId));
  }

  /** Replays every pending alert. Safe to call often, e.g. on each NetInfo reconnect. */
  syncWhenOnline(): Promise<void> {
    if (!this.syncing) {
      this.syncing = this.flush().finally(() => {
        this.syncing = null;
        this.notify();
      });
    }
    return this.syncing;
  }

  private async flush() {
    const items = await this.read();
    if (items.length === 0) return;
    const client = await AuthService.getAuthenticatedClient();
    const remaining: QueuedAlert[] = [];

    for (const item of items) {
      try {
        await client.post('/api/v1/alerts/sync', item.payload, { timeout: 5000 });
        // 201 for both "synced" and "already_synced": either way the server has it
      } catch (error: any) {
        const status: number | undefined = error?.response?.status;
        const permanent = status !== undefined && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
        if (permanent) {
          console.error(`Alert ${item.payload.id} rejected by server (${status}); dropping`, error?.response?.data);
        } else if (item.attempts + 1 < MAX_ATTEMPTS) {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      }
    }
    // Merge with anything queued while we were sending
    const latest = await this.read();
    const sentIds = new Set(items.map((i) => i.payload.id));
    await this.write([...remaining, ...latest.filter((i) => !sentIds.has(i.payload.id))]);
  }

  /**
   * Last-resort SMS when there is no data connection. Opens the SMS composer
   * prefilled, because sending without user interaction needs a native module
   * and a Play-Store-restricted permission (see docs/ROADMAP.md).
   */
  async openSmsFallback(phones: string[], message: string): Promise<boolean> {
    const recipients = phones.filter(Boolean).join(',');
    if (!recipients) return false;
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${recipients}${separator}body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export default new OfflineQueueService();

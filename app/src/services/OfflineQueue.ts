import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';
import { NativeModules, Platform } from 'react-native';
// Assuming you have an HTTP client configured or you fall back to fetch
import axios from 'axios';
import AuthService from './authService';
import { BACKEND_URL } from '../config/env';

SQLite.enablePromise(true);

export interface AlertData {
  id: string; // pre-generated UUID on device
  type: string;
  lat: number;
  lon: number;
  message: string;
  contacts: string[];
}

export interface RegionalEmergencyConfig {
  region: string;
  emergencySmsEnabled: boolean;
  verifiedNumbers: string[];
}

class OfflineQueueService {
  private db: SQLiteDatabase | null = null;
  private readonly API_URL = `${BACKEND_URL}/api/v1/alerts/sync`;
  private regionalConfig: RegionalEmergencyConfig = {
    region: 'IN-DL',
    emergencySmsEnabled: false, // ALERT-4, ALERT-6: Disabled until verified for relevant region
    verifiedNumbers: []
  };

  /**
   * Configures regional emergency dispatch settings.
   */
  setRegionalConfig(config: Partial<RegionalEmergencyConfig>) {
    this.regionalConfig = { ...this.regionalConfig, ...config };
  }

  getRegionalConfig(): RegionalEmergencyConfig {
    return { ...this.regionalConfig };
  }

  async initDatabase() {
    this.db = await SQLite.openDatabase({
      name: 'shield_offline.db',
      location: 'default',
    });

    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS pending_alerts (
        id UUID PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        sync_attempts INTEGER DEFAULT 0
      );
    `);
  }

  /**
   * Triggers an alert. Assumes no internet initially.
   * Caches offline, attempts to send over cellular SMS as a fallback.
   * When internet restores, the daemon will pick it up and sync it to FastAPI.
   */
  async queueAlert(alertData: AlertData) {
    if (!this.db) await this.initDatabase();

    try {
      // ALERT-4, ALERT-6: Only include emergency numbers if explicitly enabled and verified for region
      const targetContacts = [...alertData.contacts];
      if (this.regionalConfig.emergencySmsEnabled && this.regionalConfig.verifiedNumbers.length > 0) {
        targetContacts.push(...this.regionalConfig.verifiedNumbers);
      }
      
      const payloadWithServices = {
          ...alertData,
          contacts: targetContacts,
          message: this.regionalConfig.emergencySmsEnabled 
            ? `${alertData.message}\nShared with Emergency Services and Guardians.`
            : `${alertData.message}\nShared with Verified Guardians.`
      };

      // 1. Store the alert locally immediately
      await this.db!.executeSql(
        'INSERT INTO pending_alerts (id, payload, created_at, status) VALUES (?, ?, ?, ?)',
        [alertData.id, JSON.stringify(payloadWithServices), Date.now(), 'PENDING']
      );

      // 2. Fallback to SMS directly over the cellular network if offline
      // This is critical for zones with poor data.
      await this.sendSMSViaCellular(targetContacts, payloadWithServices.message);

      // 3. Try to sync to server for live dashboard tracking
      this.syncWhenOnline();

    } catch (error) {
      console.error('Failed to queue alert locally:', error);
    }
  }

  /**
   * Background process triggered by React Native NetInfo when connection is established
   */
  async syncWhenOnline() {
    if (!this.db) await this.initDatabase();

    try {
      // Fetch all pending alerts
      const [results] = await this.db!.executeSql(
        "SELECT * FROM pending_alerts WHERE status = 'PENDING' AND sync_attempts < 5"
      );

      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        const payloadStr = row.payload;
        
        try {
          // Increment attempt counter
          await this.db!.executeSql(
            'UPDATE pending_alerts SET sync_attempts = sync_attempts + 1 WHERE id = ?',
            [row.id]
          );

          // Get the securely stored JWT Token from device storage
          const token = await AuthService.getToken();
          if (!token) throw new Error('No Auth Token found. CANNOT SYNC OFFLINE ALERT!');

          // Upload to server (PostgreSQL Backend)
          const response = await axios.post(this.API_URL, JSON.parse(payloadStr), {
            headers: {
              Authorization: `Bearer ${token}`
            },
            timeout: 5000 // Short timeout since it's an emergency sync
          });

          if (response.status === 200 || response.status === 201) {
            // Mark as synced so we don't re-upload it
            await this.markSynced(row.id);
            console.log(`Successfully synced offline alert ${row.id}`);
          }
        } catch (uploadError) {
          console.warn(`Failed to sync alert ${row.id}, will retry later`, uploadError);
        }
      }
    } catch (error) {
      console.error('Error reading offline queue for sync:', error);
    }
  }

  /**
   * Native bridge to send SMS via the phone's native cellular capabilities.
   * This ensures the alert goes out even in 2G/Edge networks or strictly voice/SMS zones.
   */
  private async sendSMSViaCellular(contacts: string[], message: string) {
    if (Platform.OS === 'android') {
      try {
        const DirectSms = NativeModules.DirectSms;
        // Requires SEND_SMS permission on Android
        for (const phone of contacts) {
          await DirectSms.sendDirectSms(phone, message);
        }
      } catch (error) {
        console.error('Failed to trigger native SMS:', error);
      }
    } else {
      // iOS has heavy restrictions on direct SMS sending without user interaction (MFMessageComposeViewController).
      // We would use an App Extension or fallback to Siri Shortcuts integration for seamless SOS.
      console.log('Direct SMS on iOS requires native overrides or user prompt.');
    }
  }

  private async markSynced(alertId: string) {
    await this.db!.executeSql(
      "UPDATE pending_alerts SET status = 'SYNCED' WHERE id = ?",
      [alertId]
    );
  }
}

export default new OfflineQueueService();

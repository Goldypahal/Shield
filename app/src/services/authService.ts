import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { BACKEND_URL } from '../config/env';

type AuthResponse = {
  user_id: string;
  access_token: string;
  token_type: string;
  duress_mode_active?: boolean;
};

type DemoSession = {
  uid: string;
  phone: string;
  name: string;
  isOffline: boolean;
};

class AuthService {
  private readonly API_URL = `${BACKEND_URL}/api/v1/auth`;
  private readonly JWT_KEY = '@shield_jwt_token';
  private readonly USER_ID_KEY = '@shield_user_id';
  private readonly DEMO_PHONE = '+910000000000';
  private readonly DEMO_PIN = '0000';
  private readonly DEMO_DURESS_PIN = '9999';
  private readonly DEMO_NAME = 'Shield Demo User';

  async register(phoneNumber: string, pin: string, deviceId?: string) {
    const response = await axios.post<AuthResponse>(`${this.API_URL}/register`, {
      phone_number: phoneNumber,
      pin,
      duress_pin: this.DEMO_DURESS_PIN,
      device_id: deviceId
    });

    await this.persistSession(response.data.user_id, response.data.access_token);
    return response.data;
  }

  /**
   * Completes the login process and securely stores the JWT for all future requests.
   */
  async login(phoneNumber: string, pin: string, deviceId?: string) {
    try {
      const response = await axios.post<AuthResponse>(`${this.API_URL}/login`, {
        phone_number: phoneNumber,
        pin,
        device_id: deviceId
      });

      await this.persistSession(response.data.user_id, response.data.access_token);
      return response.data;
    } catch (error) {
      console.error('Login Failed', error);
      throw error;
    }
  }

  async quickHackathonLogin(): Promise<DemoSession> {
    const cachedUid = await AsyncStorage.getItem(this.USER_ID_KEY);
    const cachedToken = await this.getToken();
    if (cachedUid && cachedToken) {
      return {
        uid: cachedUid,
        phone: this.DEMO_PHONE,
        name: this.DEMO_NAME,
        isOffline: false
      };
    }

    try {
      const response = await this.login(this.DEMO_PHONE, this.DEMO_PIN, 'shield-demo-device');
      return {
        uid: response.user_id,
        phone: this.DEMO_PHONE,
        name: this.DEMO_NAME,
        isOffline: false
      };
    } catch {
      try {
        const response = await this.register(this.DEMO_PHONE, this.DEMO_PIN, 'shield-demo-device');
        return {
          uid: response.user_id,
          phone: this.DEMO_PHONE,
          name: this.DEMO_NAME,
          isOffline: false
        };
      } catch {
        const offlineUid = cachedUid || 'local-demo-user';
        await AsyncStorage.setItem(this.USER_ID_KEY, offlineUid);
        return {
          uid: offlineUid,
          phone: this.DEMO_PHONE,
          name: this.DEMO_NAME,
          isOffline: true
        };
      }
    }
  }

  /**
   * Use this to retrieve the token to attach to the Authorization Header
   * for HTTP calls or the ?token= query parameter for WebSockets.
   */
  async getToken(): Promise<string | null> {
    return await AsyncStorage.getItem(this.JWT_KEY);
  }

  async logout() {
    await AsyncStorage.removeItem(this.JWT_KEY);
    await AsyncStorage.removeItem(this.USER_ID_KEY);
  }

  /**
   * Helper function for standard authenticated axios requests.
   */
  async getAuthenticatedClient() {
    const token = await this.getToken();
    return axios.create({
      baseURL: BACKEND_URL,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  async getUserId(): Promise<string | null> {
    return await AsyncStorage.getItem(this.USER_ID_KEY);
  }

  private async persistSession(userId: string, token: string) {
    await AsyncStorage.setItem(this.JWT_KEY, token);
    await AsyncStorage.setItem(this.USER_ID_KEY, userId);
  }
}

const authService = new AuthService();

export const quickHackathonLogin = () => authService.quickHackathonLogin();

export default authService;

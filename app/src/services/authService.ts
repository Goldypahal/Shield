import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { BACKEND_URL } from '../config/env';
import { getSecret, setSecret, deleteSecret } from './secureStorage';
import { rememberPins, forgetPins } from './pinVault';

type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

type AuthResponse = TokenPair & { user_id: string };

export type Session = {
  uid: string;
  phone: string;
  name: string;
  email: string;
  isOffline: boolean;
};

/** Codes returned by a backend in demo mode (development only); real deployments send them by email/SMS. */
export type DemoCodes = { demo_email_code?: string; demo_phone_code?: string };

export type RegisterDetails = {
  name: string;
  email: string;
  phone: string;
  password: string;
  emailCode: string;
  phoneCode: string;
  pin: string;
  duressPin: string;
  /** Explicit consent to send SOS alerts to the police as well as guardians. */
  policeSharing: boolean;
};

const REQUEST_TIMEOUT_MS = 8000;

/** Turns an API error into a sentence for the user. */
export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Check your connection and try again.') {
  const e = err as AxiosError<{ detail?: unknown }>;
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
}

class AuthService {
  private readonly API_URL = `${BACKEND_URL}/api/v1`;
  // Tokens are secrets: OS keystore. Profile fields are not: plain storage.
  private readonly ACCESS_KEY = 'access_token';
  private readonly REFRESH_KEY = 'refresh_token';
  private readonly PROFILE_KEY = '@shield_session_profile';
  private refreshInFlight: Promise<string | null> | null = null;
  private listeners = new Set<(session: Session | null) => void>();

  /** App.tsx listens so it can return to the sign-in screen when the session ends. */
  onSessionChange(listener: (session: Session | null) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(session: Session | null) {
    this.listeners.forEach((l) => l(session));
  }

  async registerStart(email: string, phone: string): Promise<DemoCodes> {
    const res = await axios.post(`${this.API_URL}/auth/register/start`, { email, phone_number: phone },
      { timeout: REQUEST_TIMEOUT_MS });
    return res.data;
  }

  async registerComplete(d: RegisterDetails): Promise<Session> {
    const res = await axios.post<AuthResponse>(`${this.API_URL}/auth/register/complete`, {
      email: d.email, email_code: d.emailCode, phone_number: d.phone, phone_code: d.phoneCode,
      password: d.password, name: d.name, pin: d.pin, duress_pin: d.duressPin || undefined,
      police_sharing: d.policeSharing,
    }, { timeout: REQUEST_TIMEOUT_MS });
    await rememberPins(d.pin, d.duressPin);
    return this.startSession(res.data);
  }

  async login(email: string, password: string): Promise<Session> {
    const res = await axios.post<AuthResponse>(`${this.API_URL}/auth/login`, { email, password },
      { timeout: REQUEST_TIMEOUT_MS });
    return this.startSession(res.data);
  }

  async forgotPassword(email: string): Promise<DemoCodes> {
    const res = await axios.post(`${this.API_URL}/auth/password/forgot`, { email }, { timeout: REQUEST_TIMEOUT_MS });
    return res.data;
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await axios.post(`${this.API_URL}/auth/password/reset`, { email, code, new_password: newPassword },
      { timeout: REQUEST_TIMEOUT_MS });
  }

  async requestPinChangeCode(): Promise<DemoCodes> {
    const client = await this.getAuthenticatedClient();
    return (await client.post('/api/v1/me/pins/code')).data;
  }

  async changePins(emailCode: string, password: string, pin: string, duressPin: string): Promise<void> {
    const client = await this.getAuthenticatedClient();
    await client.post('/api/v1/me/pins', { email_code: emailCode, password, pin, duress_pin: duressPin });
    await rememberPins(pin, duressPin);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const client = await this.getAuthenticatedClient();
    const res = await client.post<TokenPair>('/api/v1/me/password',
      { current_password: currentPassword, new_password: newPassword });
    await this.storeTokens(res.data);
  }

  /**
   * Confirms the SOS PIN with the server. A duress PIN gets the same answer while the
   * server silently opens an alert, so this device never learns which one was typed.
   */
  async checkPinOnline(pin: string, lat?: number, lon?: number): Promise<boolean> {
    const client = await this.getAuthenticatedClient();
    try {
      await client.post('/api/v1/me/pin/check', { pin, lat, lon }, { timeout: 30000 }); // a sleeping server needs time
      return true;
    } catch (e) {
      if ((e as AxiosError).response?.status === 403) return false;
      throw e;
    }
  }

  /** Restores the stored session; null means the user must sign in. */
  async ensureSession(): Promise<Session | null> {
    const [token, profile] = await Promise.all([getSecret(this.REFRESH_KEY), AsyncStorage.getItem(this.PROFILE_KEY)]);
    if (!token || !profile) return null;
    return { ...JSON.parse(profile), isOffline: false };
  }

  /**
   * Development builds only: signs in the test account from EXPO_PUBLIC_DEV_LOGIN_EMAIL /
   * EXPO_PUBLIC_DEV_LOGIN_PASSWORD so testers skip the sign-in screen. Returns null (and the
   * sign-in screen is shown) when they are not set, in release builds, or if sign-in fails.
   */
  async devAutoSignIn(): Promise<Session | null> {
    const email = process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
    const password = process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD;
    if (!__DEV__ || !email || !password) return null;
    try {
      return await this.login(email, password);
    } catch (e) {
      console.warn('[auth] Dev auto sign-in failed; showing the sign-in screen.', authErrorMessage(e));
      return null;
    }
  }

  async getToken(): Promise<string | null> {
    return getSecret(this.ACCESS_KEY);
  }

  /** Ends this device's session. */
  async logout() {
    const refresh = await getSecret(this.REFRESH_KEY);
    if (refresh) {
      axios.post(`${this.API_URL}/auth/logout`, { refresh_token: refresh }, { timeout: REQUEST_TIMEOUT_MS }).catch(() => undefined);
    }
    await this.clearLocal();
  }

  /** Ends every session of the account, on every device. */
  async logoutEverywhere() {
    const client = await this.getAuthenticatedClient();
    await client.post('/api/v1/auth/logout-all');
    await this.clearLocal();
  }

  private async clearLocal() {
    await Promise.all([deleteSecret(this.ACCESS_KEY), deleteSecret(this.REFRESH_KEY), forgetPins(),
      AsyncStorage.removeItem(this.PROFILE_KEY)]);
    this.emit(null);
  }

  private async startSession(data: AuthResponse): Promise<Session> {
    await this.storeTokens(data);
    const me = (await axios.get(`${this.API_URL}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` }, timeout: REQUEST_TIMEOUT_MS,
    })).data;
    const session: Session = { uid: me.id, phone: me.phone_number, name: me.name, email: me.email, isOffline: false };
    await AsyncStorage.setItem(this.PROFILE_KEY, JSON.stringify({ uid: session.uid, phone: session.phone,
      name: session.name, email: session.email }));
    this.emit(session);
    return session;
  }

  private async storeTokens(data: TokenPair) {
    await Promise.all([setSecret(this.ACCESS_KEY, data.access_token), setSecret(this.REFRESH_KEY, data.refresh_token)]);
  }

  /** Exchanges the refresh token once, even when several requests hit 401 together. */
  private async refreshAccessToken(): Promise<string | null> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        const refreshToken = await getSecret(this.REFRESH_KEY);
        if (!refreshToken) return null;
        try {
          const res = await axios.post<TokenPair>(`${this.API_URL}/auth/refresh`, { refresh_token: refreshToken },
            { timeout: REQUEST_TIMEOUT_MS });
          await this.storeTokens(res.data);
          return res.data.access_token;
        } catch (e) {
          // Only a definite rejection ends the session; being offline must not sign the user out
          if ((e as AxiosError).response?.status === 401) await this.clearLocal();
          return null;
        } finally {
          setTimeout(() => { this.refreshInFlight = null; }, 0);
        }
      })();
    }
    return this.refreshInFlight;
  }

  /** Axios client that sends the access token and transparently refreshes it once on 401. */
  async getAuthenticatedClient(): Promise<AxiosInstance> {
    const client = axios.create({ baseURL: BACKEND_URL, timeout: REQUEST_TIMEOUT_MS });
    client.interceptors.request.use(async (config) => {
      const token = await this.getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    client.interceptors.response.use(undefined, async (error: AxiosError) => {
      const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
      if (error.response?.status === 401 && original && !original._retried) {
        original._retried = true;
        const fresh = await this.refreshAccessToken();
        if (fresh) {
          original.headers.Authorization = `Bearer ${fresh}`;
          return client.request(original);
        }
      }
      throw error;
    });
    return client;
  }

  async getUserId(): Promise<string | null> {
    return (await this.ensureSession())?.uid ?? null;
  }
}

const authService = new AuthService();

export default authService;

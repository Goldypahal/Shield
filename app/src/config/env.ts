// EXPO_PUBLIC_* variables are inlined at build time (see app/.env.example).
// On a physical phone, localhost is the phone itself: set EXPO_PUBLIC_BACKEND_URL
// to your computer's LAN address, e.g. http://192.168.1.20:8000.
const rawBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export const BACKEND_URL = rawBackendUrl.replace(/\/$/, '');
export const WS_BACKEND_URL = BACKEND_URL.replace(/^http/i, 'ws');

export const FIREBASE_PLACEHOLDERS = [
  'YOUR_API_KEY',
  'YOUR_PROJECT.firebaseapp.com',
  'YOUR_PROJECT_ID',
  'YOUR_PROJECT.appspot.com',
  'YOUR_SENDER_ID',
  'YOUR_APP_ID'
];

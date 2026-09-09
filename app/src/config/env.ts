const rawBackendUrl = 'http://localhost:8000';

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

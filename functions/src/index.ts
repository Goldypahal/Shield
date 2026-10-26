import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

admin.initializeApp();

const MAX_CONTACTS = 5;
const MIN_SECONDS_BETWEEN_SOS = 60;
const E164 = /^\+[1-9]\d{7,14}$/;

type Contact = {
  name: string;
  phone: string;
};

let twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !process.env.TWILIO_PHONE_NUMBER) {
    throw new functions.https.HttpsError('failed-precondition', 'SMS provider is not configured.');
  }
  twilioClient ??= twilio(sid, token);
  return twilioClient;
}

/**
 * Fallback alert channel used by the app when the SHIELD API is unreachable.
 *
 * Guarded because it sends paid SMS and voice calls: callers must be signed
 * in, may only alert for their own incident, at most 5 E.164 numbers, and at
 * most once a minute.
 */
export const sendEmergencyAlerts = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }

    const { incidentId, userName, contacts, mapsLink, audioUrl, threatScore, threatLevel } = data as {
      incidentId: string;
      userName: string;
      contacts: Contact[];
      mapsLink: string;
      audioUrl?: string;
      threatScore: number;
      threatLevel: string;
    };

    if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > MAX_CONTACTS) {
      throw new functions.https.HttpsError('invalid-argument', `Provide 1 to ${MAX_CONTACTS} contacts.`);
    }
    const phones = contacts.map((c) => String(c?.phone ?? '').replace(/[\s-]/g, ''));
    if (!phones.every((p) => E164.test(p))) {
      throw new functions.https.HttpsError('invalid-argument', 'Contacts must be E.164 numbers, e.g. +919876543210.');
    }

    const db = admin.firestore();
    const incidentRef = db.collection('incidents').doc(String(incidentId));
    const incident = await incidentRef.get();
    if (!incident.exists || incident.get('userId') !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Unknown incident.');
    }

    // One SOS fan-out per user per minute
    const limitRef = db.collection('sosRateLimits').doc(uid);
    await db.runTransaction(async (tx) => {
      const last = (await tx.get(limitRef)).get('lastSentAt') as number | undefined;
      if (last && Date.now() - last < MIN_SECONDS_BETWEEN_SOS * 1000) {
        throw new functions.https.HttpsError('resource-exhausted', 'An alert was just sent.');
      }
      tx.set(limitRef, { lastSentAt: Date.now() });
    });

    const client = getTwilio();
    const from = process.env.TWILIO_PHONE_NUMBER as string;
    const name = String(userName || 'A SHIELD user').slice(0, 60);
    const body =
      `EMERGENCY ALERT from ${name}. ` +
      `Threat Level: ${threatLevel}. Score: ${threatScore}. ` +
      `Live Location: ${mapsLink} ` +
      (audioUrl ? `Audio: ${audioUrl}` : '');

    const results = await Promise.allSettled(
      phones.map(async (to) => {
        await client.messages.create({ body, from, to });
        await client.calls.create({
          twiml: `<Response><Say voice="alice">Emergency alert from SHIELD. Please check your messages and live location immediately.</Say></Response>`,
          from,
          to
        });
      })
    );
    const delivered = results.filter((r) => r.status === 'fulfilled').length;

    await incidentRef.set(
      {
        status: delivered > 0 ? 'SENT' : 'PENDING',
        delivery: { sms: delivered > 0, call: delivered > 0, delivered, attempted: phones.length },
        updatedAt: Date.now()
      },
      { merge: true }
    );

    return { success: delivered > 0, delivered, attempted: phones.length };
  });

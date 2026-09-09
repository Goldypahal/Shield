import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

admin.initializeApp();

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioNumber = process.env.TWILIO_PHONE_NUMBER || '';
const client = twilio(accountSid, authToken);

type Contact = {
  name: string;
  phone: string;
};

export const sendEmergencyAlerts = functions
  .region('asia-south1')
  .https.onCall(async (data) => {
    const {
      incidentId,
      userName,
      contacts,
      mapsLink,
      audioUrl,
      threatScore,
      threatLevel
    } = data as {
      incidentId: string;
      userName: string;
      contacts: Contact[];
      mapsLink: string;
      audioUrl?: string;
      threatScore: number;
      threatLevel: string;
    };

    const body =
      `EMERGENCY ALERT from ${userName}. ` +
      `Threat Level: ${threatLevel}. Score: ${threatScore}. ` +
      `Live Location: ${mapsLink} ` +
      (audioUrl ? `Audio: ${audioUrl}` : '');

    await Promise.all(
      contacts.map(async (contact) => {
        await client.messages.create({
          body,
          from: twilioNumber,
          to: contact.phone
        });

        await client.calls.create({
          twiml: `<Response><Say voice="alice">Emergency alert from ${userName}. Please check the message and live location immediately.</Say></Response>`,
          from: twilioNumber,
          to: contact.phone
        });
      })
    );

    await admin.firestore().collection('incidents').doc(incidentId).set(
      {
        status: 'SENT',
        delivery: { sms: true, call: true },
        updatedAt: Date.now()
      },
      { merge: true }
    );

    return { success: true };
  });

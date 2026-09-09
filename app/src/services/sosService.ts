import { httpsCallable } from 'firebase/functions';
import { functions, storage } from '../firebase/config';
import { isFirebaseConfigured } from '../firebase/config';
import { createIncident, updateIncident } from './firestoreService';
import { buildMapsLink, getCurrentLocation } from './locationService';
import { stopIncidentRecording } from './audioService';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { IncidentLog, UserProfile } from '../types';
import AuthService from './authService';
import LocationTracker from './LocationTracker';
import ContactService from './contactService';

async function uploadAudio(uri: string, userId: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const path = `incident-audio/${userId}/${Date.now()}.m4a`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}

export async function triggerEmergency(profile: UserProfile, threatScore: number, threatLevel: 'LOW' | 'MEDIUM' | 'HIGH') {
  const { latitude, longitude } = await getCurrentLocation();
  const alertId = `${profile.uid}-${Date.now()}`;

  const incident: IncidentLog = {
    id: alertId,
    userId: profile.uid,
    timestamp: Date.now(),
    latitude,
    longitude,
    threatScore,
    threatLevel,
    status: 'PENDING'
  };

  const incidentId = await createIncident(incident);

  let audioUrl: string | undefined;
  const localAudioUri = await stopIncidentRecording();
  if (localAudioUri && isFirebaseConfigured) {
    audioUrl = await uploadAudio(localAudioUri, profile.uid);
    await updateIncident(incidentId, { audioUrl });
  }
  const mapsLink = buildMapsLink(latitude, longitude);
  const fallbackContacts = await ContactService.listContacts();
  const contacts = (profile.emergencyContacts.length > 0 ? profile.emergencyContacts : fallbackContacts)
    .map((contact) => contact.phone)
    .filter(Boolean);

  try {
    const client = await AuthService.getAuthenticatedClient();
    await client.post('/api/v1/alerts/sync', {
      id: alertId,
      type: 'AUTO_TRIGGER',
      lat: latitude,
      lon: longitude,
      message: `Emergency triggered for ${profile.name}. Live location: ${mapsLink}`,
      contacts,
      threat_score: threatScore,
      threat_level: threatLevel.toLowerCase()
    });

    await updateIncident(incidentId, {
      status: 'SENT',
      delivery: { sms: contacts.length > 0, call: false },
      audioUrl
    });

    await LocationTracker.startBroadcastingSOS(alertId, profile.uid);
    return incidentId;
  } catch (backendError) {
    console.warn('Backend SOS sync failed, falling back to Firebase/local mode.', backendError);
  }

  if (isFirebaseConfigured) {
    const sendAlert = httpsCallable(functions, 'sendEmergencyAlerts');

    await sendAlert({
      incidentId,
      userName: profile.name,
      userPhone: profile.phone,
      contacts: profile.emergencyContacts,
      latitude,
      longitude,
      mapsLink,
      audioUrl,
      threatScore,
      threatLevel
    });

    await updateIncident(incidentId, {
      status: 'SENT',
      delivery: { sms: true, call: true }
    });
  }

  return incidentId;
}

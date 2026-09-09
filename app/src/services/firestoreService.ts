import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../firebase/config';
import { isFirebaseConfigured } from '../firebase/config';
import { IncidentLog, UserProfile } from '../types';

const USER_KEY = '@shield_local_users';
const INCIDENT_KEY = '@shield_local_incidents';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveUserProfile(profile: UserProfile) {
  if (!isFirebaseConfigured) {
    const users = await readJson<Record<string, UserProfile>>(USER_KEY, {});
    users[profile.uid] = profile;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(users));
    return;
  }

  await setDoc(doc(db, 'users', profile.uid), profile, { merge: true });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured) {
    const users = await readJson<Record<string, UserProfile>>(USER_KEY, {});
    return users[uid] ?? null;
  }

  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function createIncident(log: IncidentLog) {
  if (!isFirebaseConfigured) {
    const incidents = await readJson<IncidentLog[]>(INCIDENT_KEY, []);
    const id = log.id || `${log.userId}-${log.timestamp}`;
    incidents.unshift({ ...log, id });
    await AsyncStorage.setItem(INCIDENT_KEY, JSON.stringify(incidents));
    return id;
  }

  const ref = await addDoc(collection(db, 'incidents'), log);
  return ref.id;
}

export async function updateIncident(id: string, data: Partial<IncidentLog>) {
  if (!isFirebaseConfigured) {
    const incidents = await readJson<IncidentLog[]>(INCIDENT_KEY, []);
    const next = incidents.map((incident) =>
      incident.id === id ? { ...incident, ...data } : incident
    );
    await AsyncStorage.setItem(INCIDENT_KEY, JSON.stringify(next));
    return;
  }

  await updateDoc(doc(db, 'incidents', id), data);
}

export async function getIncidentHistory(uid: string) {
  if (!isFirebaseConfigured) {
    const incidents = await readJson<IncidentLog[]>(INCIDENT_KEY, []);
    return incidents.filter((incident) => incident.userId === uid);
  }

  const q = query(
    collection(db, 'incidents'),
    where('userId', '==', uid),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as IncidentLog[];
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService, { authErrorMessage } from './authService';
import { EmergencyContact } from '../types';

const CONTACTS_KEY = '@shield_contacts_local';

async function readLocalContacts(): Promise<EmergencyContact[]> {
  const raw = await AsyncStorage.getItem(CONTACTS_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as EmergencyContact[];
  } catch {
    return [];
  }
}

async function writeLocalContacts(contacts: EmergencyContact[]) {
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

/**
 * Turns what people type into the E.164 form the server needs: "98765 43210",
 * "098765-43210", "0091 9876543210" and "+91 98765 43210" all become "+919876543210".
 * Numbers without a country code are taken as Indian. Returns null if it cannot be a number.
 */
export function normalizePhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (/^[6-9]\d{9}$/.test(s)) s = `+91${s}`;                       // 10-digit Indian mobile
    else if (/^0[6-9]\d{9}$/.test(s)) s = `+91${s.slice(1)}`;        // with trunk 0
    else if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`;                  // 91 without +
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

class ContactService {
  async listContacts(): Promise<EmergencyContact[]> {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const response = await client.get<{
        contacts: Array<{ id: string; name: string; phone_number: string; verified?: boolean; priority?: number }>;
      }>('/api/v1/contacts');

      if (!response.data || !response.data.contacts) {
        return readLocalContacts();
      }

      const contacts: EmergencyContact[] = response.data.contacts.map((contact) => ({
        id: contact.id || `${contact.phone_number}-${Date.now()}`,
        name: contact.name || 'Unknown',
        phone: contact.phone_number,
        verified: !!contact.verified,
        priority: contact.priority ?? 1,
      }));

      await writeLocalContacts(contacts);
      return contacts;
    } catch {
      return readLocalContacts();
    }
  }

  /**
   * Adds a guardian on the server (the server sends the SOS to them). Throws a readable
   * message on failure: it no longer pretends to save a guardian only on this phone, because
   * such a guardian would never be alerted.
   */
  async saveContact(contact: Omit<EmergencyContact, 'id'> & { id?: string }): Promise<EmergencyContact> {
    const phone = normalizePhone(contact.phone);
    if (!phone) throw new Error('Enter a valid mobile number, e.g. 98765 43210 or +91 98765 43210.');
    if (!(await AuthService.ensureSession())) throw new Error('Sign in to add guardians.');
    let response;
    try {
      const client = await AuthService.getAuthenticatedClient();
      response = await client.post<{
        contact: { id: string; name: string; phone_number: string; verified?: boolean; priority?: number };
      }>('/api/v1/contacts', {
        name: contact.name.trim(),
        phone_number: phone,
        priority: contact.priority ?? 1,
      }, { timeout: 30000 });
    } catch (e: any) {
      if (!e?.response) throw new Error('No connection to SHIELD. Check your internet and try again.');
      throw new Error(authErrorMessage(e, 'Could not add this guardian. Try again.'));
    }

    const saved: EmergencyContact = {
      id: response.data.contact.id,
      name: response.data.contact.name,
      phone: response.data.contact.phone_number,
      verified: !!response.data.contact.verified,
      priority: response.data.contact.priority ?? 1,
    };

    const existing = await readLocalContacts();
    const next = existing.filter((item) => item.id !== saved.id && item.phone !== saved.phone);
    next.push(saved);
    await writeLocalContacts(next);
    return saved;
  }

  async verifyGuardian(guardianId: string): Promise<boolean> {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const res = await client.post(`/api/v1/guardians/${guardianId}/verify`);
      if (res.status === 200) {
        // Update local status if cached
        const existing = await readLocalContacts();
        const updated = existing.map((c) => (c.id === guardianId ? { ...c, verified: true } : c));
        await writeLocalContacts(updated);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Failed to verify guardian invite', e);
      return false;
    }
  }

  getInviteLink(guardianId: string): string {
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    return `${backendUrl}/invite/${guardianId}`;
  }

  async deleteContact(contactId: string) {
    try {
      const client = await AuthService.getAuthenticatedClient();
      await client.delete(`/api/v1/contacts/${contactId}`);
    } catch {
      // Local fallback below.
    }

    const existing = await readLocalContacts();
    await writeLocalContacts(existing.filter((item) => item.id !== contactId));
  }
}

export default new ContactService();

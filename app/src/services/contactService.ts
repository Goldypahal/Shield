import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService from './authService';
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

  async saveContact(contact: Omit<EmergencyContact, 'id'> & { id?: string }): Promise<EmergencyContact> {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const response = await client.post<{
        contact: { id: string; name: string; phone_number: string; verified?: boolean; priority?: number };
      }>('/api/v1/contacts', {
        name: contact.name,
        phone_number: contact.phone,
        priority: contact.priority ?? 1,
      });

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
    } catch {
      const existing = await readLocalContacts();
      const saved: EmergencyContact = {
        id: contact.id || `${contact.phone}-${Date.now()}`,
        name: contact.name,
        phone: contact.phone,
        verified: false,
        priority: contact.priority ?? 1,
      };
      const next = existing.filter((item) => item.id !== saved.id && item.phone !== saved.phone);
      next.push(saved);
      await writeLocalContacts(next);
      return saved;
    }
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

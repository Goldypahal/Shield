import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ContactService from '../services/contactService';
import NotificationService from '../services/notificationService';
import AuthService from '../services/authService';
import VoiceService from '../services/VoiceService';
import { EmergencyContact, IncidentHistoryItem } from '../types';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [pin, setPin] = useState('');
  const [duressPin, setDuressPin] = useState('');
  const [keyword, setKeyword] = useState('help');
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [history, setHistory] = useState<IncidentHistoryItem[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
    loadContacts();
    loadIncidentHistory();
    setVoiceEnabled(VoiceService.getListeningStatus());
  }, []);

  const loadSettings = async () => {
    try {
      const savedPin = await AsyncStorage.getItem('@shield_pin');
      const savedDuressPin = await AsyncStorage.getItem('@shield_duress_pin');
      const savedKeyword = await AsyncStorage.getItem('@shield_keyword');
      const savedPushToken = await AsyncStorage.getItem('@shield_push_token');
      if (savedPin) setPin(savedPin);
      if (savedDuressPin) setDuressPin(savedDuressPin);
      if (savedKeyword) setKeyword(savedKeyword);
      if (savedPushToken) setPushToken(savedPushToken);
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  };

  const loadContacts = async () => {
    const next = await ContactService.listContacts();
    setContacts(next);
  };

  const loadIncidentHistory = async () => {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const response = await client.get<{ incidents: IncidentHistoryItem[] }>('/api/v1/incidents/history');
      setHistory(response.data.incidents || []);
    } catch (error) {
      console.warn('Failed to load incident history', error);
    }
  };

  const saveSettings = async () => {
    try {
      if (pin.length > 0 && pin.length < 4) {
        Alert.alert('Invalid PIN', 'PIN must be at least 4 digits.');
        return;
      }
      if (duressPin.length > 0 && duressPin.length < 4) {
        Alert.alert('Invalid Duress PIN', 'Duress PIN must be at least 4 digits.');
        return;
      }

      await AsyncStorage.setItem('@shield_pin', pin);
      await AsyncStorage.setItem('@shield_duress_pin', duressPin);
      await AsyncStorage.setItem('@shield_keyword', keyword);

      try {
        const client = await AuthService.getAuthenticatedClient();
        await client.post('/api/v1/auth/security-settings', {
          duress_pin: duressPin || undefined
        });
      } catch (error) {
        console.warn('Security settings sync failed', error);
      }

      Alert.alert('Saved', 'Your emergency preferences have been updated.');
    } catch (e) {
      Alert.alert('Error', 'Could not save settings.');
    }
  };

  const addContact = async () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      Alert.alert('Missing Fields', 'Enter both a contact name and phone number.');
      return;
    }

    const nameRegex = /^[A-Za-z\s]+$/;
    if (!nameRegex.test(contactName.trim())) {
      Alert.alert('Invalid Name', 'Name should contain only letters.');
      return;
    }

    if (contactName.trim().length > 12) {
      Alert.alert('Name Too Long', 'Name should be maximum 12 letters.');
      return;
    }

    const saved = await ContactService.saveContact({
      name: contactName.trim(),
      phone: contactPhone.trim()
    });

    setContacts((prev) => {
      const next = prev.filter((item) => item.id !== saved.id && item.phone !== saved.phone);
      return [...next, saved];
    });
    setContactName('');
    setContactPhone('');
  };

  const removeContact = async (contactId: string) => {
    await ContactService.deleteContact(contactId);
    setContacts((prev) => prev.filter((contact) => contact.id !== contactId));
  };

  const enablePushAlerts = async () => {
    const token = await NotificationService.registerForPushNotifications();
    if (!token) {
      Alert.alert('Notifications Disabled', 'Permission was not granted.');
      return;
    }

    await AsyncStorage.setItem('@shield_push_token', token);
    setPushToken(token);
    Alert.alert('Notifications Enabled', 'Guardian alerts can now raise local push notifications.');
  };

  const toggleVoice = async () => {
    if (voiceEnabled) {
      await VoiceService.stopListening();
      setVoiceEnabled(false);
    } else {
      await VoiceService.startListening();
      setVoiceEnabled(true);
      Alert.alert(
        'Voice Trigger Active', 
        'The app is now listening for your secret keyword. Background support is limited in Expo Go; keep the app open for best results.'
      );
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Safety Settings</Text>
      <Text style={styles.subtitle}>Configure contacts, duress behavior, alerts, and recent incident history.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Add Emergency Contact</Text>
        <TextInput
          style={styles.input}
          placeholder="Contact name (Max 12 chars)"
          placeholderTextColor="#666"
          value={contactName}
          onChangeText={setContactName}
          maxLength={12}
        />
        <TextInput
          style={styles.input}
          placeholder="e.g. +1 555 123 4567"
          placeholderTextColor="#666"
          keyboardType="phone-pad"
          value={contactPhone}
          onChangeText={setContactPhone}
        />
        <TouchableOpacity style={styles.inlineButton} onPress={addContact}>
          <Text style={styles.inlineButtonText}>Add Contact</Text>
        </TouchableOpacity>

        {contacts.length === 0 ? (
          <Text style={styles.hint}>No emergency contacts saved yet.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactRow}>
              <View>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>{contact.phone}</Text>
              </View>
              <TouchableOpacity onPress={() => removeContact(contact.id)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>SOS Cancellation PIN</Text>
        <TextInput
          style={styles.input}
          placeholder="4-digit PIN"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          value={pin}
          onChangeText={setPin}
        />
        <Text style={styles.hint}>This PIN is required to cancel a live or pending SOS.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Duress PIN</Text>
        <TextInput
          style={styles.input}
          placeholder="4-digit duress PIN"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          value={duressPin}
          onChangeText={setDuressPin}
        />
        <Text style={styles.hint}>Logging in with this PIN silently opens a high-risk incident in the backend.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Voice SOS Trigger</Text>
        <Text style={styles.hint}>
          Trigger an emergency alert hands-free by speaking your secret keyword: "{keyword}"
        </Text>
        <TouchableOpacity 
          style={[styles.inlineButton, voiceEnabled && { backgroundColor: '#4CAF50' }]} 
          onPress={toggleVoice}
        >
          <Text style={styles.inlineButtonText}>
            {voiceEnabled ? 'Listening Active' : 'Enable Voice Listening'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Secret Voice Keyword</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Help Me"
          placeholderTextColor="#666"
          autoCapitalize="none"
          value={keyword}
          onChangeText={setKeyword}
        />
        <Text style={styles.hint}>Stored locally for voice-trigger support.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Guardian Push Alerts</Text>
        <Text style={styles.hint}>
          {pushToken ? 'Push token registered on this device.' : 'Register this device for guardian alert notifications.'}
        </Text>
        <TouchableOpacity style={styles.inlineButton} onPress={enablePushAlerts}>
          <Text style={styles.inlineButtonText}>{pushToken ? 'Refresh Push Token' : 'Enable Push Alerts'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={saveSettings}>
        <Text style={styles.saveButtonText}>Save Configuration</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.label}>Recent Incident History</Text>
        {history.length === 0 ? (
          <Text style={styles.hint}>No incidents recorded yet.</Text>
        ) : (
          history.map((incident) => (
            <View key={incident.incident_id} style={styles.historyRow}>
              <Text style={styles.historyTitle}>
                {incident.threat_level.toUpperCase()} • {incident.state}
              </Text>
              <Text style={styles.historyText}>{incident.explainable_reason}</Text>
              <Text style={styles.historyMeta}>
                {incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Unknown time'}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  title: { color: '#FFF', fontSize: 28, fontWeight: 'bold', paddingTop: 40, marginBottom: 5 },
  subtitle: { color: '#A0A0A0', fontSize: 14, marginBottom: 30 },
  card: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 12, marginBottom: 20 },
  label: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  input: { backgroundColor: '#2C2C2C', color: '#FFF', borderRadius: 8, padding: 15, fontSize: 16, marginBottom: 12 },
  hint: { color: '#888', fontSize: 12, marginTop: 4, lineHeight: 18 },
  saveButton: { backgroundColor: '#FF9800', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 10, marginBottom: 20 },
  saveButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  inlineButton: { backgroundColor: '#2D6CDF', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  inlineButtonText: { color: '#FFF', fontWeight: '700' },
  contactRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  contactName: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  contactPhone: { color: '#AAA', fontSize: 13, marginTop: 2 },
  removeText: { color: '#FF6B6B', fontWeight: '700' },
  historyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  historyTitle: { color: '#FFF', fontWeight: '700', marginBottom: 4 },
  historyText: { color: '#B5B5B5', fontSize: 13, lineHeight: 18 },
  historyMeta: { color: '#777', fontSize: 12, marginTop: 4 }
});

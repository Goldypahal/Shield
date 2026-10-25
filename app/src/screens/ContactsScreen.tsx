import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Modal,
  Alert as RNAlert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import BottomNavigation, { TabKey } from '../components/common/BottomNavigation';
import ContactService from '../services/contactService';
import { EmergencyContact } from '../types';

interface ContactsScreenProps {
  onBack?: () => void;
  activeTab?: TabKey;
  onTabPress?: (tab: TabKey) => void;
}

export default function ContactsScreen({
  onBack,
  activeTab = 'Contacts',
  onTabPress,
}: ContactsScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const list = await ContactService.listContacts();
      if (list && list.length > 0) {
        setContacts(list);
      } else {
        const defaults: EmergencyContact[] = [
          { id: 'c1', name: 'Parent / Guardian', phone: '+1 (555) 019-2834' },
          { id: 'c2', name: 'Campus Safety Dispatch', phone: '+1 (555) 911-0022' },
          { id: 'c3', name: 'Roommate / Trusted Friend', phone: '+1 (555) 438-9901' },
        ];
        setContacts(defaults);
      }
    } catch (_) {}
  };

  const handleAddContact = async () => {
    if (!name.trim() || !phone.trim()) {
      RNAlert.alert('Missing Info', 'Please provide both contact name and phone number.');
      return;
    }

    try {
      const newContact = await ContactService.saveContact({
        name: name.trim(),
        phone: phone.trim(),
      });
      setContacts((prev) => [...prev, newContact]);
      setName('');
      setPhone('');
      setAddModalVisible(false);
      RNAlert.alert('Contact Added', `${newContact.name} will receive alerts if SOS is triggered.`);
    } catch (_) {
      const fallback: EmergencyContact = {
        id: `local-${Date.now()}`,
        name: name.trim(),
        phone: phone.trim(),
      };
      setContacts((prev) => [...prev, fallback]);
      setName('');
      setPhone('');
      setAddModalVisible(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <AppHeader
        title="Trusted Contacts"
        showBack={!!onBack}
        onBack={onBack}
        rightIcon="add"
        onRightPress={() => setAddModalVisible(true)}
        rightAccessibilityLabel="Add new trusted contact"
      />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[typography.bodySmall, styles.sectionIntro, { color: colors.textSecondary }]}>
          These contacts are automatically notified with your GPS coordinates and incident audio during an emergency SOS.
        </Text>

        {contacts.map((contact, index) => (
          <View
            key={contact.id || index}
            style={[
              styles.contactCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.lg,
              },
            ]}
          >
            <View style={[styles.contactAvatar, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="person" size={20} color={colors.brandAccent} />
            </View>

            <View style={styles.contactDetails}>
              <Text style={[typography.h4, { color: colors.textPrimary }]}>
                {contact.name}
              </Text>
              <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
                {contact.phone}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.callBtn, { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => RNAlert.alert('Contact Action', `Ready to call or ping ${contact.name}.`)}
              accessibilityRole="button"
              accessibilityLabel={`Call ${contact.name}`}
            >
              <Ionicons name="call-outline" size={18} color={colors.brandAccent} />
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[
            styles.addCardButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.lg,
            },
          ]}
          onPress={() => setAddModalVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.brandAccent} />
          <Text style={[typography.button, { color: colors.brandAccent, marginLeft: 8 }]}>
            Add Emergency Contact
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setAddModalVisible(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <View style={styles.modalHeader}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>Add Contact</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border }]}
              placeholder="Full Name (e.g. Jordan Smith)"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />

            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border, marginTop: 12 }]}
              placeholder="Phone Number (e.g. +1 555-0199)"
              placeholderTextColor={colors.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.brandAccent }]}
              onPress={handleAddContact}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>Save Contact</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {onTabPress && (
        <BottomNavigation activeTab={activeTab} onTabPress={onTabPress} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionIntro: {
    marginHorizontal: 20,
    marginBottom: 16,
    lineHeight: 18,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  contactDetails: {
    flex: 1,
  },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addCardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginHorizontal: 20,
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  saveBtn: {
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
});

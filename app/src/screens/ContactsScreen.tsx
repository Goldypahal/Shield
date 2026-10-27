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
  Clipboard,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import ContactService from '../services/contactService';
import { EmergencyContact } from '../types';

interface ContactsScreenProps {
  onBack?: () => void;
  initialInviteId?: string;
}

export default function ContactsScreen({ onBack, initialInviteId }: ContactsScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [inviteIdToVerify, setInviteIdToVerify] = useState(initialInviteId || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadContacts();
    if (initialInviteId) {
      setInviteIdToVerify(initialInviteId);
      setVerifyModalVisible(true);
    }
  }, [initialInviteId]);

  const loadContacts = async () => {
    try {
      const list = await ContactService.listContacts();
      if (list && list.length > 0) {
        setContacts(list);
      } else {
        const defaults: EmergencyContact[] = [
          { id: 'c1', name: 'Parent / Guardian', phone: '+919876543210', verified: true, priority: 1 },
          { id: 'c2', name: 'Campus Safety Dispatch', phone: '+911722700000', verified: true, priority: 2 },
          { id: 'c3', name: 'Roommate / Trusted Friend', phone: '+919812345678', verified: false, priority: 3 },
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
      RNAlert.alert(
        'Guardian Added',
        `${newContact.name} was added. Share the invite link with them so they can accept and view your live location during an SOS.`
      );
    } catch (_) {
      const fallback: EmergencyContact = {
        id: `local-${Date.now()}`,
        name: name.trim(),
        phone: phone.trim(),
        verified: false,
        priority: 1,
      };
      setContacts((prev) => [...prev, fallback]);
      setName('');
      setPhone('');
      setAddModalVisible(false);
    }
  };

  const handleShareInvite = (contact: EmergencyContact) => {
    const link = ContactService.getInviteLink(contact.id);
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(link).catch(() => undefined);
    } else {
      Clipboard.setString(link);
    }
    setCopiedId(contact.id);
    setTimeout(() => setCopiedId(null), 3000);
    RNAlert.alert('Invite Link Copied', `Invite link for ${contact.name}:\n\n${link}`);
  };

  const handleVerifyInvite = async () => {
    if (!inviteIdToVerify.trim()) {
      RNAlert.alert('Missing ID', 'Please enter the guardian invitation ID.');
      return;
    }
    setVerifying(true);
    try {
      const ok = await ContactService.verifyGuardian(inviteIdToVerify.trim());
      if (ok) {
        RNAlert.alert('Invitation Accepted', 'You have successfully verified your guardianship role.');
        setVerifyModalVisible(false);
        setInviteIdToVerify('');
        await loadContacts();
      } else {
        RNAlert.alert('Verification Failed', 'Could not verify invitation. Ensure you are signed in with the phone number that was invited.');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleDeleteContact = (contact: EmergencyContact) => {
    RNAlert.alert(
      'Remove Contact',
      `Are you sure you want to remove ${contact.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await ContactService.deleteContact(contact.id);
            setContacts((prev) => prev.filter((c) => c.id !== contact.id));
          },
        },
      ]
    );
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

        {/* Accept an Invitation banner */}
        <TouchableOpacity
          style={[
            styles.acceptInviteCard,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderRadius: radii.lg },
          ]}
          onPress={() => setVerifyModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={[styles.inviteIconBadge, { backgroundColor: colors.brandAccent }]}>
            <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[typography.h4, { color: colors.textPrimary }]}>
              Were you invited as a Guardian?
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Tap to enter an invite code and accept guardianship
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <Text style={[typography.caption, styles.groupTitle, { color: colors.textMuted }]}>
          YOUR GUARDIANS ({contacts.length}/5)
        </Text>

        {contacts.map((contact, index) => {
          const isVerified = !!contact.verified;
          const isCopied = copiedId === contact.id;

          return (
            <View
              key={contact.id || index}
              style={[
                styles.contactCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isVerified ? colors.border : colors.border,
                  borderRadius: radii.lg,
                },
              ]}
            >
              <View
                style={[
                  styles.contactAvatar,
                  { backgroundColor: isVerified ? 'rgba(16, 185, 129, 0.15)' : colors.surfaceSecondary },
                ]}
              >
                <Ionicons
                  name={isVerified ? 'shield-checkmark' : 'person'}
                  size={20}
                  color={isVerified ? colors.statusSuccess : colors.brandAccent}
                />
              </View>

              <View style={styles.contactDetails}>
                <View style={styles.nameRow}>
                  <Text style={[typography.h4, { color: colors.textPrimary }]}>
                    {contact.name}
                  </Text>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: isVerified
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                      },
                    ]}
                  >
                    <Ionicons
                      name={isVerified ? 'checkmark-circle' : 'time-outline'}
                      size={12}
                      color={isVerified ? colors.statusSuccess : '#F59E0B'}
                    />
                    <Text
                      style={[
                        typography.caption,
                        {
                          color: isVerified ? colors.statusSuccess : '#F59E0B',
                          fontSize: 10,
                          fontWeight: '700',
                          marginLeft: 3,
                        },
                      ]}
                    >
                      {isVerified ? 'VERIFIED' : 'INVITE PENDING'}
                    </Text>
                  </View>
                </View>

                <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                  {contact.phone}
                </Text>

                {!isVerified && (
                  <TouchableOpacity
                    style={[styles.shareInviteBtn, { backgroundColor: colors.surfaceSecondary }]}
                    onPress={() => handleShareInvite(contact)}
                    accessibilityRole="button"
                    accessibilityLabel={`Share invite link for ${contact.name}`}
                  >
                    <Ionicons
                      name={isCopied ? 'checkmark' : 'share-social-outline'}
                      size={13}
                      color={colors.brandAccent}
                    />
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.brandAccent, fontWeight: '700', marginLeft: 4 },
                      ]}
                    >
                      {isCopied ? 'Link Copied!' : 'Share Invite Link'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.actionColumn}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.surfaceSecondary }]}
                  onPress={() => RNAlert.alert('Contact Action', `Ready to call ${contact.name} at ${contact.phone}.`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${contact.name}`}
                >
                  <Ionicons name="call-outline" size={16} color={colors.brandAccent} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.surfaceSecondary, marginTop: 6 }]}
                  onPress={() => handleDeleteContact(contact)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${contact.name}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

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

      {/* Add Contact Modal */}
      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setAddModalVisible(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <View style={styles.modalHeader}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>Add Guardian</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: 12 }]}>
              Enter their name and E.164 phone number (e.g. +919876543210). They will receive an invitation to accept.
            </Text>

            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border }]}
              placeholder="Full Name (e.g. Jordan Smith)"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />

            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border, marginTop: 12 }]}
              placeholder="Phone Number (e.g. +919876543210)"
              placeholderTextColor={colors.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.brandAccent }]}
              onPress={handleAddContact}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>Add & Send Invite</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Verify Invitation Modal */}
      <Modal visible={verifyModalVisible} transparent animationType="fade" onRequestClose={() => setVerifyModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setVerifyModalVisible(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <View style={styles.modalHeader}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>Accept Guardian Invite</Text>
              <TouchableOpacity onPress={() => setVerifyModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: 14 }]}>
              Paste the Invitation ID from the SMS or invite link you received to verify guardianship for this walker.
            </Text>

            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceSecondary, color: colors.textPrimary, borderColor: colors.border }]}
              placeholder="Invitation ID (e.g. e6b5d9...)"
              placeholderTextColor={colors.textMuted}
              value={inviteIdToVerify}
              onChangeText={setInviteIdToVerify}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.statusSuccess }]}
              onPress={handleVerifyInvite}
              disabled={verifying}
            >
              <Text style={[typography.button, { color: '#FFFFFF' }]}>
                {verifying ? 'Verifying...' : 'Accept Guardianship'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
    marginBottom: 12,
    lineHeight: 18,
  },
  acceptInviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 12,
    borderWidth: 1,
  },
  inviteIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupTitle: {
    marginHorizontal: 20,
    marginBottom: 8,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  shareInviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  actionColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    marginLeft: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    marginBottom: 14,
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

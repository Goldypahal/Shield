import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';

interface ShareJourneyModalProps {
  visible: boolean;
  onClose: () => void;
  onShowToast: (message: string) => void;
}

interface GuardianToggle {
  id: string;
  name: string;
  phone: string;
  enabled: boolean;
}

export default function ShareJourneyModal({ visible, onClose, onShowToast }: ShareJourneyModalProps) {
  const trackingLink = 'https://heimdal.app/t/ch-9481a';
  const [guardians, setGuardians] = useState<GuardianToggle[]>([
    { id: '1', name: 'Aarav Sharma', phone: '+91 98765 43210', enabled: true },
    { id: '2', name: 'Simran Kaur', phone: '+91 98123 45678', enabled: true },
    { id: '3', name: 'Papa', phone: '+91 99887 76655', enabled: false },
  ]);

  const handleCopyLink = () => {
    onShowToast('Tracking link copied to clipboard!');
  };

  const toggleGuardian = (id: string) => {
    setGuardians((prev) =>
      prev.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g))
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />

          <View style={styles.header}>
            <Text style={styles.title}>Share Live Journey</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={TOKENS.colors.ink[600]} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtext}>
            Trusted contacts will be able to follow your progress in real-time until you arrive safely.
          </Text>

          {/* Share Link Row */}
          <View style={styles.linkContainer}>
            <Ionicons name="link-outline" size={18} color={TOKENS.colors.ink[400]} />
            <Text style={styles.linkText} numberOfLines={1}>
              {trackingLink}
            </Text>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopyLink}>
              <Text style={styles.copyBtnText}>Copy Link</Text>
            </TouchableOpacity>
          </View>

          {/* Trusted Contacts Toggles */}
          <Text style={styles.sectionTitle}>Alert Guardians</Text>
          <View style={styles.guardiansList}>
            {guardians.map((g) => (
              <View key={g.id} style={styles.guardianRow}>
                <View style={styles.guardianAvatar}>
                  <Text style={styles.avatarInitial}>{g.name.charAt(0)}</Text>
                </View>
                <View style={styles.guardianInfo}>
                  <Text style={styles.guardianName}>{g.name}</Text>
                  <Text style={styles.guardianPhone}>{g.phone}</Text>
                </View>
                <Switch
                  value={g.enabled}
                  onValueChange={() => toggleGuardian(g.id)}
                  trackColor={{ false: '#E5E7EB', true: TOKENS.colors.brand.orange }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => {
              onShowToast('Journey sharing active with selected guardians');
              onClose();
            }}
          >
            <Text style={styles.doneBtnText}>Confirm & Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
  },
  subtext: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
    lineHeight: 18,
    marginBottom: 16,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 20,
  },
  linkText: {
    flex: 1,
    fontSize: 13,
    color: TOKENS.colors.ink[900],
    marginLeft: 8,
  },
  copyBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
    marginBottom: 10,
  },
  guardiansList: {
    gap: 12,
    marginBottom: 20,
  },
  guardianRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  guardianAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FED7AA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C2410C',
  },
  guardianInfo: {
    flex: 1,
    marginLeft: 10,
  },
  guardianName: {
    fontSize: 14,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
  },
  guardianPhone: {
    fontSize: 11,
    color: TOKENS.colors.ink[400],
  },
  doneBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    borderRadius: 14,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

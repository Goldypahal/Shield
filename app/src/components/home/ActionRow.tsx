import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import SosButton from './SosButton';
import ShareJourneyModal from './ShareJourneyModal';
import AddContactModal from './AddContactModal';

interface ActionRowProps {
  onShowToast: (message: string) => void;
}

export default function ActionRow({ onShowToast }: ActionRowProps) {
  const { addStop, stops } = useJourneyStore();
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [addContactVisible, setAddContactVisible] = useState(false);

  const [contactAvatars, setContactAvatars] = useState([
    { id: '1', initials: 'AS', bg: '#FED7AA', color: '#9A3412' },
    { id: '2', initials: 'SK', bg: '#BBF7D0', color: '#166534' },
    { id: '3', initials: 'P', bg: '#FFE0D1', color: '#C2410C' },
  ]);

  const handleAddStopPress = () => {
    if (stops.length >= 3) {
      onShowToast('Maximum 3 stops allowed');
      return;
    }
    const sampleStops = [
      { label: 'Stop 1: Sector 70 Light Point', lat: 30.7088, lng: 76.7092 },
      { label: 'Stop 2: Mohali Phase 7 Market', lat: 30.7225, lng: 76.6890 },
      { label: 'Stop 3: Landran Chowk', lat: 30.6934, lng: 76.6651 },
    ];
    const newStop = sampleStops[stops.length] || {
      label: `Stop ${stops.length + 1}: Custom Waypoint`,
      lat: 30.7100,
      lng: 76.6800,
    };
    addStop(newStop);
    onShowToast(`Added ${newStop.label}`);
  };

  const handleAddNewContact = (c: { name: string; phone: string }) => {
    const initials = c.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
    setContactAvatars((prev) => [
      ...prev,
      { id: Date.now().toString(), initials, bg: '#FDE68A', color: '#92400E' },
    ]);
    onShowToast(`Added ${c.name} as trusted contact`);
  };

  return (
    <View style={styles.container}>
      {/* Left Column: Share Journey & Avatar Stack */}
      <View style={styles.leftCol}>
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={() => setShareModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Share journey with trusted contacts"
          activeOpacity={0.75}
        >
          <Ionicons name="share-social-outline" size={16} color={TOKENS.colors.brand.orange} />
          <Text style={styles.shareBtnText}>Share Journey</Text>
        </TouchableOpacity>

        {/* Avatar Stack */}
        <View style={styles.avatarStack}>
          {contactAvatars.slice(0, 3).map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.avatarCircle,
                {
                  backgroundColor: item.bg,
                  marginLeft: index === 0 ? 0 : -8,
                  zIndex: 10 - index,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: item.color }]}>{item.initials}</Text>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addContactBtn}
            onPress={() => setAddContactVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Add trusted contact"
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={16} color={TOKENS.colors.ink[600]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Center Column: Prominent Pulsing SOS Button */}
      <View style={styles.centerCol}>
        <SosButton onShowToast={onShowToast} />
      </View>

      {/* Right Column: Add Stop Button */}
      <View style={styles.rightCol}>
        <TouchableOpacity
          style={styles.addStopBtn}
          onPress={handleAddStopPress}
          accessibilityRole="button"
          accessibilityLabel="Add route stop"
          activeOpacity={0.75}
        >
          <Ionicons name="add-circle" size={18} color={TOKENS.colors.brand.orange} />
          <Text style={styles.addStopBtnText}>Add Stop</Text>
        </TouchableOpacity>
      </View>

      {/* Modals */}
      <ShareJourneyModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        onShowToast={onShowToast}
      />

      <AddContactModal
        visible={addContactVisible}
        onClose={() => setAddContactVisible(false)}
        onAddContact={handleAddNewContact}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
  },
  leftCol: {
    flex: 1,
    alignItems: 'flex-start',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: TOKENS.colors.brand.orange,
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  shareBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.brand.orange,
    marginLeft: 6,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 2,
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 10,
    fontWeight: '700',
  },
  addContactBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
    zIndex: 1,
  },
  centerCol: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28, // Overlaps upward ~28px over RoutePanel edge
    zIndex: 25,
  },
  rightCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  addStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: TOKENS.colors.brand.orange,
    backgroundColor: '#FFFFFF',
  },
  addStopBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
    marginLeft: 6,
  },
});

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';

interface HeimdalHeaderProps {
  onProfilePress?: () => void;
}

export default function HeimdalHeader({ onProfilePress }: HeimdalHeaderProps) {
  const { unreadNotifications, markNotificationsRead } = useJourneyStore();
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = [
    {
      id: '1',
      title: 'Route updated',
      desc: 'New incident reported near Sector 79',
      time: '5m ago',
      icon: 'warning' as const,
      color: TOKENS.colors.moderate.amber,
    },
    {
      id: '2',
      title: 'Journey Viewed',
      desc: 'Your trusted contact Sarah viewed your journey',
      time: '12m ago',
      icon: 'eye' as const,
      color: TOKENS.colors.brand.orange,
    },
  ];

  return (
    <View style={styles.container}>
      {/* Left: Heimdal Logo Tile & Title */}
      <View style={styles.leftGroup}>
        <View style={styles.logoTile}>
          <Image
            source={require('../../../assets/images/heimdal_logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="HEIMDAL Logo"
          />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.brandTitle}>HEIMDAL</Text>
          <Text style={styles.tagline}>Safer journeys for everyone.</Text>
        </View>
      </View>

      {/* Right: Notification Bell & Profile Buttons */}
      <View style={styles.rightGroup}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => {
            setShowNotifications(true);
            markNotificationsRead();
          }}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={22} color={TOKENS.colors.ink[900]} />
          {unreadNotifications > 0 && <View style={styles.dotBadge} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, { marginLeft: 8 }]}
          onPress={onProfilePress}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          activeOpacity={0.7}
        >
          <Ionicons name="person" size={20} color={TOKENS.colors.ink[900]} />
        </TouchableOpacity>
      </View>

      {/* Notifications Dropdown Modal */}
      <Modal
        visible={showNotifications}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNotifications(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowNotifications(false)}>
          <View style={styles.dropdownCard}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setShowNotifications(false)}>
                <Ionicons name="close" size={20} color={TOKENS.colors.ink[600]} />
              </TouchableOpacity>
            </View>

            {notifications.map((item) => (
              <View key={item.id} style={styles.notificationItem}>
                <View style={[styles.notificationIcon, { backgroundColor: item.color + '20' }]}>
                  <Ionicons name={item.icon} size={18} color={item.color} />
                </View>
                <View style={styles.notificationText}>
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  <Text style={styles.notifDesc}>{item.desc}</Text>
                  <Text style={styles.notifTime}>{item.time}</Text>
                </View>
              </View>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: TOKENS.colors.surface.bg,
    zIndex: 10,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    padding: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  titleBlock: {
    marginLeft: 10,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2.5,
    color: TOKENS.colors.ink[900],
    fontFamily: 'System',
  },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.brand.orange,
    marginTop: -1,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dotBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TOKENS.colors.brand.orange,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 70,
    paddingRight: 16,
  },
  dropdownCard: {
    width: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
  },
  notificationItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  notificationIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationText: {
    marginLeft: 10,
    flex: 1,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
  },
  notifDesc: {
    fontSize: 11,
    color: TOKENS.colors.ink[600],
    marginTop: 2,
  },
  notifTime: {
    fontSize: 10,
    color: TOKENS.colors.ink[400],
    marginTop: 3,
  },
});

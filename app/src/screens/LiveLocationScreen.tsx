import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Alert as RNAlert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import MapPlaceholder from '../components/map/MapPlaceholder';
import ContactService from '../services/contactService';

interface LiveLocationScreenProps {
  onBack: () => void;
  onNavigateToContacts?: () => void;
}

export default function LiveLocationScreen({
  onBack,
  onNavigateToContacts,
}: LiveLocationScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();
  const [isSharing, setIsSharing] = useState(true);
  const [contactCount, setContactCount] = useState(3);
  const [accuracy, setAccuracy] = useState(8);

  useEffect(() => {
    async function loadContacts() {
      try {
        const list = await ContactService.listContacts();
        if (list && list.length > 0) {
          setContactCount(list.length);
        }
      } catch (_) {}
    }
    loadContacts();
  }, []);

  const handleToggleSharing = () => {
    const nextState = !isSharing;
    setIsSharing(nextState);
    if (!nextState) {
      RNAlert.alert('Location Sharing Stopped', 'Your live coordinates are no longer broadcast.');
    } else {
      RNAlert.alert('Location Sharing Active', `Broadcasting encrypted location to ${contactCount} trusted contacts.`);
    }
  };

  const handleRecenter = () => {
    setAccuracy(Math.floor(Math.random() * 3) + 7);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <AppHeader
        title="Live Location"
        showBack
        onBack={onBack}
        rightIcon="people-outline"
        onRightPress={onNavigateToContacts || onBack}
        rightAccessibilityLabel="Manage trusted contacts"
      />

      <View style={styles.mapContainer}>
        <MapPlaceholder
          mode="location"
          accuracyMeters={accuracy}
          onRecenter={handleRecenter}
          style={styles.map}
        />
      </View>

      <View
        style={[
          styles.bottomCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.xl,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.sharingInfoRow}
          onPress={onNavigateToContacts}
          activeOpacity={0.7}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.brandAccent }]}>
            <Ionicons name="location" size={20} color="#FFFFFF" />
          </View>

          <View style={styles.sharingTextContainer}>
            <Text style={[typography.h4, { color: colors.textPrimary }]}>
              Location sharing
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              {isSharing
                ? `Sharing with ${contactCount} trusted contacts`
                : 'Sharing is currently paused'}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleToggleSharing}
          activeOpacity={0.8}
          style={[
            styles.actionButton,
            {
              backgroundColor: isSharing ? colors.surface : colors.brandAccent,
              borderColor: isSharing ? colors.border : colors.brandAccent,
              borderRadius: radii.pill,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isSharing ? 'Stop sharing live location' : 'Start sharing live location'}
        >
          <Text
            style={[
              typography.button,
              {
                color: isSharing ? colors.textPrimary : '#FFFFFF',
              },
            ]}
          >
            {isSharing ? 'Stop sharing' : 'Start sharing'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
  },
  map: {
    flex: 1,
    height: '100%',
  },
  bottomCard: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  sharingInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  sharingTextContainer: {
    flex: 1,
  },
  actionButton: {
    width: '100%',
    paddingVertical: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

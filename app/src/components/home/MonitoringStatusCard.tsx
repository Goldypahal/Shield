import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface MonitoringStatusCardProps {
  isActive?: boolean;
  onPress?: () => void;
}

export default function MonitoringStatusCard({
  isActive = true,
  onPress,
}: MonitoringStatusCardProps) {
  const { colors, typography, radii } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.lg,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Monitoring status details"
    >
      <View
        style={[
          styles.badge,
          {
            backgroundColor: isActive ? colors.statusSuccessBg : colors.surfaceSecondary,
            borderColor: isActive ? colors.statusSuccessBorder : colors.border,
          },
        ]}
      >
        <Ionicons
          name={isActive ? 'shield-checkmark' : 'shield-outline'}
          size={20}
          color={isActive ? colors.statusSuccess : colors.textMuted}
        />
      </View>

      <View style={styles.textContainer}>
        <Text style={[typography.h4, { color: colors.textPrimary }]}>
          {isActive ? "You're safe" : 'Monitoring Standby'}
        </Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isActive ? colors.statusSuccess : colors.textMuted },
            ]}
          />
          <Text
            style={[
              typography.caption,
              { color: isActive ? colors.statusSuccessText : colors.textSecondary },
            ]}
          >
            {isActive ? 'Monitoring is active' : 'Sensors in background standby'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface SafetyToolCardProps {
  title: string;
  description: string;
  iconName: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accentColor?: string;
  /** Small corner label, e.g. "Coming soon"; the card is shown muted. */
  badge?: string;
}

export default function SafetyToolCard({
  title,
  description,
  iconName,
  onPress,
  accentColor,
  badge,
}: SafetyToolCardProps) {
  const { colors, typography, radii } = useTheme();
  const iconColor = badge ? colors.textMuted : accentColor || colors.brandAccent;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.lg,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${badge ? ` (${badge})` : ''}. ${description}`}
    >
      {badge && (
        <View style={[styles.badge, { backgroundColor: colors.statusWarningBg }]}>
          <Text style={[styles.badgeText, { color: colors.statusWarning }]}>{badge}</Text>
        </View>
      )}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: colors.surfaceSecondary,
          },
        ]}
      >
        <Ionicons name={iconName} size={22} color={iconColor} />
      </View>

      <Text
        style={[
          typography.h4,
          styles.title,
          {
            color: colors.textPrimary,
          },
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>

      <Text
        style={[
          typography.bodySmall,
          styles.description,
          {
            color: colors.textSecondary,
          },
        ]}
        numberOfLines={2}
      >
        {description}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
    borderWidth: 1,
    minHeight: 120,
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  description: {
    fontSize: 11,
    lineHeight: 15,
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});

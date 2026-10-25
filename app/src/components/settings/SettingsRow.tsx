import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface SettingsRowProps {
  iconName: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  rightElement?: React.ReactNode;
  disabled?: boolean;
}

export default function SettingsRow({
  iconName,
  title,
  subtitle,
  onPress,
  rightElement,
  disabled = false,
}: SettingsRowProps) {
  const { colors, typography, radii } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.lg,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`}
    >
      <View
        style={[
          styles.iconBox,
          {
            backgroundColor: colors.surfaceSecondary,
          },
        ]}
      >
        <Ionicons name={iconName} size={20} color={colors.textPrimary} />
      </View>

      <View style={styles.textContainer}>
        <Text style={[typography.h4, styles.title, { color: colors.textPrimary }]}>
          {title}
        </Text>
        {subtitle && (
          <Text
            style={[
              typography.bodySmall,
              styles.subtitle,
              { color: colors.textSecondary },
            ]}
          >
            {subtitle}
          </Text>
        )}
      </View>

      {rightElement || (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
});

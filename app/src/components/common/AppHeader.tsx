import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  rightAccessibilityLabel?: string;
}

export default function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightIcon,
  onRightPress,
  rightAccessibilityLabel,
}: AppHeaderProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.leftContainer}>
        {showBack && (
          <TouchableOpacity
            onPress={onBack}
            style={[styles.iconButton, { marginRight: spacing.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        {subtitle && (
          <View>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{subtitle}</Text>
            {title && (
              <Text style={[typography.h2, { color: colors.textPrimary, fontWeight: '700' }]}>
                {title}
              </Text>
            )}
          </View>
        )}
        {!subtitle && title && (
          <Text style={[typography.h3, { color: colors.textPrimary, fontWeight: '600' }]}>
            {title}
          </Text>
        )}
      </View>

      <View style={styles.rightContainer}>
        {rightIcon && onRightPress && (
          <TouchableOpacity
            onPress={onRightPress}
            style={[styles.iconButton, { backgroundColor: colors.surfaceSecondary }]}
            accessibilityRole="button"
            accessibilityLabel={rightAccessibilityLabel || 'Action button'}
            activeOpacity={0.7}
          >
            <Ionicons name={rightIcon} size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 20) + 8 : 12,
    paddingBottom: 12,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

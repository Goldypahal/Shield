import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { RouteItem } from '../../data/mockRoutes';

interface RouteCardProps {
  route: RouteItem;
  isSelected: boolean;
  onSelect: () => void;
}

export default function RouteCard({ route, isSelected, onSelect }: RouteCardProps) {
  const isSafer = route.id === 'safer';
  const isModerate = route.id === 'moderate';

  const colorConfig = isSafer
    ? {
        border: TOKENS.colors.safe.green,
        bgTint: TOKENS.colors.safe.tint,
        badgeText: TOKENS.colors.safe.dark,
        iconBg: '#DCFCE7',
        iconName: 'shield-checkmark' as const,
        iconColor: TOKENS.colors.safe.green,
      }
    : isModerate
    ? {
        border: TOKENS.colors.moderate.amber,
        bgTint: TOKENS.colors.moderate.tint,
        badgeText: TOKENS.colors.moderate.dark,
        iconBg: '#FEF3C7',
        iconName: 'navigate' as const,
        iconColor: TOKENS.colors.moderate.amber,
      }
    : {
        border: '#FF5A1F',
        bgTint: '#FFF6F1',
        badgeText: '#C2410C',
        iconBg: '#FFE8DC',
        iconName: 'flash' as const,
        iconColor: '#FF5A1F',
      };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          borderColor: isSelected ? colorConfig.border : '#E5E7EB',
          borderWidth: isSelected ? 2 : 1,
          backgroundColor: isSelected ? colorConfig.bgTint : '#FFFFFF',
          transform: [{ translateY: isSelected ? -2 : 0 }],
        },
      ]}
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${route.title}, ${route.minutes} minutes`}
      activeOpacity={0.85}
    >
      {/* Top: Icon in circle + Route Label */}
      <View style={styles.topRow}>
        <View style={[styles.avatarCircle, { backgroundColor: colorConfig.iconBg }]}>
          <Ionicons name={colorConfig.iconName} size={15} color={colorConfig.iconColor} />
        </View>
        <Text style={[styles.headerTag, { color: colorConfig.badgeText }]} numberOfLines={1}>
          {isSafer ? 'Safer' : isModerate ? 'Alternative' : 'Shortest'}
        </Text>
      </View>

      {/* Middle: Big Time ("24 min") + Road Summary */}
      <View style={styles.timeSection}>
        <Text style={styles.timeText}>{route.minutes} min</Text>
        <Text style={[styles.labelText, { color: TOKENS.colors.ink[900] }]} numberOfLines={1}>
          {route.title}
        </Text>
        <Text style={styles.distSubtext}>{route.distanceKm} km</Text>
      </View>

      {/* Verified Attributes List (Zero fake cases!) */}
      <View style={styles.bulletsList}>
        {route.badges.map((badge, idx) => (
          <View key={idx} style={styles.bulletItem}>
            <Ionicons
              name="checkmark-circle"
              size={13}
              color={TOKENS.colors.safe.green}
              style={styles.bulletIcon}
            />
            <Text style={styles.bulletText} numberOfLines={1}>
              {badge.text}
            </Text>
          </View>
        ))}
      </View>

      {/* Recommended Footer Badge (Safer only) */}
      {isSafer && (
        <View style={styles.recommendedBadge}>
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
          <Text style={styles.recommendedText}>Recommended</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 10,
    minHeight: 184,
    justifyContent: 'space-between',
    shadowColor: '#1F2937',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  avatarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTag: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timeSection: {
    marginBottom: 6,
  },
  timeText: {
    fontSize: 18,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
    letterSpacing: -0.3,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  distSubtext: {
    fontSize: 10,
    color: TOKENS.colors.ink[400],
    marginTop: 1,
  },
  bulletsList: {
    gap: 4,
    flex: 1,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bulletIcon: {
    marginRight: 4,
  },
  bulletText: {
    fontSize: 10,
    fontWeight: '500',
    color: TOKENS.colors.ink[600],
    flex: 1,
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.colors.safe.green,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
  },
  recommendedText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 3,
  },
});

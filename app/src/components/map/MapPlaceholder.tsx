import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Svg, { Rect, Path, Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface MapPlaceholderProps {
  mode: 'location' | 'route';
  accuracyMeters?: number;
  onRecenter?: () => void;
  style?: any;
}

export default function MapPlaceholder({
  mode,
  accuracyMeters = 8,
  onRecenter,
  style,
}: MapPlaceholderProps) {
  const { colors, isDark } = useTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const landColor = isDark ? '#0F1829' : '#F1F5F9';
  const blockColor = isDark ? '#142136' : '#E2E8F0';
  const roadColor = isDark ? '#1B2A44' : '#FFFFFF';
  const parkColor = isDark ? '#142B28' : '#DCFCE7';

  return (
    <View style={[styles.container, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 360" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="pulseGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colors.brandAccent} stopOpacity={isDark ? "0.35" : "0.25"} />
            <Stop offset="100%" stopColor={colors.brandAccent} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="360" fill={landColor} />

        <Rect x="20" y="20" width="80" height="60" rx="4" fill={blockColor} />
        <Rect x="120" y="15" width="100" height="70" rx="4" fill={blockColor} />
        <Rect x="240" y="25" width="140" height="55" rx="4" fill={parkColor} opacity={0.6} />

        <Rect x="15" y="100" width="90" height="80" rx="4" fill={blockColor} />
        <Rect x="125" y="105" width="85" height="70" rx="4" fill={blockColor} />
        <Rect x="230" y="100" width="90" height="75" rx="4" fill={blockColor} />
        <Rect x="340" y="105" width="50" height="70" rx="4" fill={blockColor} />

        <Rect x="25" y="200" width="80" height="70" rx="4" fill={parkColor} opacity={0.6} />
        <Rect x="125" y="195" width="90" height="85" rx="4" fill={blockColor} />
        <Rect x="235" y="195" width="80" height="80" rx="4" fill={blockColor} />
        <Rect x="335" y="195" width="55" height="80" rx="4" fill={blockColor} />

        <Rect x="15" y="295" width="95" height="55" rx="4" fill={blockColor} />
        <Rect x="130" y="300" width="85" height="50" rx="4" fill={blockColor} />
        <Rect x="235" y="295" width="155" height="55" rx="4" fill={blockColor} />

        <Path d="M 0 90 L 400 90" stroke={roadColor} strokeWidth="12" />
        <Path d="M 0 185 L 400 185" stroke={roadColor} strokeWidth="14" />
        <Path d="M 0 285 L 400 285" stroke={roadColor} strokeWidth="12" />

        <Path d="M 115 0 L 115 360" stroke={roadColor} strokeWidth="14" />
        <Path d="M 225 0 L 225 360" stroke={roadColor} strokeWidth="14" />
        <Path d="M 330 0 L 330 360" stroke={roadColor} strokeWidth="12" />

        <Path d="M 40 360 L 320 0" stroke={roadColor} strokeWidth="10" opacity={0.8} />

        {mode === 'route' && (
          <>
            <Path
              d="M 115 110 L 175 140 L 225 185 L 225 240 L 330 240"
              stroke={colors.brandAccent}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.35}
            />
            <Path
              d="M 115 110 L 175 140 L 225 185 L 225 240 L 330 240"
              stroke={colors.brandAccent}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx="115" cy="110" r="14" fill={colors.mapAccuracyFill} />
            <Circle cx="115" cy="110" r="7" fill={colors.brandAccent} stroke="#FFFFFF" strokeWidth="2.5" />
            <Circle cx="330" cy="240" r="8" fill={colors.sosPrimary} stroke="#FFFFFF" strokeWidth="2.5" />
          </>
        )}

        {mode === 'location' && (
          <>
            <Circle
              cx="200"
              cy="185"
              r="48"
              fill={colors.mapAccuracyFill}
              stroke={colors.mapAccuracyBorder}
              strokeWidth="1.5"
            />
            <Circle
              cx="200"
              cy="185"
              r="10"
              fill={colors.brandAccent}
              stroke="#FFFFFF"
              strokeWidth="3"
            />
          </>
        )}
      </Svg>

      {mode === 'location' && (
        <View
          style={[
            styles.floatingLocationBadge,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.badgePinIcon, { backgroundColor: colors.brandAccent }]}>
            <Ionicons name="location" size={12} color="#FFFFFF" />
          </View>
          <View>
            <Text style={[styles.badgeTitle, { color: colors.textPrimary }]}>Your location</Text>
            <Text style={[styles.badgeAccuracy, { color: colors.textSecondary }]}>
              Accuracy: {accuracyMeters} m
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={onRecenter}
        style={[
          styles.recenterButton,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Recenter map"
        activeOpacity={0.8}
      >
        <Ionicons name="locate" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: 360,
  },
  floatingLocationBadge: {
    position: 'absolute',
    top: 50,
    left: '50%',
    transform: [{ translateX: -75 }],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  badgePinIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  badgeTitle: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  badgeAccuracy: {
    fontSize: 10,
    lineHeight: 12,
  },
  recenterButton: {
    position: 'absolute',
    right: 18,
    bottom: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
});

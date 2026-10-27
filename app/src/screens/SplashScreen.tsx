import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import HeimdalLogo from '../components/common/HeimdalLogo';

interface SplashScreenProps {
  onContinue?: () => void;
  autoDismissMs?: number;
}

export default function SplashScreen({ onContinue, autoDismissMs }: SplashScreenProps) {
  const { colors, typography, isDark } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();

    if (autoDismissMs && onContinue) {
      const timer = setTimeout(() => {
        onContinue();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [autoDismissMs, onContinue, fadeAnim, slideAnim]);

  const wave1Color = isDark ? '#101C30' : '#EDF2F7';
  const wave2Color = isDark ? '#14233C' : '#E2E8F0';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <HeimdalLogo size={140} />

        <Text style={[typography.brandName, styles.brandTitle, { color: colors.textPrimary }]}>
          HEIMDAL
        </Text>

        <Text style={[typography.tagline, styles.tagline, { color: colors.textSecondary, letterSpacing: 1.5 }]}>
          WATCH | PROTECT | RESPOND
        </Text>

        {onContinue && (
          <TouchableOpacity
            style={[styles.continueButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={onContinue}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Enter application"
          >
            <Text style={[typography.button, { color: colors.brandAccent }]}>Enter App</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      <View style={styles.waveContainer} pointerEvents="none">
        <Svg width="100%" height="140" viewBox="0 0 400 140" preserveAspectRatio="none">
          <Path
            d="M 0 60 Q 100 20, 200 50 T 400 30 L 400 140 L 0 140 Z"
            fill={wave1Color}
            opacity={0.65}
          />
          <Path
            d="M 0 85 Q 120 50, 240 75 T 400 65 L 400 140 L 0 140 Z"
            fill={wave2Color}
            opacity={0.5}
          />
        </Svg>
      </View>

      <View style={styles.homeIndicatorContainer}>
        <View style={[styles.homeIndicator, { backgroundColor: colors.textMuted }]} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 2,
  },
  brandTitle: {
    marginTop: 20,
    marginBottom: 6,
  },
  tagline: {
    marginBottom: 28,
  },
  continueButton: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  waveContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
    zIndex: 1,
  },
  homeIndicatorContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  homeIndicator: {
    width: 60,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
});

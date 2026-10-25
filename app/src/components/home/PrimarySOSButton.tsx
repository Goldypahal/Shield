import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface PrimarySOSButtonProps {
  onTrigger: () => void;
  holdDurationMs?: number;
}

export default function PrimarySOSButton({
  onTrigger,
  holdDurationMs = 3000,
}: PrimarySOSButtonProps) {
  const { colors, typography } = useTheme();
  const [isPressing, setIsPressing] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const handlePressIn = () => {
    setIsPressing(true);
    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate(50);
      } catch (_) {}
    }

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: holdDurationMs,
      useNativeDriver: true,
    }).start();

    timerRef.current = setTimeout(() => {
      setIsPressing(false);
      progressAnim.setValue(0);
      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate([0, 100, 100, 200]);
        } catch (_) {}
      }
      onTrigger();
    }, holdDurationMs);
  };

  const handlePressOut = () => {
    setIsPressing(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleImmediatePress = () => {
    onTrigger();
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.outerRing,
          {
            backgroundColor: colors.sosOuterRing,
            transform: [{ scale: isPressing ? 1.15 : pulseAnim }],
          },
        ]}
      >
        <View style={[styles.middleRing, { backgroundColor: colors.sosRing }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={handleImmediatePress}
            style={[
              styles.coreButton,
              {
                backgroundColor: colors.sosPrimary,
                shadowColor: colors.sosPrimary,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Emergency SOS button. Press and hold for 3 seconds to trigger."
            accessibilityHint="Dispatches emergency alert to trusted contacts"
          >
            <Ionicons name="call" size={26} color="#FFFFFF" style={styles.icon} />
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 14 }]}>
        {isPressing ? 'Holding to trigger SOS...' : 'Tap and hold for 3 seconds'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  outerRing: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middleRing: {
    width: 124,
    height: 124,
    borderRadius: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  icon: {
    marginBottom: 2,
  },
  sosText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
});

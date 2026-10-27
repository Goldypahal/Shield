import React, { useRef, useState, useEffect } from 'react';
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
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import SosOverlay from '../common/SosOverlay';

interface SosButtonProps {
  onShowToast?: (message: string) => void;
}

export default function SosButton({ onShowToast }: SosButtonProps) {
  const { setSosState } = useJourneyStore();
  const [isHolding, setIsHolding] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Subtle continuous 2s pulse animation for outer glowing rings
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const handlePressIn = () => {
    setIsHolding(true);
    setSosState('holding');

    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate(30);
      } catch (_) {}
    }

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();

    timerRef.current = setTimeout(() => {
      setIsHolding(false);
      progressAnim.setValue(0);
      setSosState('countdown');
      setShowOverlay(true);
      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate(50);
        } catch (_) {}
      }
    }, 2000);
  };

  const handlePressOut = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isHolding) {
      setIsHolding(false);
      setSosState('idle');
      onShowToast?.('Hold for 2 seconds to trigger SOS');
    }
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  };

  return (
    <View style={styles.container}>
      {/* Outer Glow Ring 2 (12% opacity) */}
      <Animated.View
        style={[
          styles.glowRingOuter,
          {
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />

      {/* Outer Glow Ring 1 (25% opacity) */}
      <Animated.View
        style={[
          styles.glowRingInner,
          {
            transform: [{ scale: isHolding ? 1.18 : pulseAnim }],
          },
        ]}
      />

      {/* 84px Primary SOS Button */}
      <TouchableOpacity
        style={styles.sosButton}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS button. Press and hold for 2 seconds to send an emergency alert."
      >
        {/* Inner white ring */}
        <View style={styles.innerWhiteRing}>
          <Ionicons name="warning" size={26} color="#FFFFFF" />
          <Text style={styles.sosText}>SOS</Text>
        </View>
      </TouchableOpacity>

      {/* Full-screen countdown: raises the real alert and reports whether it reached the server */}
      <SosOverlay
        visible={showOverlay}
        onClose={() => {
          setShowOverlay(false);
          setSosState('idle');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 104,
    height: 104,
  },
  glowRingOuter: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  glowRingInner: {
    position: 'absolute',
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  sosButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 8,
  },
  innerWhiteRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: -2,
  },
});

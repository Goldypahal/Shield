import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  Text,
  Platform,
} from 'react-native';
import { TOKENS } from '../theme/tokens';
import HeimdalHeader from '../components/home/HeimdalHeader';
import SearchCard from '../components/home/SearchCard';
import ModeTabs from '../components/home/ModeTabs';
import SafetyMap from '../components/home/SafetyMap';
import RoutePanel from '../components/home/RoutePanel';
import ActionRow from '../components/home/ActionRow';
import { useJourneyStore } from '../store/useJourneyStore';

import NavigationHUD from '../components/home/NavigationHUD';

interface HomeScreenProps {
  onNavigate: (destination: string) => void;
}

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useState(new Animated.Value(0))[0];

  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(2200),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setToastMessage(null));
  };

  const { detectAndSetCurrentLocation, isJourneyActive } = useJourneyStore();

  useEffect(() => {
    // Automatically detect real GPS location on launch
    detectAndSetCurrentLocation()
      .then((loc) => {
        if (loc) {
          showToast(`Located at ${loc.label.split(',')[0]}`);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleManualRecenter = async () => {
    showToast('Locating your accurate GPS position...');
    const loc = await detectAndSetCurrentLocation();
    if (loc) {
      showToast(`Updated location: ${loc.label.split(',')[0]}`);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={TOKENS.colors.surface.bg} />

      <View style={styles.appContainer}>
        {/* ACTIVE NAVIGATION HUD MODE */}
        {isJourneyActive ? (
          <View style={styles.navigationHUDContainer}>
            <View style={styles.mapContainerNav}>
              <SafetyMap onShowToast={showToast} />
            </View>
            <NavigationHUD onShowToast={showToast} />
          </View>
        ) : (
          /* STANDARD PRE-JOURNEY HOME VIEW */
          <>
            {/* 1. Header (Height 64px) */}
            <HeimdalHeader onProfilePress={() => onNavigate('Settings')} />

            {/* 2. SearchCard (floating inputs + swap) */}
            <SearchCard onRecenter={handleManualRecenter} />

            {/* 3. ModeTabs (Drive, Bike, Walk, Transit) */}
            <ModeTabs />

            {/* 4. SafetyMap (Dark theme, 3 routes, live user beacon, hazard markers) */}
            <View style={styles.mapContainer}>
              <SafetyMap onShowToast={showToast} />
            </View>

            {/* 5. RoutePanel (Bottom sheet look with 3 route cards + Start Journey button) */}
            <RoutePanel onShowToast={showToast} />

            {/* 6. ActionRow (Share Journey + Avatar stack, Center Pulsing SOS, Add Stop) */}
            <ActionRow onShowToast={showToast} />

          </>
        )}

        {/* Floating Toast Notification */}
        {toastMessage && (
          <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: TOKENS.colors.surface.bg,
  },
  appContainer: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: TOKENS.colors.surface.bg,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  navigationHUDContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  mapContainerNav: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  mapContainer: {
    flex: 1,
    minHeight: 260,
    marginTop: 10,
    marginBottom: -20, // Negative margin so RoutePanel smoothly overlaps map by 20-24px
    zIndex: 1,
  },
  toastContainer: {
    position: 'absolute',
    top: 75,
    alignSelf: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

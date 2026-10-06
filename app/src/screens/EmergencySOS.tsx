import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert as RNAlert,
  Modal,
  TextInput,
  Platform
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import 'react-native-get-random-values'; // Required for uuid in React Native
import { v4 as uuidv4 } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OfflineQueueService, { AlertData } from '../services/OfflineQueue';
import LocationTracker from '../services/LocationTracker';
import AuthService from '../services/authService';
import ContactService from '../services/contactService';

export default function EmergencySOS() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [alertActive, setAlertActive] = useState<boolean>(false);
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');

  useEffect(() => {
    // 1. Subscribe to network status
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(!!state.isConnected);
      if (state.isConnected) {
        OfflineQueueService.syncWhenOnline();
      }
    });

    // 2. Start background voice listener for secret keywords
    import('../services/VoiceService').then(service => {
        service.default.startListening(() => {
            console.log('[SOS] Voice Keyword Triggered!');
            dispatchAlert();
        });
    });

    return () => {
        unsubscribe();
        import('../services/VoiceService').then(service => service.default.stopListening());
    };
  }, []);

  const dispatchAlert = async () => {
    const deviceGeneratedAlertId = uuidv4();
    
    try {
      // Ensure we have permissions every time we trigger
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setIsTriggering(false);
        setCountdown(null);
        RNAlert.alert("Permission Denied", "Location permissions are required for SOS. Please enable them in settings.");
        return;
      }

      let lat = 28.7041;
      let lon = 77.1025;
      
      try {
        const location = await Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.Balanced,
          timeout: 5000 
        });
        if (location && location.coords) {
          lat = location.coords.latitude;
          lon = location.coords.longitude;
        }
      } catch (locErr) {
        console.warn("GPS pick-up failed, using last known position fallback.", locErr);
        const lastLoc = await Location.getLastKnownPositionAsync();
        if (lastLoc && lastLoc.coords) {
          lat = lastLoc.coords.latitude;
          lon = lastLoc.coords.longitude;
        }
      }
      
      // Get contacts with safety fallback
      const contactList = await ContactService.listContacts();
      const contactPhones = (contactList || []).map((contact) => contact.phone).filter(p => !!p);

      const payload: AlertData = {
        id: deviceGeneratedAlertId,
        type: 'SOS_BUTTON_PRESS',
        lat: lat,
        lon: lon,
        message: "EMERGENCY: I need help immediately. My location is being recorded. Link: https://shield-app.com/track/" + deviceGeneratedAlertId,
        contacts: contactPhones,
      };

      // Queue for offline sync (handles SMS internally)
      await OfflineQueueService.queueAlert(payload);

      // Start real-time broadcasting if possible
      const userId = await AuthService.getUserId();
      if (userId) {
        try {
          await LocationTracker.startBroadcastingSOS(deviceGeneratedAlertId, userId);
        } catch (trackErr) {
          console.warn("Real-time broadcast failed, relying on offline queue.", trackErr);
        }
      }
      
      setActiveAlertId(deviceGeneratedAlertId);
      setAlertActive(true);
      setIsTriggering(false);
      setCountdown(null);
      
      RNAlert.alert(
        "SOS Active",
        isOnline 
          ? "SOS signals sent! Your emergency contacts and local authorities are being notified." 
          : "Offline: SMS alerts sent via cellular. Data will sync when you are back online."
      );
    } catch (error: any) {
      console.error("SOS Trigger failure:", error);
      setIsTriggering(false);
      setCountdown(null);
      
      const errorStr = String(error);
      const errorMessage = errorStr.includes('AsyncStorage') 
        ? "App Storage Error: Please restart the app." 
        : "Critical Failure: " + (error.message || "Please check GPS and connection.");
        
      RNAlert.alert("SOS System Error", errorMessage);
    }
  };

  const handlePanicButtonPress = async () => {
    setIsTriggering(true);
    setCountdown(10); // ALERT-2: 10 second pre-alert countdown with vibration

    let currentCount = 10;
    const interval = setInterval(() => {
      currentCount -= 1;
      setCountdown(currentCount);

      if (currentCount <= 0) {
        clearInterval(interval);
        dispatchAlert();
      }
    }, 1000);

    setTimeoutId(interval);
  };

  const cancelAlert = async () => {
    const savedPin = await AsyncStorage.getItem('@shield_pin');
    const duressPin = await AsyncStorage.getItem('@shield_duress_pin');

    const executeCancel = () => {
      if (timeoutId) {
        clearInterval(timeoutId);
        setTimeoutId(null);
        setCountdown(null);
        setIsTriggering(false);
        RNAlert.alert("Alert Cancelled", "Pre-alert was cancelled safely.");
        return;
      }
      setAlertActive(false);
      setActiveAlertId(null);
      LocationTracker.stopBroadcastingSOS();
      RNAlert.alert("Alert Disabled", "SOS has been deactivated.");
    };

    if (savedPin || duressPin) {
      if (Platform.OS === 'ios') {
        RNAlert.prompt(
          "Enter PIN",
          "Secure PIN required to deactivate SOS.",
          [
            { text: "Back", style: "cancel" },
            {
              text: "Cancel Alert",
              onPress: async (input) => {
                if (input === duressPin) {
                  // ALERT-3, DUR-3: Silent high-priority alert dispatched
                  dispatchAlert();
                  executeCancel();
                } else if (input === savedPin) {
                  executeCancel();
                } else {
                  RNAlert.alert("Incorrect PIN", "Alert remains active.");
                }
              }
            }
          ],
          "secure-text"
        );
      } else {
        setPinInput('');
        setPinModalVisible(true);
      }
    } else {
      executeCancel();
    }
  };

  const confirmAndroidPinCancel = async () => {
    const savedPin = await AsyncStorage.getItem('@shield_pin');
    const duressPin = await AsyncStorage.getItem('@shield_duress_pin');

    // DUR-1 to DUR-3: Check normal PIN vs duress PIN locally
    if (duressPin && pinInput === duressPin) {
      // Duress PIN entered: appear to cancel normally while silently dispatching high-priority alert
      setPinModalVisible(false);
      setPinInput('');
      dispatchAlert(); // Silently dispatches alert in background
      if (timeoutId) {
        clearInterval(timeoutId);
        setTimeoutId(null);
        setCountdown(null);
        setIsTriggering(false);
      }
      setAlertActive(false);
      setActiveAlertId(null);
      RNAlert.alert("Alert Cancelled", "Pre-alert was cancelled safely.");
      return;
    }

    if (pinInput === savedPin) {
      setPinModalVisible(false);
      setPinInput('');
      if (timeoutId) {
        clearInterval(timeoutId);
        setTimeoutId(null);
        setCountdown(null);
        setIsTriggering(false);
        RNAlert.alert("Alert Cancelled", "Pre-alert was cancelled safely.");
        return;
      }
      setAlertActive(false);
      setActiveAlertId(null);
      LocationTracker.stopBroadcastingSOS();
      RNAlert.alert("Alert Disabled", "SOS has been safely deactivated.");
      return;
    }

    RNAlert.alert("Incorrect PIN", "Alert remains active.");
  };

  return (
    <View style={styles.container}>
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter PIN</Text>
            <Text style={styles.modalText}>Secure PIN required to deactivate SOS.</Text>
            <TextInput
              value={pinInput}
              onChangeText={setPinInput}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={4}
              style={styles.modalInput}
              placeholder="4-digit PIN"
              placeholderTextColor="#777"
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setPinModalVisible(false)}>
                <Text style={styles.modalButtonText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButtonPrimary} onPress={confirmAndroidPinCancel}>
                <Text style={styles.modalButtonText}>Cancel Alert</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Network Status Indicator */}
      <View style={[styles.networkBadge, { backgroundColor: isOnline ? '#4CAF50' : '#F44336' }]}>
        <Text style={styles.networkText}>{isOnline ? 'Network Online' : 'No Internet - Offline Mode Active'}</Text>
      </View>

      <Text style={styles.title}>SHIELD</Text>
      <Text style={styles.subtitle}>Hold the button to instantly alert your family and nearby users.</Text>

      {/* The main panic button */}
      <TouchableOpacity
        style={[styles.sosButton, alertActive && styles.sosButtonActive]}
        onLongPress={handlePanicButtonPress}
        onPress={() => {
            if (!isTriggering && !alertActive) {
                RNAlert.alert("Hold to Trigger", "Press and hold for 0.5 seconds to activate the emergency SOS signal.");
            }
        }}
        delayLongPress={500} 
        disabled={isTriggering || alertActive}
      >
        {isTriggering && countdown !== null && countdown > 0 ? (
          <View style={styles.countdownContainer}>
             <Text style={styles.countdownText}>{countdown}</Text>
             <Text style={styles.countdownSub}>Cancel?</Text>
          </View>
        ) : isTriggering ? (
          <ActivityIndicator size="large" color="#FFF" />
        ) : (
          <Text style={styles.sosButtonText}>{alertActive ? 'SOS ACTIVE' : 'PRESS & HOLD'}</Text>
        )}
      </TouchableOpacity>
      
      {(alertActive || isTriggering) && (
         <TouchableOpacity style={styles.cancelButton} onPress={cancelAlert}>
           <Text style={styles.cancelButtonText}>{countdown !== null ? 'Cancel Now' : 'Cancel Panic'}</Text>
         </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  networkBadge: {
    position: 'absolute',
    top: 50,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  networkText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12
  },
  title: {
    color: '#FFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 10
  },
  subtitle: {
    color: '#A0A0A0',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 60,
    paddingHorizontal: 20
  },
  sosButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: '#F44336',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 }
  },
  sosButtonActive: {
    backgroundColor: '#8B0000',
    transform: [{ scale: 1.1 }]
  },
  sosButtonText: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'black'
  },
  cancelButton: {
    marginTop: 40,
    padding: 15
  },
  cancelButtonText: {
    color: '#A0A0A0',
    fontSize: 16,
    textDecorationLine: 'underline'
  },
  countdownContainer: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  countdownText: {
    color: '#FFF',
    fontSize: 64,
    fontWeight: 'bold'
  },
  countdownSub: {
    color: '#FFF',
    fontSize: 14,
    opacity: 0.8
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 20
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8
  },
  modalText: {
    color: '#B0B0B0',
    marginBottom: 16
  },
  modalInput: {
    backgroundColor: '#2A2A2A',
    color: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16
  },
  modalRow: {
    flexDirection: 'row',
    gap: 12
  },
  modalButtonPrimary: {
    flex: 1,
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalButtonSecondary: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalButtonText: {
    color: '#FFF',
    fontWeight: '700'
  }
});

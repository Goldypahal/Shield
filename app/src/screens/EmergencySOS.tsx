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
import OfflineQueueService, { TriggerType } from '../services/OfflineQueue';
import { checkPinOffline } from '../services/pinVault';
import AuthService from '../services/authService';
import ContactService from '../services/contactService';
import { triggerEmergency } from '../services/sosService';

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
            dispatchAlert('VOICE');
        });
    });

    return () => {
        unsubscribe();
        import('../services/VoiceService').then(service => service.default.stopListening());
    };
  }, []);

  const dispatchAlert = async (trigger: TriggerType = 'SOS_BUTTON', silent = false) => {
    try {
      await Location.requestForegroundPermissionsAsync();
      const session = await AuthService.ensureSession().catch(() => null);
      const contacts = await ContactService.listContacts().catch(() => []);
      const result = await triggerEmergency({
        uid: session?.uid ?? 'signed-out',
        name: session?.name ?? 'SHIELD user',
        phone: session?.phone ?? '',
        emergencyContacts: contacts,
        sensitivityMode: 'NORMAL',
      }, 90, 'HIGH', trigger);

      if (silent) return; // duress: the screen must keep looking cancelled
      setActiveAlertId(result.alertId);
      setAlertActive(true);
      setIsTriggering(false);
      setCountdown(null);
      RNAlert.alert(
        result.delivery === 'server' ? "SOS Active" : "SOS Queued",
        result.delivery === 'server'
          ? "Your guardians are being alerted and can follow your live location."
          : "No connection. The alert is saved on this phone and will send automatically. Call 112 if you are in danger."
      );
    } catch (error: any) {
      console.error("SOS Trigger failure:", error);
      setIsTriggering(false);
      setCountdown(null);
      if (!silent) RNAlert.alert("SOS could not be saved", "Call 112 now.");
    }
  };

  /**
   * Stands down an active alert on the server, which checks the PIN. A duress
   * PIN gets the same "cancelled" answer while the server keeps the alert open,
   * so this screen behaves identically either way. Live location stops by
   * itself when the server reports the alert closed (HTTP 409).
   */
  const standDownOnServer = async (pin: string): Promise<'ok' | 'wrong_pin' | 'offline'> => {
    if (!activeAlertId) return 'ok';
    try {
      const client = await AuthService.getAuthenticatedClient();
      await client.put(`/api/v1/alerts/${activeAlertId}/state`, { state: 'CANCELLED', pin });
      return 'ok';
    } catch (error: any) {
      return error?.response?.status === 403 ? 'wrong_pin' : 'offline';
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

  /** What the user sees after any successful cancel, normal or duress: identical on purpose (DUR-3). */
  const showCancelled = () => {
    if (timeoutId) {
      clearInterval(timeoutId);
      setTimeoutId(null);
    }
    setCountdown(null);
    setIsTriggering(false);
    setAlertActive(false);
    setActiveAlertId(null);
    RNAlert.alert("Alert Cancelled", "SOS has been deactivated.");
  };

  const handlePinCancel = async (input: string) => {
    // Salted hashes in the OS keystore; the PIN itself is never stored
    const local = await checkPinOffline(input);
    const isDuress = local === 'duress';
    const isNormal = local === 'normal';

    // Pre-alert countdown: nothing has been sent yet, so the PIN is checked on the device
    if (timeoutId) {
      if (isDuress) {
        showCancelled();
        dispatchAlert('DURESS_PIN', true); // silent: no state change or popup on screen
      } else if (isNormal) {
        showCancelled();
      } else {
        RNAlert.alert("Incorrect PIN", "Alert remains active.");
      }
      return;
    }

    // Active alert: the server decides, and handles a duress PIN without telling the phone
    const outcome = await standDownOnServer(input);
    if (outcome === 'ok') return showCancelled();
    if (outcome === 'wrong_pin') return RNAlert.alert("Incorrect PIN", "Alert remains active.");

    // Offline: fall back to the on-device check
    if (isDuress) {
      showCancelled();
      dispatchAlert('DURESS_PIN', true);
    } else if (isNormal) {
      showCancelled();
    } else {
      RNAlert.alert("Incorrect PIN", "Alert remains active.");
    }
  };

  const cancelAlert = async () => {
    // Only the SOS PIN stops an alert, even during the countdown
    if (Platform.OS === 'ios') {
      RNAlert.prompt(
        "Enter PIN",
        "Secure PIN required to deactivate SOS.",
        [
          { text: "Back", style: "cancel" },
          { text: "Cancel Alert", onPress: (input) => { handlePinCancel(input ?? ''); } }
        ],
        "secure-text"
      );
    } else {
      setPinInput('');
      setPinModalVisible(true);
    }
  };

  const confirmAndroidPinCancel = async () => {
    const input = pinInput;
    setPinModalVisible(false);
    setPinInput('');
    await handlePinCancel(input);
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

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

interface OnboardingProps {
  onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [keyword, setKeyword] = useState('Help Me');

  const handleNext = async () => {
    if (step === 1 && (!name || !phone)) {
      Alert.alert('Required', 'Please enter your name and phone number.');
      return;
    }
    
    if (step === 1) {
      const nameRegex = /^[A-Za-z\s]+$/;
      if (!nameRegex.test(name)) {
        Alert.alert('Invalid Name', 'Name should contain only letters.');
        return;
      }
      if (name.length > 12) {
        Alert.alert('Name Too Long', 'Name should be maximum 12 letters.');
        return;
      }
    }

    if (step === 2 && pin.length < 4) {
      Alert.alert('PIN Required', 'Please set a 4-digit security PIN to prevent accidental cancellations.');
      return;
    }
    if (step === 3 && (!parentPhone || !guardianPhone)) {
      Alert.alert('Security Contacts Missing', 'You must add at least a Parent and a Guardian contact for emergency alerts.');
      return;
    }
    
    if (step === 5) {
      await requestFinalPermissions();
    } else {
      setStep(step + 1);
    }
  };

  const requestFinalPermissions = async () => {
    try {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        Alert.alert('Location Required', 'Shield requires location access to save you in emergencies. Please select "Allow" or "Allow While Using App".', [
          { text: 'Try Again', onPress: requestFinalPermissions }
        ]);
        return;
      }

      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      if (audioStatus !== 'granted') {
        Alert.alert('Voice Required', 'Voice detection is needed for the secret keyword trigger.', [
          { text: 'Grant Permission', onPress: requestFinalPermissions }
        ]);
        return;
      }

      // Notification permission request
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        // Note: SDK 53+ might show warnings in Expo Go but we proceed anyway if it's not a hard crash
      } catch (error) {
        console.warn('Notifications permission error:', error);
      }

      await finishSetup();
    } catch (error) {
      console.error('Permission request error:', error);
      Alert.alert('Error', 'An unexpected error occurred while requesting permissions.');
    }
  };

  const finishSetup = async () => {
    try {
      await AsyncStorage.setItem('@shield_user_name', name);
      await AsyncStorage.setItem('@shield_phone', phone);
      await AsyncStorage.setItem('@shield_pin', pin);
      await AsyncStorage.setItem('@shield_keyword', keyword);
      
      const contacts = [
        { id: 'parent', name: parentName || 'Parent', phone: parentPhone },
        { id: 'guardian', name: guardianName || 'Guardian', phone: guardianPhone }
      ];
      await AsyncStorage.setItem('@shield_contacts_local', JSON.stringify(contacts));
      
      await AsyncStorage.setItem('@shield_setup_complete', 'true');
      onComplete();
    } catch (e) {
      Alert.alert('Error', 'Failed to save settings.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Ionicons name="shield-checkmark" size={60} color="#FF9800" />
            <Text style={styles.title}>SHIELD</Text>
            <Text style={styles.subtitle}>Personal Safety Engine</Text>
          </View>

          <View style={styles.stepIndicator}>
            {[1, 2, 3, 4, 5].map((s) => (
              <View 
                key={s} 
                style={[styles.dot, step >= s && styles.dotActive]} 
              />
            ))}
          </View>

          {step === 1 && (
            <View style={styles.form}>
              <Text style={styles.label}>Your Details</Text>
              <Text style={styles.description}>Used to identify you when distress signals are sent to authorities.</Text>
              <TextInput 
                style={styles.input}
                placeholder="Full Name (Max 12 chars)"
                placeholderTextColor="#666"
                value={name}
                onChangeText={setName}
                maxLength={12}
              />
              <TextInput 
                style={styles.input}
                placeholder="Your Mobile Number (+...)"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>
          )}

          {step === 2 && (
            <View style={styles.form}>
              <Text style={styles.label}>Security PIN</Text>
              <Text style={styles.description}>Needed to deactivate an active SOS or change emergency settings.</Text>
              <TextInput 
                style={styles.input}
                placeholder="4-digit PIN"
                placeholderTextColor="#666"
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                value={pin}
                onChangeText={setPin}
              />
            </View>
          )}

          {step === 3 && (
            <View style={styles.form}>
              <Text style={styles.label}>SOS Contacts</Text>
              <Text style={styles.description}>Add the primary people who should be notified when you are in danger.</Text>
              <TextInput 
                style={styles.input}
                placeholder="Parent/Spouse Name"
                placeholderTextColor="#666"
                value={parentName}
                onChangeText={setParentName}
              />
              <TextInput 
                style={styles.input}
                placeholder="Parent/Spouse Phone"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={parentPhone}
                onChangeText={setParentPhone}
              />
              <TextInput 
                style={styles.input}
                placeholder="Second Guardian Name"
                placeholderTextColor="#666"
                value={guardianName}
                onChangeText={setGuardianName}
              />
              <TextInput 
                style={styles.input}
                placeholder="Second Guardian Phone"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={guardianPhone}
                onChangeText={setGuardianPhone}
              />
            </View>
          )}

          {step === 4 && (
            <View style={styles.form}>
              <Text style={styles.label}>Voice Keyword</Text>
              <Text style={styles.description}>Saying this phrase will trigger a silent alarm. Use something unique like "Help Shield" or "Bachao".</Text>
              <TextInput 
                style={styles.input}
                placeholder="e.g. Help Shield"
                placeholderTextColor="#666"
                autoCapitalize="none"
                value={keyword}
                onChangeText={setKeyword}
              />
            </View>
          )}

          {step === 5 && (
            <View style={styles.form}>
              <Text style={styles.label}>Permissions</Text>
              <Text style={styles.description}>Shield requires high-level permissions to function in the background.</Text>
              <View style={styles.permRow}>
                <Ionicons name="location" size={24} color="#FF9800" />
                <Text style={styles.permText}>Always-on Location (Emergency tracking)</Text>
              </View>
              <View style={styles.permRow}>
                <Ionicons name="mic" size={24} color="#FF9800" />
                <Text style={styles.permText}>Microphone Access (Voice trigger detection)</Text>
              </View>
              <View style={styles.permRow}>
                <Ionicons name="notifications" size={24} color="#FF9800" />
                <Text style={styles.permText}>Push Notifications (Safety alerts)</Text>
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <Text style={styles.buttonText}>{step === 5 ? 'Allow & Complete' : 'Continue'}</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFF" />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { padding: 30, flexGrow: 1, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { color: '#FFF', fontSize: 32, fontWeight: '900', marginTop: 10 },
  subtitle: { color: '#A0A0A0', fontSize: 16, marginTop: 5 },
  stepIndicator: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 40 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#333' },
  dotActive: { backgroundColor: '#FF9800', width: 25 },
  form: { marginBottom: 30 },
  label: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  description: { color: '#A0A0A0', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  input: { backgroundColor: '#1E1E1E', color: '#FFF', borderRadius: 12, padding: 18, fontSize: 16, marginBottom: 15, borderWidth: 1, borderColor: '#333' },
  button: { backgroundColor: '#FF9800', padding: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  buttonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  infoBox: { flexDirection: 'row', backgroundColor: '#1E1E1E', padding: 15, borderRadius: 10, gap: 10, marginTop: 10 },
  infoText: { color: '#A0A0A0', fontSize: 12, flex: 1, lineHeight: 18 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 15, backgroundColor: '#1E1E1E', padding: 20, borderRadius: 12, marginBottom: 12 },
  permText: { color: '#FFF', fontSize: 14, fontWeight: '500', flex: 1 }
});

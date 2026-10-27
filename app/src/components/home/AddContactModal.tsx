import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';

interface AddContactModalProps {
  visible: boolean;
  onClose: () => void;
  onAddContact: (contact: { name: string; phone: string }) => void;
}

export default function AddContactModal({ visible, onClose, onAddContact }: AddContactModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    if (!phone.trim() || phone.length < 8) {
      setError('Please enter a valid phone number');
      return;
    }
    onAddContact({ name: name.trim(), phone: phone.trim() });
    setName('');
    setPhone('');
    setError('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />

          <View style={styles.header}>
            <Text style={styles.title}>Add Trusted Contact</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={TOKENS.colors.ink[600]} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtext}>
            Trusted contacts will be notified during journeys and receive high-priority SOS alerts.
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={18} color={TOKENS.colors.ink[400]} />
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Maya Patel"
                placeholderTextColor={TOKENS.colors.ink[400]}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError('');
                }}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={18} color={TOKENS.colors.ink[400]} />
              <TextInput
                style={styles.textInput}
                placeholder="e.g. +91 98765 43210"
                placeholderTextColor={TOKENS.colors.ink[400]}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={(t) => {
                  setPhone(t);
                  setError('');
                }}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Save Contact</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
  },
  subtext: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: TOKENS.colors.risk.red,
    marginBottom: 10,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.colors.ink[900],
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  textInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: TOKENS.colors.ink[900],
  },
  saveBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

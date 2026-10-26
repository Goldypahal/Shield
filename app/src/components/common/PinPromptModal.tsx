import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface PinPromptModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Resolves to an error message to show, or null when done (the caller closes the modal). */
  onSubmit: (pin: string) => Promise<string | null>;
  onDismiss: () => void;
  dismissLabel?: string;
}

/** 4-6 digit secure PIN entry. Shows the same outcome for the normal and duress PIN. */
export default function PinPromptModal({
  visible, title, message, confirmLabel, onSubmit, onDismiss, dismissLabel = 'Back',
}: PinPromptModalProps) {
  const { colors, typography, radii } = useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin) || busy) {
      setError('Enter your 4-6 digit SOS PIN.');
      return;
    }
    setBusy(true);
    const err = await onSubmit(pin).catch(() => 'Could not check the PIN. Try again.');
    setBusy(false);
    setPin('');
    setError(err);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
          <View style={[styles.iconBox, { backgroundColor: colors.sosRing }]}>
            <Ionicons name="keypad" size={26} color={colors.sosPrimary} />
          </View>
          <Text style={[typography.h3, { color: colors.textPrimary, marginTop: 12, textAlign: 'center' }]}>{title}</Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 6, textAlign: 'center' }]}>{message}</Text>

          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
            onSubmitEditing={submit}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            maxLength={6}
            textContentType="oneTimeCode"
            autoComplete="off"
            placeholder="• • • •"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.textPrimary, borderColor: error ? colors.sosPrimary : colors.border }]}
            accessibilityLabel="SOS PIN"
          />
          {error && <Text style={[typography.caption, { color: colors.sosPrimary, marginTop: 6 }]}>{error}</Text>}

          <TouchableOpacity
            onPress={submit}
            style={[styles.primary, { backgroundColor: colors.sosPrimary }]}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typography.button, { color: '#FFFFFF' }]}>{confirmLabel}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={styles.secondary} accessibilityRole="button" accessibilityLabel={dismissLabel}>
            <Text style={[typography.button, { color: colors.textSecondary }]}>{dismissLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    marginTop: 18,
    width: '70%',
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 10,
    outlineWidth: 0,
  },
  primary: {
    marginTop: 18,
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondary: {
    marginTop: 8,
    paddingVertical: 10,
  },
});

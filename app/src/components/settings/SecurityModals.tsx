import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import AuthService, { authErrorMessage } from '../../services/authService';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Shell({ visible, onClose, title, icon, children }: { visible: boolean; onClose: () => void; title: string; icon: any; children: React.ReactNode }) {
  const { colors, typography, radii } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name={icon} size={20} color={colors.brandAccent} />
              </View>
              <Text style={[typography.h3, { color: colors.textPrimary, flex: 1, marginLeft: 12 }]}>{title}</Text>
              <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, numeric, max }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; max?: number }) {
  const { colors, typography, radii } = useTheme();
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 4 }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(numeric ? v.replace(/\D/g, '') : v)}
        secureTextEntry
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={max}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, typography.bodyMedium, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.lg }]}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Footer({ busy, error, label, onPress, note }: { busy: boolean; error: string | null; label: string; onPress: () => void; note?: string | null }) {
  const { colors, typography } = useTheme();
  return (
    <>
      {note && !error && <Text style={[typography.caption, { color: colors.statusSuccessText, marginTop: 10 }]}>{note}</Text>}
      {error && <Text style={[typography.caption, { color: colors.sosPrimary, marginTop: 10 }]}>{error}</Text>}
      <TouchableOpacity onPress={onPress} disabled={busy} style={[styles.primary, { backgroundColor: colors.brandAccent, opacity: busy ? 0.7 : 1 }]}
        accessibilityRole="button" accessibilityLabel={label}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typography.button, { color: '#FFFFFF' }]}>{label}</Text>}
      </TouchableOpacity>
    </>
  );
}

/** SOS PIN change: a code is emailed to the verified address, then code + password set new PINs. */
export function ChangePinModal({ visible, onClose, onDone }: ModalProps) {
  const { colors, typography } = useTheme();
  const { busy, error, setError, run } = useForm();
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [duress, setDuress] = useState('');

  useEffect(() => {
    if (visible) {
      setSent(false); setNote(null); setCode(''); setPassword(''); setPin(''); setPin2(''); setDuress(''); setError(null);
    }
  }, [visible]);

  const sendCode = () => run(async () => {
    const res = await AuthService.requestPinChangeCode();
    setSent(true);
    setNote(res.demo_email_code ? `Development server code: ${res.demo_email_code}` : 'Code sent. Check your email.');
  });

  const save = () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your email.');
    if (!password) return setError('Enter your account password.');
    if (!/^\d{4,6}$/.test(pin) || pin !== pin2) return setError('Enter the same 4-6 digit SOS PIN twice.');
    if (!/^\d{4,6}$/.test(duress) || duress === pin) return setError('The duress PIN must be 4-6 digits and different from the SOS PIN.');
    run(async () => {
      await AuthService.changePins(code, password, pin, duress);
      onDone('Your SOS PIN and duress PIN were changed.');
    });
  };

  return (
    <Shell visible={visible} onClose={onClose} title="Change SOS PIN" icon="keypad-outline">
      <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 12 }]}>
        To protect your SOS, changing the PIN needs a code sent to your email and your account password.
        You do not need the old PIN, so this also works if you forgot it.
      </Text>
      {!sent ? (
        <Footer busy={busy} error={error} label="Email me a code" onPress={sendCode} />
      ) : (
        <>
          <Field label="Code from email" value={code} onChange={setCode} numeric max={6} />
          <Field label="Account password" value={password} onChange={setPassword} />
          <Field label="New SOS PIN" value={pin} onChange={setPin} numeric max={6} />
          <Field label="Repeat new SOS PIN" value={pin2} onChange={setPin2} numeric max={6} />
          <Field label="New duress PIN" value={duress} onChange={setDuress} numeric max={6} />
          <Footer busy={busy} error={error} label="Save new PINs" onPress={save} note={note} />
        </>
      )}
    </Shell>
  );
}

export function ChangePasswordModal({ visible, onClose, onDone }: ModalProps) {
  const { busy, error, setError, run } = useForm();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');

  useEffect(() => {
    if (visible) { setCurrent(''); setNext(''); setNext2(''); setError(null); }
  }, [visible]);

  const save = () => {
    if (next.length < 10) return setError('The new password must be at least 10 characters.');
    if (next !== next2) return setError('The new passwords do not match.');
    run(async () => {
      await AuthService.changePassword(current, next);
      onDone('Password changed. Other devices were signed out.');
    });
  };

  return (
    <Shell visible={visible} onClose={onClose} title="Change password" icon="key-outline">
      <Field label="Current password" value={current} onChange={setCurrent} />
      <Field label="New password" value={next} onChange={setNext} />
      <Field label="Repeat new password" value={next2} onChange={setNext2} />
      <Footer busy={busy} error={error} label="Change password" onPress={save} />
    </Shell>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', borderWidth: 1, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  input: { borderWidth: 1, height: 44, paddingHorizontal: 12, outlineWidth: 0 },
  primary: { marginTop: 16, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
});

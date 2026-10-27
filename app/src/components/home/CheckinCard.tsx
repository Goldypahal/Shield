import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import PinPromptModal from '../common/PinPromptModal';
import {
  Checkin, activeCheckin, confirmCheckin, extendCheckin, sendCheckinLocation, startCheckin,
} from '../../services/checkinService';
import { authErrorMessage } from '../../services/authService';

const CHOICES = [15, 30, 45, 60, 90];

/**
 * "I should be home by…" timer. The countdown runs on the server, so guardians are
 * alerted even if this phone dies or is taken. Stopping or extending it needs the PIN.
 */
export default function CheckinCard({ style }: { style?: object } = {}) {
  const { colors, typography, radii } = useTheme();
  const [timer, setTimer] = useState<Checkin | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [pinFor, setPinFor] = useState<'confirm' | 'extend' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    activeCheckin().then(setTimer).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    if (!timer) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const loc = setInterval(() => sendCheckinLocation(timer.id).catch(() => undefined), 60000);
    return () => { clearInterval(tick); clearInterval(loc); };
  }, [timer?.id]);

  const start = async (minutes: number) => {
    setPickerOpen(false);
    setError(null);
    try {
      setTimer(await startCheckin(minutes, label.trim() || undefined));
    } catch (e) {
      setError(authErrorMessage(e, 'Could not start the timer. Check your connection.'));
    }
  };

  const onPin = async (pin: string) => {
    if (!timer) return null;
    if (pinFor === 'confirm') {
      const err = await confirmCheckin(timer.id, pin);
      if (err) return err;
      setTimer(null);
    } else {
      const res = await extendCheckin(timer.id, pin, 10);
      if (typeof res === 'string') return res;
      setTimer(res);
    }
    setPinFor(null);
    return null;
  };

  const secondsLeft = timer ? Math.max(0, Math.round(timer.due_at - now / 1000)) : 0;
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const urgent = timer !== null && secondsLeft < 120;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: urgent ? colors.sosPrimary : colors.border, borderRadius: radii.lg }, style]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="timer-outline" size={22} color={urgent ? colors.sosPrimary : colors.brandAccent} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[typography.h4, { color: colors.textPrimary }]}>
            {timer ? `Check in within ${mmss}` : 'Check-in timer'}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]} numberOfLines={2}>
            {timer
              ? `${timer.label ? `${timer.label} · ` : ''}If you don't, your guardians are alerted with your last location.`
              : "Going somewhere? If you don't check in on time, guardians are alerted automatically."}
          </Text>
        </View>
      </View>
      {timer ? (
        <View style={[styles.row, { marginTop: 10 }]}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.statusSuccess }]} onPress={() => setPinFor('confirm')}
            accessibilityRole="button" accessibilityLabel="I am safe, stop the timer with PIN">
            <Text style={[typography.button, { color: '#FFFFFF' }]}>I'm safe</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceSecondary, marginLeft: 8 }]} onPress={() => setPinFor('extend')}
            accessibilityRole="button" accessibilityLabel="Add 10 minutes with PIN">
            <Text style={[typography.button, { color: colors.textPrimary }]}>+10 min</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.brandAccent, marginTop: 10 }]} onPress={() => setPickerOpen(true)}
          accessibilityRole="button" accessibilityLabel="Start a check-in timer">
          <Text style={[typography.button, { color: '#FFFFFF' }]}>Start timer</Text>
        </TouchableOpacity>
      )}
      {error && <Text style={[typography.caption, { color: colors.sosPrimary, marginTop: 6 }]}>{error}</Text>}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>I should be safe in…</Text>
            <TextInput value={label} onChangeText={setLabel} maxLength={60} placeholder="Where to? (optional, e.g. Home)"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, typography.bodyMedium, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.lg }]} />
            <View style={styles.choices}>
              {CHOICES.map((m) => (
                <TouchableOpacity key={m} style={[styles.choice, { borderColor: colors.brandAccent, borderRadius: radii.lg }]} onPress={() => start(m)}
                  accessibilityRole="button" accessibilityLabel={`${m} minutes`}>
                  <Text style={[typography.h4, { color: colors.brandAccent }]}>{m}</Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>min</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ alignItems: 'center', paddingTop: 12 }}>
              <Text style={[typography.button, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <PinPromptModal
        visible={pinFor !== null}
        title={pinFor === 'confirm' ? "Confirm you're safe" : 'Add 10 minutes'}
        message="Enter your SOS PIN."
        confirmLabel={pinFor === 'confirm' ? "I'm safe" : 'Add time'}
        onSubmit={onPin}
        onDismiss={() => setPinFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, marginHorizontal: 20, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 360, borderWidth: 1, padding: 20 },
  input: { borderWidth: 1, height: 44, paddingHorizontal: 12, marginTop: 12, outlineWidth: 0 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  choice: { width: '30%', borderWidth: 1.5, paddingVertical: 10, alignItems: 'center' },
});

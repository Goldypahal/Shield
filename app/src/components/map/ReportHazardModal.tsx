import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { HAZARD_LABELS, HazardCategory, reportHazard } from '../../services/safetyService';
import { LatLon } from '../../services/routeService';

interface Props {
  visible: boolean;
  at: LatLon | null;
  onClose: (sent?: boolean) => void;
}

const ICONS: Record<HazardCategory, any> = {
  broken_light: 'bulb-outline',
  dark_alley: 'moon-outline',
  harassment_spot: 'hand-left-outline',
  unsafe_zone: 'alert-circle-outline',
  blocked_path: 'close-circle-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

/** Community report at the user's position. Reports raise route risk nearby for 30 days. */
export default function ReportHazardModal({ visible, at, onClose }: Props) {
  const { colors, typography, radii } = useTheme();
  const [category, setCategory] = useState<HazardCategory | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setCategory(null); setNote(''); setError(null); }
  }, [visible]);

  const send = async () => {
    if (!at) return setError('Your location is not available yet.');
    if (!category) return setError('Choose what you want to report.');
    setBusy(true);
    const err = await reportHazard({ ...at, category, description: note.trim() || null });
    setBusy(false);
    if (err) return setError(err);
    onClose(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
          <View style={styles.header}>
            <Text style={[typography.h3, { color: colors.textPrimary, flex: 1 }]}>Report a problem here</Text>
            <TouchableOpacity onPress={() => onClose()} accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
          </View>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4 }]}>
            Reports are anonymous. They warn other walkers and steer safer routes away from this spot for 30 days.
          </Text>
          <View style={styles.grid}>
            {(Object.keys(HAZARD_LABELS) as HazardCategory[]).map((c) => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)}
                style={[styles.option, { borderColor: category === c ? colors.brandAccent : colors.border, borderRadius: radii.lg,
                  backgroundColor: category === c ? colors.surfaceSecondary : colors.surface }]}
                accessibilityRole="button" accessibilityState={{ selected: category === c }} accessibilityLabel={HAZARD_LABELS[c]}>
                <Ionicons name={ICONS[c]} size={20} color={category === c ? colors.brandAccent : colors.textSecondary} />
                <Text style={[typography.caption, { color: colors.textPrimary, marginTop: 4, textAlign: 'center' }]}>{HAZARD_LABELS[c]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={note} onChangeText={setNote} maxLength={300} placeholder="Optional details (no names or phone numbers)"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, typography.bodySmall, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.lg }]} />
          {error && <Text style={[typography.caption, { color: colors.sosPrimary, marginTop: 8 }]}>{error}</Text>}
          <TouchableOpacity onPress={send} style={[styles.primary, { backgroundColor: colors.brandAccent }]} accessibilityRole="button" accessibilityLabel="Send report">
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typography.button, { color: '#FFFFFF' }]}>Send report</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, borderWidth: 1, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  option: { width: '31%', borderWidth: 1.5, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  input: { borderWidth: 1, marginTop: 12, paddingHorizontal: 10, height: 42, outlineWidth: 0 },
  primary: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
});

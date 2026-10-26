import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import PinPromptModal from '../common/PinPromptModal';
import { MyAlert, consentFir, myAlerts } from '../../services/policeService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/**
 * Past alerts. For an FIR, the walker can let the police use one incident's report,
 * location trail and evidence hashes; without this, police lose access once an alert closes.
 */
export default function IncidentHistoryModal({ visible, onClose }: Props) {
  const { colors, typography, radii } = useTheme();
  const [alerts, setAlerts] = useState<MyAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<MyAlert | null>(null);

  const load = () => myAlerts().then(setAlerts).catch(() => setError('Could not load your incidents.'));
  useEffect(() => {
    if (visible) { setAlerts(null); setError(null); load(); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
          <View style={styles.header}>
            <Text style={[typography.h3, { color: colors.textPrimary, flex: 1 }]}>Incident history</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
          </View>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4 }]}>
            Filing an FIR? Share an incident so the police can use its report, location trail and tamper-proof evidence
            record. Nothing is shared until you confirm with your SOS PIN.
          </Text>
          <ScrollView style={{ marginTop: 10, maxHeight: 380 }}>
            {!alerts && !error && <ActivityIndicator color={colors.brandAccent} style={{ marginVertical: 20 }} />}
            {error && <Text style={[typography.bodySmall, { color: colors.sosPrimary }]}>{error}</Text>}
            {alerts?.length === 0 && <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>No incidents yet.</Text>}
            {alerts?.map((a) => (
              <View key={a.id} style={[styles.row, { borderColor: colors.borderSubtle }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {a.trigger_type.replace(/_/g, ' ').toLowerCase()} · {a.state.toLowerCase()}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>{when(a.started_at)}</Text>
                </View>
                {a.fir_consent_at ? (
                  <Text style={[typography.caption, { color: colors.statusSuccessText, fontWeight: '700' }]}>Shared for FIR</Text>
                ) : (
                  <TouchableOpacity onPress={() => setSharing(a)} style={[styles.share, { borderColor: colors.brandAccent }]}
                    accessibilityRole="button" accessibilityLabel="Share this incident with police for an FIR">
                    <Text style={[typography.caption, { color: colors.brandAccent, fontWeight: '700' }]}>Share for FIR</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
      <PinPromptModal
        visible={sharing !== null}
        title="Share with police"
        message="The police can then use this incident's report, location trail and evidence record for an FIR. Enter your SOS PIN to confirm."
        confirmLabel="Share"
        onSubmit={async (pin) => {
          if (!sharing) return null;
          const err = await consentFir(sharing.id, pin);
          if (err) return err;
          setSharing(null);
          load();
          return null;
        }}
        onDismiss={() => setSharing(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 400, borderWidth: 1, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  share: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
});

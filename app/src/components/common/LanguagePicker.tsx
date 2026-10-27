import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { LANGUAGES, useI18n } from '../../i18n';

interface LanguagePickerProps {
  visible: boolean;
  onClose: () => void;
}

/** Bottom sheet listing each language in its own script. */
export default function LanguagePicker({ visible, onClose }: LanguagePickerProps) {
  const { colors, typography, radii } = useTheme();
  const { lang, setLang, t } = useI18n();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[typography.h3, { color: colors.textPrimary }]}>{t('lang.title')}</Text>
        <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>{t('lang.subtitle')}</Text>

        <ScrollView style={styles.list} contentContainerStyle={styles.grid}>
          {LANGUAGES.map((l) => {
            const on = l.code === lang;
            return (
              <TouchableOpacity
                key={l.code}
                onPress={() => { setLang(l.code); onClose(); }}
                style={[styles.option, {
                  borderColor: on ? colors.brandAccent : colors.border,
                  backgroundColor: on ? colors.surfaceSecondary : colors.surface,
                  borderRadius: radii.md,
                }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${l.native}, ${l.english}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.native, { color: colors.textPrimary }]}>{l.native}</Text>
                  <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{l.english}</Text>
                </View>
                {on && <Ionicons name="checkmark-circle" size={22} color={colors.brandAccent} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={[typography.bodySmall, { color: colors.textMuted, textAlign: 'center', marginTop: 8 }]}>{t('lang.note')}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { padding: 20, paddingBottom: 28, maxHeight: '80%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  list: { marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  option: { width: '48.5%', flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10 },
  native: { fontSize: 17, lineHeight: 26, fontWeight: '700' },
});

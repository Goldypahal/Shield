import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Modal, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useI18n } from '../../i18n';
import { NavPlace, searchPlaces, resolvePlace, navErrorMessage } from '../../services/navService';
import type { LatLon } from '../../services/routeService';

interface PlaceSearchProps {
  visible: boolean;
  title: string;
  near: LatLon | null;
  /** Offer "My location" as the first result (for the start field). */
  allowMyLocation: boolean;
  onPick: (place: NavPlace | 'me') => void;
  onClose: () => void;
}

/** Full-screen search over every place in India, with results as you type. */
export default function PlaceSearch({ visible, title, near, allowMyLocation, onPick, onClose }: PlaceSearchProps) {
  const { colors, typography, radii } = useTheme();
  const { t, lang, textAlign } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NavPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (visible) { setQ(''); setResults([]); setError(null); }
  }, [visible]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); setBusy(false); return; }
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const places = await searchPlaces(query, near, lang);
        if (id === seq.current) { setResults(places); setError(null); }
      } catch (e) {
        if (id === seq.current) setError(navErrorMessage(e) ?? t('nav.error'));
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const pick = async (p: NavPlace) => {
    try {
      onPick(await resolvePlace(p));
    } catch (e) {
      setError(navErrorMessage(e) ?? t('nav.error'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.bar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder={`${title} · ${t('nav.searchPlaceholder')}`}
            placeholderTextColor={colors.textMuted}
            style={[typography.bodyLarge, styles.input, { color: colors.textPrimary, textAlign }]}
            returnKeyType="search"
            accessibilityLabel={title}
          />
          {busy ? <ActivityIndicator color={colors.brandAccent} /> : q ? (
            <TouchableOpacity onPress={() => setQ('')} style={styles.iconBtn} accessibilityLabel={t('common.close')}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <FlatList
          data={results}
          keyExtractor={(p, i) => `${p.place_id ?? `${p.lat},${p.lon}`}-${i}`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {allowMyLocation && (
                <TouchableOpacity style={styles.row} onPress={() => onPick('me')} accessibilityRole="button">
                  <View style={[styles.rowIcon, { backgroundColor: '#DBEAFE' }]}>
                    <Ionicons name="locate" size={20} color="#2563EB" />
                  </View>
                  <Text style={[typography.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{t('nav.myLocation')}</Text>
                </TouchableOpacity>
              )}
              {error && <Text style={[typography.bodyMedium, { color: colors.sosPrimary, padding: 16 }]}>{error}</Text>}
              {!busy && !error && q.trim().length >= 2 && results.length === 0 && (
                <Text style={[typography.bodyMedium, { color: colors.textMuted, padding: 16 }]}>{t('nav.noResults')}</Text>
              )}
            </>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.row, { borderBottomColor: colors.borderSubtle }]} onPress={() => pick(item)} accessibilityRole="button">
              <View style={[styles.rowIcon, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyLarge, { color: colors.textPrimary, fontWeight: '600', textAlign }]} numberOfLines={1}>{item.name}</Text>
                {!!item.address && (
                  <Text style={[typography.bodySmall, { color: colors.textSecondary, textAlign }]} numberOfLines={2}>{item.address}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <Text style={[typography.bodySmall, { color: colors.textMuted, padding: 16, textAlign: 'center' }]}>{t('nav.longPressTip')}</Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1 },
  iconBtn: { padding: 8 },
  input: { flex: 1, paddingVertical: 10, outlineWidth: 0 } as any,
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});

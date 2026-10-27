import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, SectionList, StyleSheet, SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';
import AppHeader from '../components/common/AppHeader';
import HelplineRow, { callNumber } from '../components/common/HelplineRow';
import { HELPLINES, HELPLINE_CATEGORIES, HelplineCategory } from '../data/helplines';
import { NearbyPolice, nearbyPolice } from '../services/policeService';
import { formatDistance } from '../services/routeService';

interface HelplinesScreenProps {
  onBack: () => void;
  initialCategory?: HelplineCategory;
}

/** Every nationwide helpline, grouped by who it helps, with a filter and search. */
export default function HelplinesScreen({ onBack, initialCategory }: HelplinesScreenProps) {
  const { colors, typography, radii } = useTheme();
  const { t, textAlign } = useI18n();
  const [category, setCategory] = useState<HelplineCategory | 'all'>(initialCategory ?? 'all');
  const [query, setQuery] = useState('');
  const [police, setPolice] = useState<NearbyPolice | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) setPolice(await nearbyPolice(pos.coords.latitude, pos.coords.longitude));
      } catch {
        // Offline or no location: the national numbers below still work
      }
    })();
  }, []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return HELPLINE_CATEGORIES
      .filter((c) => category === 'all' || c.key === category)
      .map((c) => ({
        key: c.key,
        title: t(c.label),
        icon: c.icon,
        data: HELPLINES.filter((h) => h.category === c.key).filter((h) =>
          !q || h.number.includes(q) || t(h.name).toLowerCase().includes(q) || t(h.description).toLowerCase().includes(q)),
      }))
      .filter((s) => s.data.length > 0);
  }, [category, query, t]);

  const chip = (key: HelplineCategory | 'all', label: string) => {
    const on = category === key;
    return (
      <TouchableOpacity
        key={key}
        onPress={() => setCategory(key)}
        style={[styles.chip, { borderColor: on ? colors.brandAccent : colors.border, backgroundColor: on ? colors.brandAccent : colors.surface }]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <Text style={[typography.bodyMedium, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '600' }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title={t('helplines.title')} showBack onBack={onBack} />

      <View style={styles.top}>
        <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign }]}>{t('helplines.subtitle')}</Text>
        <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, borderRadius: radii.md }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('helplines.search')}
            placeholderTextColor={colors.textMuted}
            style={[typography.bodyLarge, styles.searchInput, { color: colors.textPrimary, textAlign }]}
            accessibilityLabel={t('helplines.search')}
          />
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chip('all', t('helplines.all'))}
          {HELPLINE_CATEGORIES.map((c) => chip(c.key, t(c.label)))}
        </ScrollView>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={police?.station ? (
          <TouchableOpacity
            disabled={!police.station.phone}
            onPress={() => police.station?.phone && callNumber(police.station.phone)}
            style={[styles.police, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.md }]}
            accessibilityRole="button"
          >
            <Ionicons name="shield" size={18} color={colors.brandAccent} />
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1, textAlign }]} numberOfLines={2}>
              {t('helplines.nearestPolice', { name: police.station.name, distance: formatDistance(police.station.distance_m) })}
            </Text>
            {police.station.phone ? <Ionicons name="call" size={18} color={colors.brandAccent} /> : null}
          </TouchableOpacity>
        ) : null}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name={section.icon as any} size={18} color={colors.brandAccent} />
              <Text style={[typography.h4, { color: colors.textPrimary }]}>{section.title}</Text>
            </View>
            {section.key === 'men' && (
              <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4, textAlign }]}>{t('helplines.menNote')}</Text>
            )}
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={[styles.rowWrap, { backgroundColor: colors.surface, borderColor: colors.border },
            index === 0 && styles.firstRow, index === section.data.length - 1 && styles.lastRow]}>
            <HelplineRow helpline={item} last={index === section.data.length - 1} />
          </View>
        )}
        ListEmptyComponent={
          <Text style={[typography.bodyMedium, { color: colors.textMuted, textAlign: 'center', marginTop: 40 }]}>{t('helplines.empty')}</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, outlineWidth: 0 } as any,
  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  police: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 6 },
  sectionHeader: { paddingTop: 16, paddingBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowWrap: { paddingHorizontal: 14, borderLeftWidth: 1, borderRightWidth: 1 },
  firstRow: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  lastRow: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
});

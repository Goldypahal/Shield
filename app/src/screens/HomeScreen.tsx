import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';
import AuthService from '../services/authService';
import ContactService from '../services/contactService';
import { getDiscreetSettings, onDiscreetSettingsChange, DiscreetSettings } from '../services/discreetSettings';
import { getActiveSos, stopActiveSos } from '../services/sosSession';
import { EmergencyContact } from '../types';
import { HELPLINES, HOME_HELPLINE_IDS } from '../data/helplines';
import HelplineRow from '../components/common/HelplineRow';
import LanguagePicker from '../components/common/LanguagePicker';
import PinPromptModal from '../components/common/PinPromptModal';
import CheckinCard from '../components/home/CheckinCard';
import VoiceEmergencyBanner from '../components/home/VoiceEmergencyBanner';
import { screamDetectionAvailable } from '../hooks/useScreamTrigger';

interface HomeScreenProps {
  onNavigate: (destination: string) => void;
}

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Safety dashboard. Maps and route planning live on the Routes tab; Home answers
 * "am I protected?" and puts help (SOS state, helplines, guardians, tools) one tap away.
 */
export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const { colors, typography, radii, isDark } = useTheme();
  const { t, language, textAlign } = useI18n();
  const [name, setName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [discreet, setDiscreet] = useState<DiscreetSettings | null>(null);
  const [locationOk, setLocationOk] = useState<boolean | null>(null);
  const [sosActive, setSosActive] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [langVisible, setLangVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const checkinY = useRef(0);

  const refreshSos = useCallback(() => {
    getActiveSos().then((a) => setSosActive(!!a && !a.silent)).catch(() => undefined);
  }, []);

  useEffect(() => {
    AuthService.ensureSession().then((s) => setName(s?.name?.split(' ')[0] || null)).catch(() => undefined);
    ContactService.listContacts().then(setContacts).catch(() => setContacts([]));
    getDiscreetSettings().then(setDiscreet).catch(() => undefined);
    Location.getForegroundPermissionsAsync().then((p) => setLocationOk(p.granted)).catch(() => setLocationOk(null));
    refreshSos();
    const unsub = onDiscreetSettingsChange(setDiscreet);
    const poll = setInterval(refreshSos, 5000); // an SOS can start from scream, shake or the navbar
    return () => { unsub(); clearInterval(poll); };
  }, [refreshSos]);

  const guardianCount = contacts?.length ?? 0;
  // on: true = good, false = needs attention, null = unknown or optional-and-off (grey)
  const statusItems: { label: string; on: boolean | null; value: string }[] = [
    { label: t('home.status.scream'), on: discreet ? discreet.screamToSos && screamDetectionAvailable : null, value: discreet?.screamToSos && screamDetectionAvailable ? t('common.on') : t('common.off') },
    { label: t('home.status.location'), on: locationOk, value: locationOk ? t('home.status.allowed') : t('home.status.blocked') },
    { label: t('home.status.guardians'), on: contacts ? guardianCount > 0 : null, value: String(guardianCount) },
    { label: t('home.status.shake'), on: discreet?.shakeToSos ? true : null, value: discreet?.shakeToSos ? t('common.on') : t('common.off') },
  ];
  // Shake is optional, so it does not count against "all on"
  const allOn = statusItems.slice(0, 3).every((s) => s.on);

  const actions: { icon: IconName; title: string; sub: string; tint: string; onPress: () => void }[] = [
    { icon: 'navigate', title: t('home.actions.route'), sub: t('home.actions.routeSub'), tint: '#2563EB', onPress: () => onNavigate('SafeRoutes') },
    { icon: 'people', title: t('home.actions.guardians'), sub: t('home.actions.guardiansSub'), tint: '#059669', onPress: () => onNavigate('Contacts') },
    { icon: 'call', title: t('home.actions.fakeCall'), sub: t('home.actions.fakeCallSub'), tint: '#7C3AED', onPress: () => onNavigate('FakeCall') },
    { icon: 'timer', title: t('home.actions.checkin'), sub: t('home.actions.checkinSub'), tint: '#D97706',
      onPress: () => scrollRef.current?.scrollTo({ y: checkinY.current - 12, animated: true }) },
  ];

  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg };
  const sectionTitle = (text: string, right?: React.ReactNode) => (
    <View style={styles.sectionHeader}>
      <Text style={[typography.h4, { color: colors.textPrimary, textAlign }]}>{text}</Text>
      {right}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Greeting + language */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.h2, { color: colors.textPrimary, textAlign }]} numberOfLines={1}>
              {name ? t('home.greeting', { name }) : t('home.greetingNoName')}
            </Text>
            <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign }]}>{t('home.subtitle')}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setLangVisible(true)}
            style={[styles.langButton, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
            accessibilityRole="button"
            accessibilityLabel={`${t('lang.title')}: ${language.english}`}
          >
            <Ionicons name="language" size={18} color={colors.brandAccent} />
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>{language.native}</Text>
          </TouchableOpacity>
        </View>

        {/* Active SOS */}
        {sosActive && (
          <View style={[styles.sosBanner, { backgroundColor: colors.sosPrimary, borderRadius: radii.lg }]}>
            <Ionicons name="warning" size={26} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={[typography.h4, { color: '#FFFFFF' }]}>{t('home.sosActive.title')}</Text>
              <Text style={[typography.bodySmall, { color: 'rgba(255,255,255,0.9)' }]}>{t('home.sosActive.body')}</Text>
            </View>
            <TouchableOpacity onPress={() => setPinVisible(true)} style={styles.sosBannerButton} accessibilityRole="button">
              <Text style={[typography.button, { color: colors.sosPrimary }]}>{t('home.sosActive.stop')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Emergency Voice Activation Banner */}
        <VoiceEmergencyBanner />

        {/* Protection status */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onNavigate('Settings')}
          style={[styles.statusCard, card, { borderWidth: 1 }]}
          accessibilityRole="button"
        >
          <View style={styles.statusTop}>
            <View style={[styles.statusIcon, { backgroundColor: allOn ? colors.statusSuccessBg : colors.statusWarningBg }]}>
              <Ionicons name={allOn ? 'shield-checkmark' : 'shield-outline'} size={26} color={allOn ? colors.statusSuccess : colors.statusWarning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }]}>
                {t('home.status.title')}
              </Text>
              <Text style={[typography.h4, { color: colors.textPrimary, textAlign }]}>
                {allOn ? t('home.status.allOn') : t('home.status.someOff')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </View>
          <View style={styles.statusGrid}>
            {statusItems.map((s) => (
              <View key={s.label} style={[styles.statusItem, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.md }]}>
                <View style={[styles.dot, { backgroundColor: s.on === null ? colors.textMuted : s.on ? colors.statusSuccess : colors.statusWarning }]} />
                <Text style={[typography.bodySmall, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>{s.label}</Text>
                <Text style={[typography.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]}>{s.value}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        {/* Quick actions */}
        {sectionTitle(t('home.actions.title'))}
        <View style={styles.actionsGrid}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.title}
              onPress={a.onPress}
              style={[styles.action, card, { borderWidth: 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`${a.title}. ${a.sub}`}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${a.tint}1A` }]}>
                <Ionicons name={a.icon} size={22} color={a.tint} />
              </View>
              <Text style={[typography.bodyLarge, { color: colors.textPrimary, fontWeight: '700', textAlign }]} numberOfLines={1}>{a.title}</Text>
              <Text style={[typography.bodySmall, { color: colors.textSecondary, textAlign }]} numberOfLines={2}>{a.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Helplines */}
        {sectionTitle(t('home.helplines.title'))}
        <View style={[styles.listCard, card, { borderWidth: 1 }]}>
          {HOME_HELPLINE_IDS.map((id, i) => {
            const h = HELPLINES.find((x) => x.id === id)!;
            return <HelplineRow key={id} helpline={h} compact last={i === HOME_HELPLINE_IDS.length - 1} />;
          })}
        </View>
        <TouchableOpacity
          onPress={() => onNavigate('Helplines')}
          style={[styles.allButton, { borderColor: colors.brandAccent, borderRadius: radii.md }]}
          accessibilityRole="button"
        >
          <Ionicons name="list" size={18} color={colors.brandAccent} />
          <Text style={[typography.button, { color: colors.brandAccent }]}>
            {t('home.helplines.all', { count: new Set(HELPLINES.map((h) => h.number)).size })}
          </Text>
        </TouchableOpacity>

        {/* Guardians */}
        {sectionTitle(t('home.guardians.title'), guardianCount > 0 ? (
          <TouchableOpacity onPress={() => onNavigate('Contacts')} accessibilityRole="button">
            <Text style={[typography.button, { color: colors.brandAccent }]}>{t('home.guardians.manage')}</Text>
          </TouchableOpacity>
        ) : undefined)}
        {guardianCount > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.guardians}>
            {contacts!.map((c) => (
              <View key={c.id} style={styles.guardian}>
                <View style={[styles.avatar, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <Text style={[typography.h4, { color: colors.brandAccent }]}>{c.name.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={[typography.bodySmall, { color: colors.textPrimary, maxWidth: 72 }]} numberOfLines={1}>{c.name}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => onNavigate('Contacts')} style={styles.guardian} accessibilityRole="button" accessibilityLabel={t('home.guardians.add')}>
              <View style={[styles.avatar, styles.addAvatar, { borderColor: colors.brandAccent }]}>
                <Ionicons name="add" size={24} color={colors.brandAccent} />
              </View>
              <Text style={[typography.bodySmall, { color: colors.brandAccent, textAlign: 'center' }]} numberOfLines={2}>{t('home.guardians.add')}</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : contacts ? (
          <View style={[styles.emptyGuardians, { backgroundColor: colors.statusWarningBg, borderRadius: radii.lg }]}>
            <Ionicons name="people" size={22} color={colors.statusWarning} />
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1, textAlign }]}>{t('home.guardians.empty')}</Text>
            <TouchableOpacity onPress={() => onNavigate('Contacts')} style={[styles.smallButton, { backgroundColor: colors.brandAccent }]} accessibilityRole="button">
              <Text style={[typography.button, { color: '#FFFFFF' }]}>{t('home.guardians.add')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Check-in timer */}
        <View onLayout={(e) => { checkinY.current = e.nativeEvent.layout.y; }} style={{ marginTop: 24 }}>
          <CheckinCard style={{ marginHorizontal: 0, marginTop: 0 }} />
        </View>
      </ScrollView>

      <LanguagePicker visible={langVisible} onClose={() => setLangVisible(false)} />
      <PinPromptModal
        visible={pinVisible}
        title={t('sos.pinTitleActive')}
        message={t('sos.pinMsgActive')}
        confirmLabel={t('sos.stopSos')}
        dismissLabel={t('sos.back')}
        onSubmit={async (pin) => {
          const r = await stopActiveSos(pin);
          if ('message' in r) return r.message;
          setPinVisible(false);
          refreshSos();
          return null;
        }}
        onDismiss={() => setPinVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  langButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  sosBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 16 },
  sosBannerButton: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusCard: { padding: 14 },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 12 },
  statusItem: { width: '48.8%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  action: { width: '48.8%', padding: 12, gap: 2 },
  actionIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  listCard: { paddingHorizontal: 14 },
  allButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, paddingVertical: 12, marginTop: 10 },
  guardians: { gap: 14, paddingVertical: 2 },
  guardian: { alignItems: 'center', gap: 6, width: 76 },
  avatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addAvatar: { borderStyle: 'dashed', borderWidth: 1.5 },
  emptyGuardians: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, flexWrap: 'wrap' },
  smallButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
});

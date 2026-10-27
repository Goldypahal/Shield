import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Switch, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { getVoiceState, onVoiceState, VoiceState, MicState, calibrateVoice } from '../../services/voiceMonitor';
import { getDiscreetSettings, onDiscreetSettingsChange, updateDiscreetSettings, DiscreetSettings, triggerLevelDb } from '../../services/discreetSettings';
import { keywordDetectionAvailable } from '../../hooks/useKeywordTrigger';
import { CRY_REQUIRED_MS } from './voiceBannerShared';

const SCALE_MIN = 30;
const SCALE_MAX = 100;
const pct = (db: number) => Math.max(0, Math.min(100, ((db - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));

const MIC_LABEL: Record<MicState, string> = {
  off: 'off', starting: 'starting...', on: 'on', silenced: 'mic shared', denied: 'no permission', unavailable: 'not on this phone', error: 'error',
};

/**
 * Voice SOS on phones: live loudness meter on a dB scale with the trigger line (normal
 * speaking level + 15 %), what the recogniser heard, scream progress, and voice
 * calibration. Everything shown here is what actually decides an SOS.
 */
export default function NativeVoiceBanner() {
  const { colors, radii, isDark } = useTheme();
  const [v, setV] = useState<VoiceState>(getVoiceState());
  const [d, setD] = useState<DiscreetSettings | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const a = onVoiceState(setV);
    getDiscreetSettings().then(setD).catch(() => undefined);
    const b = onDiscreetSettingsChange(setD);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.35, duration: 800, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { a(); b(); loop.stop(); };
  }, [pulse]);

  const on = !!d && (d.screamToSos || d.keywordToSos);
  const listening = v.scream === 'on' || v.keywords === 'on' || v.scream === 'silenced';
  const denied = v.scream === 'denied' || v.keywords === 'denied';
  const triggerDb = d ? triggerLevelDb(d) : v.triggerDb;
  const loud = v.levelDb >= triggerDb;
  const fresh = v.match && Date.now() - v.match.at < 8000 ? v.match : null;

  const toggle = (next: boolean) => {
    updateDiscreetSettings({ screamToSos: next, keywordToSos: next }).catch(() => undefined);
  };
  const changeRaise = (delta: number) => {
    if (!d) return;
    const next = Math.max(5, Math.min(60, d.voiceRaisePct + delta));
    updateDiscreetSettings({ voiceRaisePct: next }).catch(() => undefined);
  };
  const calibrate = async () => {
    setCalibrating(true);
    await calibrateVoice(5000);
    setCalibrating(false);
  };

  const bg = listening ? (isDark ? '#052E1F' : '#ECFDF5') : (isDark ? '#1E293B' : '#F8FAFC');
  const border = listening ? '#10B981' : (isDark ? '#334155' : '#CBD5E1');
  const text = isDark ? '#E2E8F0' : '#0F172A';
  const sub = isDark ? '#94A3B8' : '#475569';

  return (
    <View style={[styles.card, { backgroundColor: bg, borderColor: border, borderRadius: radii.lg }]}>
      <View style={styles.row}>
        <Animated.View style={[styles.dot, { backgroundColor: listening ? '#10B981' : '#94A3B8', transform: [{ scale: listening ? pulse : 1 }] }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: text }]}>Voice SOS</Text>
          <Text style={[styles.sub, { color: sub }]} numberOfLines={2}>
            {!on ? 'Off. Turn on to listen for screams and cries for help.'
              : denied ? 'Microphone permission is off.'
              : listening ? 'Listening on your phone. Nothing is recorded or sent.'
              : 'Starting the microphone...'}
          </Text>
        </View>
        <Switch value={on} onValueChange={toggle} trackColor={{ true: '#10B981', false: '#94A3B8' }} thumbColor="#FFFFFF"
          accessibilityLabel="Voice SOS on or off" />
      </View>

      {on && denied && (
        <TouchableOpacity onPress={() => Linking.openSettings()} style={[styles.button, { backgroundColor: '#DC2626' }]} accessibilityRole="button">
          <Ionicons name="mic" size={16} color="#FFFFFF" />
          <Text style={styles.buttonText}>Allow microphone in Settings</Text>
        </TouchableOpacity>
      )}

      {on && !denied && (
        <>
          {/* Meter: 30-100 dB, trigger line at normal voice + raise % */}
          <View style={styles.meterHead}>
            <Text style={[styles.meterNow, { color: loud ? '#DC2626' : text }]}>{v.levelDb ? `${Math.round(v.levelDb)} dB` : '-- dB'}</Text>
            <Text style={[styles.sub, { color: sub }]}>room {Math.round(v.floorDb)} dB  ·  your voice {Math.round(v.baselineDb)} dB</Text>
          </View>
          <View style={[styles.track, { backgroundColor: isDark ? '#0F172A' : '#E2E8F0' }]}>
            <View style={[styles.floor, { width: `${pct(v.floorDb)}%` }]} />
            <View style={[styles.fill, { width: `${Math.max(1, pct(v.levelDb))}%`, backgroundColor: loud ? '#DC2626' : v.levelDb >= v.baselineDb ? '#F59E0B' : '#10B981' }]} />
            <View style={[styles.mark, { left: `${pct(v.baselineDb)}%`, backgroundColor: '#2563EB' }]} />
            <View style={[styles.mark, styles.triggerMark, { left: `${pct(triggerDb)}%` }]} />
          </View>
          <View style={styles.legend}>
            <Text style={[styles.legendText, { color: '#2563EB' }]}>▍normal voice</Text>
            <Text style={[styles.legendText, { color: '#DC2626' }]}>▍SOS at {Math.round(triggerDb)} dB (+{d?.voiceRaisePct ?? 15}%)</Text>
          </View>

          {v.crySustainedMs > 0 && (
            <View style={[styles.notice, { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}>
              <Ionicons name="warning" size={16} color="#DC2626" />
              <Text style={[styles.noticeText, { color: '#991B1B' }]}>
                Scream detected {(v.crySustainedMs / 1000).toFixed(1)} / {(CRY_REQUIRED_MS / 1000).toFixed(1)} s
              </Text>
            </View>
          )}

          <View style={[styles.heard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF', borderColor: fresh ? (fresh.loud ? '#EF4444' : '#F59E0B') : (isDark ? '#334155' : '#CBD5E1') }]}>
            <Ionicons name={fresh ? 'alert-circle' : 'ear-outline'} size={16} color={fresh ? (fresh.loud ? '#DC2626' : '#D97706') : sub} />
            <Text style={[styles.heardText, { color: text }]} numberOfLines={2}>
              {fresh ? (fresh.loud ? `"${fresh.phrase}" - SOS starting` : v.note) : v.heard ? `Heard: "${v.heard}"` : keywordDetectionAvailable ? 'Say "help", "bachao" or "call the police" loudly, or scream for 3 s.' : 'Scream or shout for 3 s to start an SOS.'}
            </Text>
          </View>

          {v.note && !fresh && (
            <Text style={[styles.note, { color: sub }]}>{v.note}</Text>
          )}

          <View style={styles.chips}>
            <Text style={[styles.chip, { color: sub, borderColor: border }]}>Keywords: {MIC_LABEL[v.keywords]}</Text>
            <Text style={[styles.chip, { color: sub, borderColor: border }]}>Scream: {MIC_LABEL[v.scream]}</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity onPress={calibrate} disabled={calibrating || !listening} style={[styles.button, { backgroundColor: listening ? '#2563EB' : '#94A3B8', flex: 1 }]} accessibilityRole="button">
              {calibrating ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="pulse" size={16} color="#FFFFFF" />}
              <Text style={styles.buttonText}>{calibrating ? 'Speak normally...' : 'Calibrate my voice'}</Text>
            </TouchableOpacity>
            <View style={[styles.stepper, { borderColor: border }]}>
              <TouchableOpacity onPress={() => changeRaise(-5)} style={styles.stepBtn} accessibilityLabel="Lower the trigger level"><Text style={[styles.stepText, { color: text }]}>−</Text></TouchableOpacity>
              <Text style={[styles.stepValue, { color: text }]}>+{d?.voiceRaisePct ?? 15}%</Text>
              <TouchableOpacity onPress={() => changeRaise(5)} style={styles.stepBtn} accessibilityLabel="Raise the trigger level"><Text style={[styles.stepText, { color: text }]}>+</Text></TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, padding: 14, marginBottom: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12 },
  meterHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  meterNow: { fontSize: 22, fontWeight: '800' },
  track: { height: 14, borderRadius: 7, overflow: 'hidden', position: 'relative' },
  floor: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(100,116,139,0.35)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7 },
  mark: { position: 'absolute', top: -2, bottom: -2, width: 3 },
  triggerMark: { backgroundColor: '#DC2626', width: 4 },
  legend: { flexDirection: 'row', justifyContent: 'space-between' },
  legendText: { fontSize: 11, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, padding: 8 },
  noticeText: { fontSize: 13, fontWeight: '700' },
  heard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  heardText: { flex: 1, fontSize: 13, fontWeight: '600' },
  note: { fontSize: 12 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { fontSize: 11, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  stepText: { fontSize: 18, fontWeight: '800' },
  stepValue: { fontSize: 13, fontWeight: '800', minWidth: 42, textAlign: 'center' },
});

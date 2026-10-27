import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Vibration,
  Alert as RNAlert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useTheme } from '../theme';
import AppHeader from '../components/common/AppHeader';
import {
  FakeCallSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  startVoiceRecording,
  stopVoiceRecording,
  deleteVoiceRecording,
  startRingtone,
  playCallerVoice,
  setSpeaker,
} from '../services/fakeCallService';

interface FakeCallScreenProps {
  onBack: () => void;
  /** True while the call is ringing or in progress, so the app shell can hide the navbar. */
  onActiveChange?: (active: boolean) => void;
}

type Phase = 'setup' | 'waiting' | 'ringing' | 'in_call';

const QUICK_CALLERS = ['Mom', 'Dad'];
const DELAYS: Array<{ label: string; seconds: number }> = [
  { label: 'Now', seconds: 3 },
  { label: '10 s', seconds: 10 },
  { label: '30 s', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '5 min', seconds: 300 },
];
const RING_TIMEOUT_MS = 45000; // unanswered calls stop ringing, like a real one
const VIBRATION_PATTERN = [0, 1000, 1000];

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FakeCallScreen({ onBack, onActiveChange }: FakeCallScreenProps) {
  const { colors, typography, isDark, radii } = useTheme();
  const [settings, setSettings] = useState<FakeCallSettings>(DEFAULT_SETTINGS);
  const [phase, setPhase] = useState<Phase>('setup');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [muted, setMuted] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRingRef = useRef<(() => Promise<void>) | null>(null);
  const voiceRef = useRef<Audio.Sound | null>(null);
  const previewRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // The screen-switcher bar would break the illusion of an incoming call
  useEffect(() => {
    onActiveChange?.(phase === 'ringing' || phase === 'in_call');
  }, [phase, onActiveChange]);

  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  const update = (patch: Partial<FakeCallSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next).catch(() => undefined);
      return next;
    });
  };

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    timerRef.current = null;
    ringTimeoutRef.current = null;
  };

  const stopRinging = useCallback(async () => {
    Vibration.cancel();
    if (stopRingRef.current) {
      const stop = stopRingRef.current;
      stopRingRef.current = null;
      await stop();
    }
  }, []);

  const stopVoice = async () => {
    for (const ref of [voiceRef, previewRef]) {
      if (ref.current) {
        const sound = ref.current;
        ref.current = null;
        try { await sound.stopAsync(); await sound.unloadAsync(); } catch { /* already gone */ }
      }
    }
  };

  // Clean up audio, vibration and timers if the screen is left mid-call
  useEffect(() => () => {
    clearTimers();
    stopRinging();
    stopVoice();
  }, [stopRinging]);

  // --- Recording the "other side" -----------------------------------------

  const toggleRecording = async () => {
    try {
      if (isRecording) {
        clearTimers();
        setIsRecording(false);
        const uri = await stopVoiceRecording();
        if (uri) update({ recordingUri: uri });
      } else {
        await stopVoice();
        await startVoiceRecording();
        setIsRecording(true);
        setRecordSeconds(0);
        timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      }
    } catch (e: any) {
      clearTimers();
      setIsRecording(false);
      RNAlert.alert('Recording failed', e?.message || 'Could not access the microphone.');
    }
  };

  const previewRecording = async () => {
    if (!settings.recordingUri) return;
    await stopVoice();
    previewRef.current = await playCallerVoice(settings.recordingUri, true);
  };

  const removeRecording = async () => {
    await stopVoice();
    await deleteVoiceRecording(settings.recordingUri);
    update({ recordingUri: null });
  };

  // --- Call flow ------------------------------------------------------------

  const ring = async () => {
    clearTimers();
    setPhase('ringing');
    Vibration.vibrate(VIBRATION_PATTERN, true);
    stopRingRef.current = await startRingtone();
    ringTimeoutRef.current = setTimeout(() => {
      stopRinging();
      setPhase('setup');
    }, RING_TIMEOUT_MS);
  };

  const scheduleCall = async () => {
    const name = settings.callerName.trim();
    if (!name) {
      RNAlert.alert('Who is calling?', 'Type a name or pick Mom or Dad.');
      return;
    }
    if (isRecording) await toggleRecording();
    await stopVoice();
    setSecondsLeft(settings.delaySeconds);
    setPhase('waiting');
    let left = settings.delaySeconds;
    timerRef.current = setInterval(() => {
      left -= 1;
      setSecondsLeft(left);
      if (left <= 0) ring();
    }, 1000);
  };

  const cancelScheduled = () => {
    clearTimers();
    setPhase('setup');
  };

  const answer = async () => {
    clearTimers();
    await stopRinging();
    setCallSeconds(0);
    setSpeakerOn(false);
    setMuted(false);
    setPhase('in_call');
    timerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    if (settings.recordingUri) {
      // A short pause before "they" speak, as on a real call
      setTimeout(async () => {
        voiceRef.current = await playCallerVoice(settings.recordingUri as string, false);
      }, 1200);
    }
  };

  const decline = async () => {
    clearTimers();
    await stopRinging();
    setPhase('setup');
  };

  const endCall = async () => {
    clearTimers();
    await stopVoice();
    setPhase('setup');
  };

  const toggleSpeaker = async () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    await setSpeaker(next);
  };

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    if (voiceRef.current) {
      try { await voiceRef.current.setIsMutedAsync(next); } catch { /* sound finished */ }
    }
  };

  const initial = (settings.callerName.trim()[0] || '?').toUpperCase();

  // --- Incoming call --------------------------------------------------------

  if (phase === 'ringing') {
    return (
      <SafeAreaView style={styles.callContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0F14" />
        <View style={styles.callTop}>
          <Text style={styles.callStatus}>Incoming call</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.callName} numberOfLines={1}>{settings.callerName.trim()}</Text>
          <Text style={styles.callLabel}>{settings.callerLabel}</Text>
        </View>
        <View style={styles.ringActions}>
          <View style={styles.ringAction}>
            <TouchableOpacity style={[styles.roundBtn, styles.declineBtn]} onPress={decline}
              accessibilityRole="button" accessibilityLabel="Decline call">
              <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
            <Text style={styles.roundLabel}>Decline</Text>
          </View>
          <View style={styles.ringAction}>
            <TouchableOpacity style={[styles.roundBtn, styles.acceptBtn]} onPress={answer}
              accessibilityRole="button" accessibilityLabel="Accept call">
              <Ionicons name="call" size={30} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.roundLabel}>Accept</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- Answered call --------------------------------------------------------

  if (phase === 'in_call') {
    const controls: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; onPress?: () => void }> = [
      { icon: muted ? 'mic-off' : 'mic-off-outline', label: 'Mute', active: muted, onPress: toggleMute },
      { icon: 'keypad-outline', label: 'Keypad' },
      { icon: speakerOn ? 'volume-high' : 'volume-high-outline', label: 'Speaker', active: speakerOn, onPress: toggleSpeaker },
      { icon: 'add-outline', label: 'Add call' },
      { icon: 'videocam-outline', label: 'Video' },
      { icon: 'pause-outline', label: 'Hold' },
    ];
    return (
      <SafeAreaView style={styles.callContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0F14" />
        <View style={styles.callTop}>
          <View style={[styles.avatar, styles.avatarSmall]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.callName} numberOfLines={1}>{settings.callerName.trim()}</Text>
          <Text style={styles.callTimer}>{formatDuration(callSeconds)}</Text>
        </View>
        <View style={styles.controlsGrid}>
          {controls.map((c) => (
            <TouchableOpacity key={c.label} style={styles.control} onPress={c.onPress} activeOpacity={c.onPress ? 0.7 : 1}>
              <View style={[styles.controlCircle, c.active && styles.controlCircleActive]}>
                <Ionicons name={c.icon} size={26} color={c.active ? '#0B0F14' : '#FFFFFF'} />
              </View>
              <Text style={styles.controlLabel}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.endRow}>
          <TouchableOpacity style={[styles.roundBtn, styles.declineBtn]} onPress={endCall}
            accessibilityRole="button" accessibilityLabel="End call">
            <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- Setup and countdown --------------------------------------------------

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? colors.brandAccent : colors.border, backgroundColor: selected ? colors.brandAccent : colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[typography.button, { color: selected ? '#FFFFFF' : colors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <AppHeader title="Fake Call" showBack onBack={onBack} />

      {phase === 'waiting' ? (
        <View style={styles.waitingBox}>
          <Ionicons name="time-outline" size={42} color={colors.brandAccent} />
          <Text style={[typography.h2, { color: colors.textPrimary, marginTop: 12 }]}>
            {settings.callerName.trim()} will call in {secondsLeft}s
          </Text>
          <Text style={[typography.bodyMedium, { color: colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
            Keep SHIELD open. You can put the phone in your pocket; it will ring and vibrate.
          </Text>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
            onPress={cancelScheduled}
          >
            <Text style={[typography.button, { color: colors.textPrimary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginBottom: 16 }]}>
            Get a realistic incoming call to leave an uncomfortable situation. Nothing is dialled and no one is contacted.
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>Who is calling?</Text>
            <View style={styles.chipRow}>
              {QUICK_CALLERS.map((name) => chip(name, settings.callerName === name, () => update({ callerName: name })))}
            </View>
            <TextInput
              value={settings.callerName}
              onChangeText={(text) => update({ callerName: text.slice(0, 40) })}
              placeholder="Or type any name"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
              accessibilityLabel="Caller name"
            />
            <TextInput
              value={settings.callerLabel}
              onChangeText={(text) => update({ callerLabel: text.slice(0, 30) })}
              placeholder="Label, e.g. mobile"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
              accessibilityLabel="Caller label"
            />
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>Ring after</Text>
            <View style={styles.chipRow}>
              {DELAYS.map((d) => chip(d.label, settings.delaySeconds === d.seconds, () => update({ delaySeconds: d.seconds })))}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>Caller's voice (optional)</Text>
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
              Record what the caller says, e.g. "Where are you? Come home right now." It plays when you answer.
            </Text>
            <View style={styles.recordRow}>
              <TouchableOpacity
                style={[styles.recordBtn, { backgroundColor: isRecording ? colors.sosPrimary : colors.brandAccent }]}
                onPress={toggleRecording}
                accessibilityRole="button"
                accessibilityLabel={isRecording ? 'Stop recording' : 'Record caller voice'}
              >
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={20} color="#FFFFFF" />
                <Text style={[typography.button, { color: '#FFFFFF', marginLeft: 6 }]}>
                  {isRecording ? `Stop  ${formatDuration(recordSeconds)}` : settings.recordingUri ? 'Re-record' : 'Record'}
                </Text>
              </TouchableOpacity>
              {settings.recordingUri && !isRecording && (
                <>
                  <TouchableOpacity style={[styles.iconBtn, { borderColor: colors.border }]} onPress={previewRecording}
                    accessibilityLabel="Play recording">
                    <Ionicons name="play" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.iconBtn, { borderColor: colors.border }]} onPress={removeRecording}
                    accessibilityLabel="Delete recording">
                    <Ionicons name="trash-outline" size={20} color={colors.sosPrimary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
            {settings.recordingUri && !isRecording && (
              <Text style={[typography.caption, { color: colors.statusSuccess, marginTop: 8 }]}>Voice saved</Text>
            )}
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.statusSuccess }]} onPress={scheduleCall}
            accessibilityRole="button" accessibilityLabel="Schedule fake call">
            <Ionicons name="call" size={20} color="#FFFFFF" />
            <Text style={[typography.button, { color: '#FFFFFF', marginLeft: 8 }]}>Schedule call</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  card: { borderWidth: 1, padding: 16, marginBottom: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, fontSize: 15 },
  recordRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  recordBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, marginTop: 6 },
  secondaryBtn: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 36, borderRadius: 24, borderWidth: 1 },
  waitingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  callContainer: { flex: 1, backgroundColor: '#0B0F14', justifyContent: 'space-between' },
  callTop: { alignItems: 'center', paddingTop: 70 },
  callStatus: { color: '#9CA3AF', fontSize: 16, marginBottom: 28 },
  avatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  avatarSmall: { width: 84, height: 84, borderRadius: 42 },
  avatarText: { color: '#FFFFFF', fontSize: 44, fontWeight: '300' },
  callName: { color: '#FFFFFF', fontSize: 34, fontWeight: '400', paddingHorizontal: 24 },
  callLabel: { color: '#9CA3AF', fontSize: 17, marginTop: 6 },
  callTimer: { color: '#D1D5DB', fontSize: 18, marginTop: 8, fontVariant: ['tabular-nums'] },
  ringActions: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: 70 },
  ringAction: { alignItems: 'center' },
  roundBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { backgroundColor: '#EF4444' },
  acceptBtn: { backgroundColor: '#22C55E' },
  roundLabel: { color: '#E5E7EB', fontSize: 14, marginTop: 10 },
  controlsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 30 },
  control: { width: '33%', alignItems: 'center', marginBottom: 26 },
  controlCircle: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  controlCircleActive: { backgroundColor: '#F9FAFB' },
  controlLabel: { color: '#E5E7EB', fontSize: 13, marginTop: 8 },
  endRow: { alignItems: 'center', paddingBottom: 60 },
});

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import {
  requestWebMicrophonePermission,
  stopWebMicrophone,
  onVoiceListeningChange,
  onHeardPhrase,
  isVoiceListening,
  triggerVoiceSos,
  getLastHeardPhrase,
  getActiveMediaStream,
} from '../../services/voiceTriggerHelper';

export default function VoiceEmergencyBanner() {
  const { colors, radii, isDark } = useTheme();
  const [listening, setListening] = useState(isVoiceListening());
  const [heardText, setHeardText] = useState(getLastHeardPhrase());
  const [isMatch, setIsMatch] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  // Pulse animation for the listening radar dot
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    const unsubStatus = onVoiceListeningChange((active) => {
      setListening(active);
      if (!active) {
        setAudioLevel(0);
      }
    });

    const unsubPhrase = onHeardPhrase((phrase, matched) => {
      setHeardText(phrase);
      setIsMatch(matched);
      if (matched) {
        setTimeout(() => setIsMatch(false), 4000);
      }
    });

    return () => {
      unsubStatus();
      unsubPhrase();
    };
  }, []);

  // Web Audio decibel level meter & 90% Shouting Trigger
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let animId: number;
    const stream = getActiveMediaStream();
    if (!stream || !listening) {
      setAudioLevel(0);
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let loudFrames = 0;
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = sum / data.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(level);

        // DIRECT TRIGGER: Shouting reaching 90% on the meter
        if (level >= 90) {
          loudFrames += 1;
          if (loudFrames >= 2) { // ~33ms of sustained 90%+ shouting
            console.log(`[VoiceEmergencyBanner] Shouting reached ${level}% (>= 90%) -> TRIGGERING SOS DIRECTLY!`);
            setIsMatch(true);
            setHeardText(`🚨 Loud Shout (${level}%) Detected!`);
            triggerVoiceSos('shouting_meter_90_percent');
            loudFrames = 0;
          }
        } else {
          loudFrames = 0;
        }

        animId = requestAnimationFrame(loop);
      };
      loop();

      return () => {
        cancelAnimationFrame(animId);
        try {
          ctx.close();
        } catch (_) {}
      };
    } catch (_) {}
  }, [listening]);

  const handleToggleMic = async () => {
    if (listening) {
      // User tapped to turn OFF
      stopWebMicrophone();
      setListening(false);
      setAudioLevel(0);
      setMicError(null);
    } else {
      // User tapped to turn ON
      setRequesting(true);
      setMicError(null);
      try {
        const res = await requestWebMicrophonePermission();
        if (res.granted) {
          setListening(true);
          setMicError(null);
        } else {
          setMicError(res.error || 'Permission was denied. Please allow microphone access.');
        }
      } catch (err: any) {
        setMicError(err?.message || 'Failed to start microphone.');
      } finally {
        setRequesting(false);
      }
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: listening
            ? isDark
              ? '#064E3B'
              : '#ECFDF5'
            : isDark
            ? '#1E293B'
            : '#F8FAFC',
          borderColor: listening
            ? isDark
              ? '#059669'
              : '#10B981'
            : isDark
            ? '#334155'
            : '#CBD5E1',
          borderRadius: radii.lg,
        },
      ]}
    >
      {/* Top Header Row with ON / OFF Toggle */}
      <View style={styles.topRow}>
        <View style={styles.statusBadge}>
          <Animated.View
            style={[
              styles.indicatorDot,
              {
                backgroundColor: listening ? '#10B981' : '#94A3B8',
                transform: [{ scale: listening ? pulseAnim : 1 }],
              },
            ]}
          />
          <Text
            style={[
              styles.statusTitle,
              { color: listening ? '#059669' : '#64748B' },
            ]}
          >
            {listening ? 'VOICE & SCREAM DETECTOR (RECORDING)' : 'VOICE LISTENER (OFF)'}
          </Text>
        </View>

        {/* Dedicated ON / OFF Toggle Button */}
        <TouchableOpacity
          onPress={handleToggleMic}
          disabled={requesting}
          style={[
            styles.toggleSwitchBtn,
            {
              backgroundColor: listening ? '#10B981' : '#64748B',
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Voice listening is ${listening ? 'ON' : 'OFF'}. Tap to toggle.`}
        >
          <Ionicons
            name={listening ? 'mic' : 'mic-off'}
            size={14}
            color="#FFFFFF"
          />
          <Text style={styles.toggleSwitchText}>
            {requesting ? 'CONNECTING...' : listening ? 'ON (LISTENING)' : 'OFF (PAUSED)'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {!listening ? (
        <View style={styles.unauthorizedBox}>
          <Text
            style={[
              styles.promptText,
              { color: isDark ? '#CBD5E1' : '#475569' },
            ]}
          >
            Voice listener is currently <Text style={{ fontWeight: '800' }}>OFF</Text>. Turn it ON to continuously listen for{' '}
            <Text style={{ fontWeight: '800', color: '#DC2626' }}>"Help"</Text>,{' '}
            <Text style={{ fontWeight: '800', color: '#DC2626' }}>"Save Me"</Text>,{' '}
            <Text style={{ fontWeight: '800', color: '#DC2626' }}>"Bachao"</Text>, or{' '}
            <Text style={{ fontWeight: '800', color: '#DC2626' }}>Shouting (≥90%)</Text>.
          </Text>

          <TouchableOpacity
            onPress={handleToggleMic}
            disabled={requesting}
            style={styles.bigTurnOnBtn}
            accessibilityRole="button"
            accessibilityLabel="Start Voice Recording"
          >
            <Ionicons name="radio-button-on" size={20} color="#FFFFFF" />
            <Text style={styles.bigTurnOnText}>
              {requesting ? 'Starting Microphone...' : '▶️ Tap to START Voice Listening'}
            </Text>
          </TouchableOpacity>

          {micError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                ⚠️ {micError}
              </Text>
              <Text style={styles.errorSubtext}>
                Check if your browser's site settings have microphone blocked (tap the lock icon in the URL bar).
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.activeBox}>
          <Text
            style={[
              styles.listeningSubtext,
              { color: isDark ? '#A7F3D0' : '#065F46' },
            ]}
          >
            Listening actively. Say distress words or shout into phone:
          </Text>

          {/* Real-time transcript box */}
          <View
            style={[
              styles.transcriptBox,
              {
                backgroundColor: isMatch
                  ? '#FEE2E2'
                  : isDark
                  ? '#022C22'
                  : '#FFFFFF',
                borderColor: isMatch ? '#EF4444' : '#6EE7B7',
              },
            ]}
          >
            <Ionicons
              name={isMatch ? 'alert-circle' : 'ear-outline'}
              size={18}
              color={isMatch ? '#DC2626' : '#059669'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.transcriptLabel}>
                {isMatch
                  ? 'EMERGENCY TRIGGER DETECTED!'
                  : 'Live Microphone Hearing:'}
              </Text>
              <Text
                style={[
                  styles.transcriptValue,
                  {
                    color: isMatch
                      ? '#DC2626'
                      : isDark
                      ? '#F9FAFB'
                      : '#111827',
                  },
                ]}
                numberOfLines={2}
              >
                {heardText
                  ? `"${heardText}"`
                  : 'Say "Help", "Save me", "Bachao", or shout loudly...'}
              </Text>
            </View>
          </View>

          {/* Volume meter bar with 90% threshold line */}
          <View style={styles.meterContainer}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text
                style={[
                  styles.meterLabel,
                  { color: isDark ? '#6EE7B7' : '#047857' },
                ]}
              >
                Audio Meter: {audioLevel}%
              </Text>
              <Text style={[styles.thresholdLabel, { color: audioLevel >= 90 ? '#DC2626' : '#D97706' }]}>
                {audioLevel >= 90 ? '🚨 SHOUT TRIGGERED (≥90%)' : 'Shout Trigger: 90%'}
              </Text>
            </View>

            <View style={styles.meterTrack}>
              <View
                style={[
                  styles.meterFill,
                  {
                    width: `${Math.max(2, audioLevel)}%`,
                    backgroundColor:
                      audioLevel >= 90
                        ? '#DC2626'
                        : audioLevel >= 60
                        ? '#F59E0B'
                        : '#10B981',
                  },
                ]}
              />
              {/* 90% threshold notch */}
              <View style={styles.thresholdNotch} />
            </View>
          </View>

          {/* Trigger Tags */}
          <View style={styles.tagsRow}>
            {['"Help me"', '"Save me"', '"Bachao"', '"Emergency"', 'Shout (≥90%)'].map(
              (tag) => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              )
            )}
          </View>

          {/* Turn Off Button */}
          <TouchableOpacity
            onPress={handleToggleMic}
            style={styles.stopRecordingBtn}
            accessibilityRole="button"
            accessibilityLabel="Stop Voice Recording"
          >
            <Ionicons name="stop-circle" size={16} color="#DC2626" />
            <Text style={styles.stopRecordingText}>
              Turn OFF Microphone
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 10,
    padding: 14,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  toggleSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 5,
  },
  toggleSwitchText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  unauthorizedBox: {
    marginTop: 4,
    gap: 10,
  },
  promptText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  bigTurnOnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    elevation: 2,
  },
  bigTurnOnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
  },
  errorSubtext: {
    color: '#7F1D1D',
    fontSize: 11,
    marginTop: 2,
  },
  activeBox: {
    marginTop: 2,
    gap: 8,
  },
  listeningSubtext: {
    fontSize: 12,
    fontWeight: '600',
  },
  transcriptBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  transcriptLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  transcriptValue: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  meterContainer: {
    marginTop: 4,
  },
  meterLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  thresholdLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  meterTrack: {
    height: 10,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  meterFill: {
    height: '100%',
    borderRadius: 5,
  },
  thresholdNotch: {
    position: 'absolute',
    left: '90%',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#DC2626',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tagPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  stopRecordingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
  },
  stopRecordingText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
});

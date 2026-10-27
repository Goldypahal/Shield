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

  // Web Audio decibel level meter if stream is active
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let animId: number;
    const stream = getActiveMediaStream();
    if (!stream) return;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = sum / data.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
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

  const [micError, setMicError] = useState<string | null>(null);

  const handleActivateMic = async () => {
    setRequesting(true);
    setMicError(null);
    try {
      const res = await requestWebMicrophonePermission();
      if (res.granted) {
        setListening(true);
        setMicError(null);
      } else {
        setMicError(res.error || 'Permission was denied. Please allow microphone in your browser settings.');
      }
    } catch (err: any) {
      setMicError(err?.message || 'Failed to request microphone.');
    } finally {
      setRequesting(false);
    }
  };

  const handleTestVoiceSos = () => {
    setHeardText('help me');
    setIsMatch(true);
    triggerVoiceSos('voice_banner_test');
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
            ? '#450A0A'
            : '#FEF2F2',
          borderColor: listening
            ? isDark
              ? '#059669'
              : '#10B981'
            : isDark
            ? '#DC2626'
            : '#F87171',
          borderRadius: radii.lg,
        },
      ]}
    >
      {/* Top Header Row */}
      <View style={styles.topRow}>
        <View style={styles.statusBadge}>
          <Animated.View
            style={[
              styles.indicatorDot,
              {
                backgroundColor: listening ? '#10B981' : '#EF4444',
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <Text
            style={[
              styles.statusTitle,
              { color: listening ? '#059669' : '#DC2626' },
            ]}
          >
            {listening ? 'VOICE SOS IS ACTIVE' : 'VOICE SOS NEEDS PERMISSION'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleTestVoiceSos}
          style={styles.testBtn}
          accessibilityRole="button"
          accessibilityLabel="Test Voice SOS"
        >
          <Ionicons name="flash" size={13} color="#FFFFFF" />
          <Text style={styles.testBtnText}>Test Voice</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {!listening ? (
        <View style={styles.unauthorizedBox}>
          <Text
            style={[
              styles.promptText,
              { color: isDark ? '#FCA5A5' : '#991B1B' },
            ]}
          >
            Saying <Text style={styles.boldWord}>"HELP"</Text> or{' '}
            <Text style={styles.boldWord}>"SAVE ME"</Text> triggers automatic
            emergency SOS. Tap below to allow microphone access on your browser.
          </Text>

          <TouchableOpacity
            onPress={handleActivateMic}
            disabled={requesting}
            style={[
              styles.activateButton,
              { backgroundColor: requesting ? '#9CA3AF' : '#DC2626' },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Tap to Enable Microphone"
          >
            <Ionicons name="mic" size={20} color="#FFFFFF" />
            <Text style={styles.activateButtonText}>
              {requesting ? 'Requesting Permission...' : '🎙️ Tap to Enable Voice Listening'}
            </Text>
          </TouchableOpacity>

          {micError && (
            <View style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444', borderWidth: 1, padding: 8, borderRadius: 8, marginTop: 4 }}>
              <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>
                ⚠️ {micError}
              </Text>
              <Text style={{ color: '#7F1D1D', fontSize: 11, marginTop: 2 }}>
                Check if your browser's site settings have microphone blocked (tap the tune/lock icon next to the URL).
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
            Listening continuously for distress commands.
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
                  ? 'EMERGENCY PHRASE DETECTED!'
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
                  : 'Speak now: "Help", "Save me", "Emergency", or shout...'}
              </Text>
            </View>
          </View>

          {/* Volume meter bar */}
          <View style={styles.meterContainer}>
            <Text
              style={[
                styles.meterLabel,
                { color: isDark ? '#6EE7B7' : '#047857' },
              ]}
            >
              Mic Level:
            </Text>
            <View style={styles.meterTrack}>
              <View
                style={[
                  styles.meterFill,
                  {
                    width: `${Math.max(5, audioLevel)}%`,
                    backgroundColor:
                      audioLevel > 50
                        ? '#EF4444'
                        : audioLevel > 25
                        ? '#F59E0B'
                        : '#10B981',
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.meterPercent,
                { color: isDark ? '#6EE7B7' : '#047857' },
              ]}
            >
              {audioLevel}%
            </Text>
          </View>

          {/* Keyword tags */}
          <View style={styles.tagsRow}>
            {['"Help"', '"Save me"', '"Emergency"', '"Bachao"', 'Shouting'].map(
              (tag) => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              )
            )}
          </View>
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
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  testBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
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
  boldWord: {
    fontWeight: '800',
    color: '#DC2626',
  },
  activateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    elevation: 2,
  },
  activateButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  meterLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  meterTrack: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  meterPercent: {
    fontSize: 11,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
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
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
});

import { Platform, Vibration } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

/**
 * The SOS siren: a loud police-style wail (assets/sounds/siren.wav) looped at full volume,
 * plus continuous vibration on phones. It starts the moment any SOS starts (button, scream,
 * fall, voice, shake) and stops only when the SOS is stood down with the PIN.
 *
 * Earlier this only made sound on the web (an oscillator); on Android and iOS startSiren()
 * set the audio mode and played nothing.
 *
 * The app cannot raise the phone's media volume itself; at low media volume the siren is
 * quiet, so vibration runs alongside it.
 */
const SIREN = require('../../assets/sounds/siren.wav');
const VIBRATE_PATTERN = [0, 700, 300]; // repeats

class AlarmSoundService {
  private wanted = false;
  private sound: Audio.Sound | null = null;
  private starting: Promise<void> | null = null;

  /** Short beep when the SOS button is touched (web only; phones vibrate instead). */
  async playSosPressSound() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      osc.onended = () => ctx.close().catch(() => undefined);
    } catch (e) {
      console.warn('[AlarmSound] Failed to play tap sound', e);
    }
  }

  /** Starts the looping siren (idempotent). */
  async startSiren() {
    this.wanted = true;
    if (Platform.OS !== 'web') {
      try { Vibration.vibrate(VIBRATE_PATTERN, true); } catch (_) {}
    }
    if (this.sound || this.starting) return this.starting ?? undefined;
    this.starting = (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          // keep recording allowed: the scream listener may still hold the microphone
          allowsRecordingIOS: true,
        }).catch(() => undefined);
        const { sound } = await Audio.Sound.createAsync(SIREN, { isLooping: true, volume: 1.0, shouldPlay: true });
        if (!this.wanted) {
          await sound.unloadAsync().catch(() => undefined);
          return;
        }
        this.sound = sound;
        console.log('[AlarmSound] Siren playing');
      } catch (e) {
        console.warn('[AlarmSound] Failed to start siren', e);
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  /** Stops siren and vibration immediately. */
  stopSiren() {
    this.wanted = false;
    if (Platform.OS !== 'web') {
      try { Vibration.cancel(); } catch (_) {}
    }
    const s = this.sound;
    this.sound = null;
    if (s) {
      s.stopAsync().catch(() => undefined).finally(() => s.unloadAsync().catch(() => undefined));
    }
  }

  isSirenActive(): boolean {
    return this.wanted;
  }
}

export default new AlarmSoundService();

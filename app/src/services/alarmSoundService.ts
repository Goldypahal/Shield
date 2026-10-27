import { Platform } from 'react-native';
import { Audio } from 'expo-av';

class AlarmSoundService {
  private isPlaying: boolean = false;
  private audioContext: any = null;
  private oscillatorNode: any = null;
  private gainNode: any = null;
  private sirenInterval: any = null;
  private nativeSound: Audio.Sound | null = null;

  /**
   * Immediate loud chirp/beep when user touches the SOS button
   */
  async playSosPressSound() {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
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
        }
      }
    } catch (e) {
      console.warn('[AlarmSound] Failed to play tap sound', e);
    }
  }

  /**
   * Starts a loud, high-decibel emergency siren
   */
  async startSiren() {
    if (this.isPlaying) return;
    this.isPlaying = true;

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
          }

          this.oscillatorNode = this.audioContext.createOscillator();
          this.gainNode = this.audioContext.createGain();

          this.oscillatorNode.type = 'sawtooth';
          this.gainNode.gain.setValueAtTime(0.9, this.audioContext.currentTime);

          this.oscillatorNode.connect(this.gainNode);
          this.gainNode.connect(this.audioContext.destination);

          this.oscillatorNode.start();

          // Continuous European / Police emergency pitch sweep (700Hz <-> 1350Hz)
          let high = true;
          this.oscillatorNode.frequency.setValueAtTime(750, this.audioContext.currentTime);

          this.sirenInterval = setInterval(() => {
            if (!this.isPlaying || !this.audioContext || !this.oscillatorNode) return;
            const targetFreq = high ? 1350 : 750;
            this.oscillatorNode.frequency.exponentialRampToValueAtTime(
              targetFreq,
              this.audioContext.currentTime + 0.35
            );
            high = !high;
          }, 350);
        }
      } else {
        // Native configuration for maximum alert volume
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
        });
      }
      console.log('[AlarmSound] Loud SOS siren active');
    } catch (e) {
      console.warn('[AlarmSound] Failed to start siren', e);
    }
  }

  /**
   * Stops the siren immediately
   */
  stopSiren() {
    this.isPlaying = false;
    if (this.sirenInterval) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }

    if (this.oscillatorNode) {
      try {
        this.oscillatorNode.stop();
        this.oscillatorNode.disconnect();
      } catch (_) {}
      this.oscillatorNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (_) {}
      this.audioContext = null;
    }

    if (this.nativeSound) {
      try {
        this.nativeSound.stopAsync();
        this.nativeSound.unloadAsync();
      } catch (_) {}
      this.nativeSound = null;
    }
    console.log('[AlarmSound] Siren silenced');
  }

  isSirenActive(): boolean {
    return this.isPlaying;
  }
}

export default new AlarmSoundService();

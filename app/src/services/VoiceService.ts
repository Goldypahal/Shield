import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { onVoiceSosTrigger } from './voiceTriggerHelper';

class VoiceService {
  private recording: Audio.Recording | null = null;
  private isListening: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private onKeywordDetected: (() => void) | null = null;
  private speechRecognition: any = null;
  private unsubTrigger: (() => void) | null = null;

  async startListening(callback?: () => void) {
    if (this.isListening) return;
    this.onKeywordDetected = callback || null;

    // Listen for simulated / test trigger events
    this.unsubTrigger = onVoiceSosTrigger(() => {
      console.log('[VoiceService] Emergency trigger received!');
      this.onKeywordDetected?.();
    });

    try {
      if (Platform.OS !== 'web') {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[VoiceService] Voice permission denied');
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        });
      }

      this.isListening = true;
      console.log('[VoiceService] Background listener active.');
      this.runDetectionLoop();
    } catch (e) {
      console.error('[VoiceService] Failed to start voice listener', e);
    }
  }

  private async runDetectionLoop() {
    if (!this.isListening) return;

    const savedKeyword = (await AsyncStorage.getItem('@shield_keyword')) || 'Help Me';
    const target = savedKeyword.toLowerCase();

    // On Web, use Web Speech Recognition if available
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          this.speechRecognition = new SpeechRec();
          this.speechRecognition.continuous = true;
          this.speechRecognition.interimResults = true;
          this.speechRecognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const text = String(event.results[i][0]?.transcript || '').toLowerCase();
              if (text.includes(target) || text.includes('help') || text.includes('emergency') || text.includes('sos')) {
                console.log(`[VoiceService] Keyword "${savedKeyword}" detected!`);
                this.onKeywordDetected?.();
              }
            }
          };
          this.speechRecognition.start();
        } catch (_) {}
      }
    }
  }

  /**
   * Manually test triggering the keyword detection
   */
  simulateKeywordTrigger() {
    console.log('[VoiceService] Simulating keyword detection...');
    this.onKeywordDetected?.();
  }

  async stopListening() {
    this.isListening = false;
    if (this.unsubTrigger) {
      this.unsubTrigger();
      this.unsubTrigger = null;
    }
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.speechRecognition) {
      try {
        this.speechRecognition.abort();
      } catch (_) {}
      this.speechRecognition = null;
    }
    if (this.recording) {
      await this.recording.stopAndUnloadAsync().catch(() => undefined);
      this.recording = null;
    }
  }

  getListeningStatus() {
    return this.isListening;
  }
}

export default new VoiceService();

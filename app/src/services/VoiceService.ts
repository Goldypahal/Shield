import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

class VoiceService {
  private recording: Audio.Recording | null = null;
  private isListening: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private onKeywordDetected: (() => void) | null = null;

  async startListening(callback: () => void) {
    if (this.isListening) return;
    this.onKeywordDetected = callback;

    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Voice permission denied');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldRoutingOutputsToSpeakerModeIOS: true,
      });

      this.isListening = true;
      console.log('[VoiceService] Background listener active.');
      this.runDetectionLoop();
    } catch (e) {
      console.error('Failed to start voice listener', e);
    }
  }

  private async runDetectionLoop() {
    if (!this.isListening) return;

    const savedKeyword = await AsyncStorage.getItem('@shield_keyword') || 'Help Me';
    
    // Simulations of constant background analysis
    this.checkInterval = setInterval(async () => {
      // Logic: In production, we'd analyze the buffer here.
      // For this hackathon, we show the system is 'Ready' for the keyword.
      // If we "detected" something (mock event or specific sound profile)
      // we would call this.onKeywordDetected();
    }, 3000);
  }

  async stopListening() {
    this.isListening = false;
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.recording) {
      await this.recording.stopAndUnloadAsync();
      this.recording = null;
    }
  }

  getListeningStatus() {
    return this.isListening;
  }
}

export default new VoiceService();

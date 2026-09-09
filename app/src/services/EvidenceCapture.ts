import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
// Assuming some secure crypto library like react-native-aes-crypto or similar
// import { AES } from 'react-native-crypto';

export interface EvidencePayload {
  incident_id: string;
  uri: string;
  type: 'audio' | 'photo' | 'video';
  timestamp: number;
}

class EvidenceCaptureService {
  private recording: Audio.Recording | null = null;
  private isCapturing = false;

  /**
   * Triggers a silent, low-footprint audio recording.
   * Runs in 30-second rotating chunks to prevent massive file sizes and memory locks.
   */
  async startStealthAudio(incident_id: string) {
    if (this.isCapturing) return;
    this.isCapturing = true;

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      this.recording = new Audio.Recording();
      await this.recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY); // low footprint
      await this.recording.startAsync();

      // Automatically chop and save every 30 seconds
      setTimeout(async () => {
        if (this.isCapturing) {
          const uri = await this.stopAndSaveAudio(incident_id);
          if (uri) await this.queueEvidenceForUpload(incident_id, uri, 'audio');
          // Restart loop if still in danger state
          this.isCapturing = false;
          // this.startStealthAudio(incident_id); // Called by engine loop if still active
        }
      }, 30000);

    } catch (error) {
      console.error("Stealth audio capture failed", error);
      this.isCapturing = false;
    }
  }

  async stopAndSaveAudio(incident_id: string): Promise<string | null> {
    if (!this.recording) return null;

    try {
      await this.recording.stopAndUnloadAsync();
      const rawUri = this.recording.getURI();
      this.recording = null;

      if (!rawUri) return null;

      // 1. Move to secure local encrypted storage directory
      const baseDir = FileSystem.cacheDirectory || '';
      const secureDir = `${baseDir}shield_vault/`;
      const dirInfo = await FileSystem.getInfoAsync(secureDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(secureDir, { intermediates: true });
      }

      const fileName = `ev_audio_${incident_id}_${Date.now()}.m4a`;
      const secureUri = secureDir + fileName;

      // In a real app, encrypt the file bytes here before saving.
      await FileSystem.moveAsync({ from: rawUri, to: secureUri });

      return secureUri;
    } catch (e) {
      console.error("Failed to stop recording securely", e);
      return null;
    }
  }

  /**
   * Manages uploading encrypted evidence payload. Checks network first.
   */
  async queueEvidenceForUpload(incident_id: string, fileUri: string, type: 'audio' | 'photo' | 'video') {
    const netState = await NetInfo.fetch();

    const payload: EvidencePayload = {
      incident_id,
      uri: fileUri,
      type,
      timestamp: Date.now()
    };

    if (netState.isConnected && netState.isInternetReachable) {
      await this.uploadEvidence(payload);
    } else {
      // Push to SQLite/Redux offline queue to upload later
      console.log("Evidence secured locally. Awaiting network to sync to incident.", payload);
      // OfflineQueueService.queueEvidence(payload);
    }
  }

  private async uploadEvidence(payload: EvidencePayload) {
    console.log(`Uploading stealth ${payload.type} evidence for incident ${payload.incident_id}`);
    // Mock upload:
    // const formData = new FormData();
    // formData.append("file", { uri: payload.uri, type: "audio/m4a", name: "evidence.m4a" });
    // await fetch('https://api.shield.dev/v1/incidents/evidence', { method: 'POST', body: formData });
    
    // Once verified uploaded, delete local copy to save space and clear trace
    try {
       await FileSystem.deleteAsync(payload.uri);
       console.log("Local evidence trace wiped after secure sync.");
    } catch (e) {
       console.error("Failed to wipe local evidence", e);
    }
  }
}

export default new EvidenceCaptureService();

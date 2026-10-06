import { Audio } from 'expo-av';

let recording: Audio.Recording | null = null;

export async function startIncidentRecording() {
  await Audio.requestPermissionsAsync();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true
  });

  recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
}

export async function stopIncidentRecording() {
  if (!recording) return null;
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  recording = null;
  return uri;
}

import AudioClassifier from '../ml/AudioClassifier';
import DistressWindowBuffer, { TemporalBufferStatus } from '../ml/DistressWindowBuffer';

let latestAudioProbability: number = 0.0;

/**
 * SRS DET-1 & DET-8: Process a 0.975-second audio buffer on device.
 * Evaluates distress probability via on-device audio model, updates 3-of-5 temporal buffer.
 * Raw audio is held strictly in memory and discarded unless an active alert is generated.
 */
export async function processAudioWindow(pcmSamples: Float32Array): Promise<{
  probability: number;
  bufferStatus: TemporalBufferStatus;
  shouldTriggerPreAlert: boolean;
}> {
  const prob = await AudioClassifier.classifyWindow(pcmSamples);
  latestAudioProbability = prob;
  const status = DistressWindowBuffer.pushWindow(prob);

  return {
    probability: prob,
    bufferStatus: status,
    shouldTriggerPreAlert: status.thresholdMet
  };
}

/**
 * Returns latest audio threat score [0, 100] for SRS Section 6.2 Threat Fusion.
 */
export async function getAudioThreatScore(): Promise<number> {
  const status = DistressWindowBuffer.getStatus();
  // If 3 of 5 windows triggered, boost score to 95+
  if (status.thresholdMet) {
    return Math.max(90, Math.round(latestAudioProbability * 100));
  }
  return Math.round(latestAudioProbability * 100);
}

export function resetAudioBuffer(): void {
  DistressWindowBuffer.reset();
  latestAudioProbability = 0.0;
}

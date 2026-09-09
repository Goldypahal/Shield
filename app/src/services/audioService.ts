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

// Stub until TFLite integration is added.
export async function getAudioThreatScore(): Promise<number> {
  return 0;
}

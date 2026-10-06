"""
SHIELD Walk Audio ML Preprocessing (SRS DET-1, DET-2)
- Target sample rate: 16,000 Hz (mono)
- Window duration: 0.975 seconds (15,600 samples)
- Normalization: Peak amplitude normalization to [-1.0, 1.0]
"""

import numpy as np

SAMPLE_RATE = 16000
WINDOW_DURATION_SEC = 0.975
SAMPLES_PER_WINDOW = int(SAMPLE_RATE * WINDOW_DURATION_SEC) # 15600

def load_and_preprocess_pcm(pcm_samples: np.ndarray, orig_sr: int = 16000) -> np.ndarray:
    """
    Converts arbitrary audio into 16kHz mono, float32, normalized to [-1.0, 1.0].
    """
    audio = pcm_samples.astype(np.float32)

    # Convert stereo to mono if 2D
    if len(audio.shape) > 1 and audio.shape[1] > 1:
        audio = np.mean(audio, axis=1)

    # Normalize amplitude
    max_val = np.max(np.abs(audio))
    if max_val > 1e-6:
        audio = audio / max_val

    return audio

def slice_into_windows(audio: np.ndarray, window_size: int = SAMPLES_PER_WINDOW, hop_size: int = None) -> np.ndarray:
    """
    Slices a continuous audio stream into 0.975s non-overlapping (or hop-sized) windows.
    Pads the last window if necessary.
    """
    if hop_size is None:
        hop_size = window_size

    total_len = len(audio)
    if total_len < window_size:
        # Pad with zeros to fill window
        padded = np.zeros(window_size, dtype=np.float32)
        padded[:total_len] = audio
        return np.expand_dims(padded, axis=0)

    windows = []
    for start in range(0, total_len - window_size + 1, hop_size):
        windows.append(audio[start:start + window_size])

    return np.array(windows, dtype=np.float32)

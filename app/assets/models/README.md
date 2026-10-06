# SHIELD On-Device Model Assets

This directory stores the edge machine learning model assets loaded by `ModelManager.ts`:

### 1. `shield_audio_v1.tflite` (SRS DET-1, DET-2, DET-3)
- **Input:** 0.975-second audio PCM buffer at 16,000 Hz mono (Float32 tensor `[1, 15600]`) or 1024-d YAMNet embedding (`[1, 1024]`).
- **Output:** Distress probability $P \in [0.0, 1.0]$ (`[1, 1]`).
- **Trigger Rule:** 3 of 5 consecutive windows $\ge 0.80$ (temporal smoothing via `DistressWindowBuffer.ts`).
- **Latency Target:** $< 200\text{ ms}$ per window (NFR-8).
- **Quantization:** INT8 quantized.

### 2. `shield_motion_v1.tflite` (SRS DET-5)
- **Input:** 100 timesteps $\times$ 6 kinematic axes (`[1, 100, 6]`):
  - Accelerometer: $a_x, a_y, a_z$ (in $\text{m/s}^2$)
  - Gyroscope: $g_x, g_y, g_z$ (in $\text{rad/s}$)
  - 50 Hz sampling rate ($\approx 2.0\text{ s}$ window).
- **Output:** Class probabilities `[1, 3]`:
  - Index 0: Normal walking/standing
  - Index 1: Fall ($>2.5g$ impact peak followed by $\ge 10\text{ s}$ stillness)
  - Index 2: Struggle (sustained high-jerk erratic motion)

### Model Drop-in:
Place your compiled TFLite model files in this directory:
- `app/assets/models/shield_audio_v1.tflite`
- `app/assets/models/shield_motion_v1.tflite`

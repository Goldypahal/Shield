"""
SHIELD Walk Motion ML Dataset Generator (SRS DET-5)
Generates 100 timesteps x 6 channels (ax, ay, az, gx, gy, gz) motion sequences
for 3 classes:
- 0 = NORMAL (walking, jogging, standing)
- 1 = FALL (impact > 2.5g followed by >= 10s stillness)
- 2 = STRUGGLE (sustained erratic high-jerk rotational motion)
"""

import numpy as np

TIMESTEPS = 100 # 2 seconds at 50Hz
CHANNELS = 6    # ax, ay, az, gx, gy, gz
G = 9.80665

def generate_synthetic_motion_sample(class_label: int, timesteps: int = 100) -> np.ndarray:
    """
    Generates a realistic (100, 6) kinematic trajectory.
    """
    t = np.linspace(0, 2.0, timesteps)
    sample = np.zeros((timesteps, 6), dtype=np.float32)

    if class_label == 0:
        # NORMAL WALKING: rhythmic vertical oscillation (~1.8Hz), slight tilt
        freq = 1.8
        sample[:, 0] = 0.5 * np.sin(2 * np.pi * freq * t) + np.random.normal(0, 0.1, timesteps)
        sample[:, 1] = 0.8 * np.sin(2 * np.pi * freq * t + np.pi/4) + np.random.normal(0, 0.1, timesteps)
        sample[:, 2] = G + 1.2 * np.sin(2 * np.pi * 2 * freq * t) + np.random.normal(0, 0.1, timesteps)
        sample[:, 3:6] = np.random.normal(0, 0.2, (timesteps, 3))

    elif class_label == 1:
        # FALL: Initial stumble (0-20), sharp impact peak > 2.5g at timestep ~30, then near-stillness at 1g
        sample[:25, 0] = np.random.normal(0, 1.5, 25)
        sample[:25, 1] = np.random.normal(0, 1.5, 25)
        sample[:25, 2] = G + np.random.normal(0, 2.0, 25)

        # Impact peak
        sample[25:35, 0] = np.random.uniform(15.0, 28.0, 10) # > 2.5g
        sample[25:35, 1] = np.random.uniform(10.0, 25.0, 10)
        sample[25:35, 2] = np.random.uniform(25.0, 40.0, 10)

        # Stillness post-impact (lying down, near 1g horizontal or vertical)
        sample[35:, 0] = G + np.random.normal(0, 0.05, 65)
        sample[35:, 1] = np.random.normal(0, 0.05, 65)
        sample[35:, 2] = np.random.normal(0, 0.05, 65)
        sample[35:, 3:6] = np.random.normal(0, 0.02, (65, 3)) # almost zero rotation

    elif class_label == 2:
        # STRUGGLE: Sustained erratic jerk, high rotation, severe variance across entire window
        sample[:, 0] = np.random.normal(0, 8.0, timesteps)
        sample[:, 1] = np.random.normal(0, 8.0, timesteps)
        sample[:, 2] = G + np.random.normal(0, 10.0, timesteps)
        sample[:, 3:6] = np.random.normal(0, 4.5, (timesteps, 3))

    return sample

def create_dataset(samples_per_class: int = 200):
    X = []
    y = []
    for c in [0, 1, 2]:
        for _ in range(samples_per_class):
            X.append(generate_synthetic_motion_sample(c))
            y.append(c)
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)

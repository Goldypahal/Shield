import tensorflow as tf
from tensorflow.keras import layers, models
import numpy as np

"""
SHIELD v1 Baseline Model Trainer
Solves the "Cold Start" Problem.

Before Federated Learning can improve the model on users' devices, 
we MUST ship a v1 model that understands basic danger thresholds.
"""

def build_audio_keyword_model(input_shape=(16000, 1), num_classes=3):
    """
    Trains on raw audio waveforms (or spectrograms) to detect 3 classes:
    0: Background Noise / Safe Conversation
    1: Danger Keywords ("Help", "Stop", "Bachao")
    2: Anomalous Sounds (Screams, breaking glass)
    
    Datasets to use for v1:
    - Google Speech Commands (for words)
    - Google AudioSet (for screams/glass)
    """
    model = models.Sequential([
        # 1D Convolution for raw audio wave
        layers.Conv1D(filters=32, kernel_size=8, activation='relu', input_shape=input_shape),
        layers.MaxPooling1D(pool_size=4),
        layers.Conv1D(filters=64, kernel_size=8, activation='relu'),
        layers.MaxPooling1D(pool_size=4),
        
        # Flatten and Classify
        layers.Flatten(),
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.5),
        layers.Dense(num_classes, activation='softmax') # Outputs probability of Danger
    ])
    
    model.compile(optimizer='adam',
                  loss='sparse_categorical_crossentropy',
                  metrics=['accuracy'])
    return model

def build_motion_anomaly_model(input_shape=(100, 6), num_classes=2):
    """
    Trains on 100 timesteps of 6-axis IMU data (Accel X,Y,Z + Gyro X,Y,Z).
    
    Classes:
    0: Normal Activity (Walking, Running, Sitting)
    1: Struggle / Fall Detected
    
    Datasets to use for v1:
    - SisFall (Open dataset of falls and activities of daily living)
    - WISDM Smartphone dataset
    """
    model = models.Sequential([
        # LSTM is perfect for time-series IMU sensor data
        layers.LSTM(64, return_sequences=True, input_shape=input_shape),
        layers.LSTM(32),
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.3),
        layers.Dense(num_classes, activation='sigmoid') # Binary: Panic vs Safe
    ])
    
    model.compile(optimizer='adam',
                  loss='sparse_categorical_crossentropy',
                  metrics=['accuracy'])
    return model

def export_to_tflite(keras_model, filename="shield_v1.tflite"):
    """
    Converts the heavy Keras model into a microscopic TensorFlow Lite model
    that can run natively on Android/iOS React Native without internet.
    """
    converter = tf.lite.TFLiteConverter.from_keras_model(keras_model)
    
    # OPTIMIZATION: Quantize the model (make it 8-bit) to save battery and memory
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    
    tflite_model = converter.convert()
    
    with open(filename, 'wb') as f:
        f.write(tflite_model)
    print(f"Exported production-ready client model to {filename}!")

# Normally you would load your labeled dataset here, e.g.:
# audio_x_train, audio_y_train = load_audioset()
# motion_x_train, motion_y_train = load_sisfall_dataset()

# Train Audio Model
# audio_model = build_audio_keyword_model()
# audio_model.fit(audio_x_train, audio_y_train, epochs=10)
# export_to_tflite(audio_model, "shield_audio_v1.tflite")

# Train Motion Model
# motion_model = build_motion_anomaly_model()
# motion_model.fit(motion_x_train, motion_y_train, epochs=10)
# export_to_tflite(motion_model, "shield_motion_v1.tflite")

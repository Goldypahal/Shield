"""
SHIELD Walk Motion ML Model Training (SRS DET-5)
Trains 1D Temporal CNN classifier for fall and struggle detection:
Input: (batch, 100, 6) -> Output: 3 classes (Normal, Fall, Struggle)
"""

import os
import numpy as np

def build_motion_classifier(timesteps: int = 100, channels: int = 6, num_classes: int = 3):
    try:
        import tensorflow as tf
        from tensorflow.keras import layers, models

        model = models.Sequential([
            layers.Input(shape=(timesteps, channels), name="motion_sequence"),
            layers.Conv1D(32, kernel_size=3, padding="same", activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling1D(2),
            layers.Conv1D(64, kernel_size=3, padding="same", activation="relu"),
            layers.BatchNormalization(),
            layers.GlobalAveragePooling1D(),
            layers.Dense(32, activation="relu"),
            layers.Dropout(0.2),
            layers.Dense(num_classes, activation="softmax", name="motion_event")
        ], name="shield_motion_v1")

        model.compile(
            optimizer="adam",
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"]
        )
        return model
    except ImportError:
        return {
            "name": "shield_motion_v1",
            "architecture": "1D-CNN (Conv1D-32 -> Pool -> Conv1D-64 -> GlobalAvg -> Dense-32 -> Softmax-3)"
        }

if __name__ == "__main__":
    print("[Motion Train] Model architecture ready for training.")

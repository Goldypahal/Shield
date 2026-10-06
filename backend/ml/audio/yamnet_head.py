"""
SHIELD Walk Audio Distress Classification Head (SRS DET-2)
Pretrained YAMNet Embeddings (1024-d) -> Dense Classification Head -> TFLite Quantization
"""

import os
from typing import Optional

def build_distress_classification_head(input_dim: int = 1024):
    """
    Builds the small classification head atop YAMNet embeddings.
    Architecture:
      Input(1024) -> Dense(128, relu) -> Dropout(0.3) -> Dense(32, relu) -> Dense(1, sigmoid)
    """
    try:
        import tensorflow as tf
        from tensorflow.keras import layers, models

        inputs = layers.Input(shape=(input_dim,), name="yamnet_embedding")
        x = layers.Dense(128, activation="relu", name="dense_1")(inputs)
        x = layers.Dropout(0.3, name="dropout_1")(x)
        x = layers.Dense(32, activation="relu", name="dense_2")(x)
        outputs = layers.Dense(1, activation="sigmoid", name="distress_prob")(x)

        model = models.Model(inputs=inputs, outputs=outputs, name="shield_distress_head")
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
            loss="binary_crossentropy",
            metrics=["accuracy", tf.keras.metrics.Precision(name="precision"), tf.keras.metrics.Recall(name="recall")]
        )
        return model
    except ImportError:
        # Fallback architecture specification
        return {
            "name": "shield_distress_head",
            "layers": [
                {"type": "Dense", "units": 128, "activation": "relu"},
                {"type": "Dropout", "rate": 0.3},
                {"type": "Dense", "units": 32, "activation": "relu"},
                {"type": "Dense", "units": 1, "activation": "sigmoid"}
            ]
        }

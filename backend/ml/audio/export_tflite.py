"""
SHIELD Walk Audio TFLite INT8 Quantization & Export (SRS DET-2)
Converts Keras/SavedModel into quantized TFLite asset `shield_audio_v1.tflite`
for sub-200ms on-device inference on Android & iOS.
"""

import os
import sys

def convert_model_to_tflite(keras_model, output_path: str, quantize_int8: bool = True):
    """
    Converts a trained Keras classification head to TFLite with post-training quantization.
    """
    try:
        import tensorflow as tf

        converter = tf.lite.TFLiteConverter.from_keras_model(keras_model)
        if quantize_int8:
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            # Optional representative dataset can be set here for full INT8 calibration

        tflite_model = converter.convert()
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(tflite_model)
        print(f"[TFLite Export] Successfully wrote quantized model to: {output_path} ({len(tflite_model)} bytes)")
        return output_path
    except ImportError:
        print("[TFLite Export] TensorFlow not available in current environment for conversion.")
        return None

if __name__ == "__main__":
    target = os.path.join(os.path.dirname(__file__), "..", "models", "shield_audio_v1.tflite")
    print(f"Target TFLite path: {target}")

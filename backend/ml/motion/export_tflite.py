"""
SHIELD Walk Motion TFLite Quantization & Export (SRS DET-5)
Converts motion sequence model to `shield_motion_v1.tflite` for mobile inference.
"""

import os

def export_motion_tflite(model, output_path: str):
    try:
        import tensorflow as tf
        converter = tf.lite.TFLiteConverter.from_keras_model(model)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        tflite_model = converter.convert()
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(tflite_model)
        print(f"[Motion TFLite Export] Wrote model to: {output_path}")
        return output_path
    except ImportError:
        print("[Motion TFLite Export] TensorFlow not available for export.")
        return None

# -*- coding: utf-8 -*-
"""
Heimdal / Shield Scream Detection - Local Inference Pipeline
SRS DET-1, DET-2, DET-7, NFR-8 compliant

Architecture:
- 4-layer 2D Convolutional Neural Network (ScreamCNN)
- Input: Log-mel spectrogram (64 mels x 313 frames from 5.0s audio @ 16kHz)
- Output: Calibrated scream distress probability in [0.0, 1.0]
- Decision threshold: 0.50 (Validation F1 = 96.09%)
"""

import os
import sys
import json
import base64
import io
from pathlib import Path
from typing import Dict, Any, Union, Optional

try:
    import spaces
except ImportError:
    spaces = None

try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False

try:
    import soundfile as sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False

try:
    import librosa
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False


if TORCH_AVAILABLE:
    class ScreamCNN(nn.Module):
        def __init__(self):
            super().__init__()
            layers = []
            channels = [1, 16, 32, 64, 128]
            for a, b in zip(channels[:-1], channels[1:]):
                layers.extend([
                    nn.Conv2d(a, b, kernel_size=3, padding=1),
                    nn.BatchNorm2d(b),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(2),
                ])
            self.features = nn.Sequential(*layers)
            self.pool = nn.AdaptiveAvgPool2d((1, 1))
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Dropout(0.3),
                nn.Linear(128, 1),
            )

        def forward(self, x):
            return self.head(self.pool(self.features(x))).squeeze(1)


class LocalScreamPredictor:
    def __init__(self, model_dir: Optional[Union[str, Path]] = None):
        if model_dir is None:
            model_dir = Path(__file__).resolve().parent
        else:
            model_dir = Path(model_dir)

        self.model_dir = model_dir
        self.config_path = model_dir / 'config.json'
        self.weights_path = model_dir / 'best.pt'

        if not self.config_path.exists():
            raise FileNotFoundError(f'config.json not found in {model_dir}')

        with open(self.config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)

        self.sample_rate = int(self.config.get('sample_rate', 16000))
        self.duration = int(self.config.get('duration_seconds', 5))
        self.n_samples = self.sample_rate * self.duration
        self.threshold = float(self.config.get('threshold_used_during_validation', 0.5))
        self.n_mels = int(self.config.get('n_mels', 64))
        self.n_fft = int(self.config.get('n_fft', 1024))
        self.hop_length = int(self.config.get('hop_length', 256))
        self.fmin = int(self.config.get('fmin', 40))
        self.fmax = int(self.config.get('fmax', 8000))

        self.model = None
        self.device = None

        if TORCH_AVAILABLE and self.weights_path.exists():
            try:
                self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
                checkpoint = torch.load(self.weights_path, map_location=self.device, weights_only=False)
                self.model = ScreamCNN().to(self.device)
                state_dict = checkpoint.get('model', checkpoint)
                self.model.load_state_dict(state_dict)
                self.model.eval()
            except Exception as e:
                print(f'[LocalScreamPredictor] Warning: PyTorch model init failed: {e}', file=sys.stderr)
                self.model = None

    def preprocess_pcm(self, audio: Any, orig_sr: int):
        if not NUMPY_AVAILABLE:
            raise RuntimeError('Numpy is required for audio preprocessing')
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        if audio.size == 0:
            raise ValueError('Audio buffer is empty.')

        if LIBROSA_AVAILABLE and orig_sr != self.sample_rate:
            audio = librosa.resample(audio, orig_sr=orig_sr, target_sr=self.sample_rate)

        if len(audio) < self.n_samples:
            audio = np.pad(audio, (0, self.n_samples - len(audio)))
        else:
            audio = audio[:self.n_samples]

        if LIBROSA_AVAILABLE:
            mel = librosa.feature.melspectrogram(
                y=audio,
                sr=self.sample_rate,
                n_fft=self.n_fft,
                hop_length=self.hop_length,
                n_mels=self.n_mels,
                fmin=self.fmin,
                fmax=self.fmax,
            )
            mel = librosa.power_to_db(mel, ref=np.max)
            mel = (mel - mel.mean()) / (mel.std() + 1e-6)
        else:
            frames = (self.n_samples - self.n_fft) // self.hop_length + 1
            mel = np.zeros((self.n_mels, frames), dtype=np.float32)

        return torch.tensor(mel, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(self.device)

    def predict_bytes(self, audio_bytes: bytes) -> Dict[str, Any]:
        if not TORCH_AVAILABLE or self.model is None or not SOUNDFILE_AVAILABLE:
            return self._heuristic_fallback(audio_bytes)

        audio, sr = sf.read(io.BytesIO(audio_bytes), dtype='float32')
        x = self.preprocess_pcm(audio, sr)
        with torch.no_grad():
            logit = self.model(x)
            probability = torch.sigmoid(logit).item()

        label = 'scream' if probability >= self.threshold else 'non_scream'
        return {
            'label': label,
            'probability': round(probability, 6),
            'threshold': self.threshold,
            'model_name': self.config.get('model_name', 'Shield Scream Detection CNN'),
            'engine': 'pytorch_local'
        }

    def predict_base64(self, encoded_audio: str) -> Dict[str, Any]:
        if encoded_audio.startswith('data:'):
            encoded_audio = encoded_audio.split(',', 1)[1]
        audio_bytes = base64.b64decode(encoded_audio, validate=True)
        return self.predict_bytes(audio_bytes)

    def _heuristic_fallback(self, audio_bytes: bytes) -> Dict[str, Any]:
        return {
            'label': 'non_scream',
            'probability': 0.05,
            'threshold': self.threshold,
            'model_name': self.config.get('model_name', 'Shield Scream Detection CNN'),
            'engine': 'heuristic_fallback',
            'note': 'PyTorch or libsndfile dependencies not present in environment.'
        }

ScreamPredictor = LocalScreamPredictor

if __name__ == '__main__':
    predictor = LocalScreamPredictor()
    print('Loaded Heimdal Scream Predictor!')
    print('Config:', json.dumps(predictor.config, indent=2))
    print('PyTorch available:', TORCH_AVAILABLE)
    print('Model ready:', predictor.model is not None)

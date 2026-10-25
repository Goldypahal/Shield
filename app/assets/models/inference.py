try:
    import spaces
except ImportError:
    spaces = None
import json
import base64
import io
import os
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
import torch.nn as nn


class ScreamCNN(nn.Module):
    def __init__(self):
        super().__init__()
        layers = []
        channels = [1, 16, 32, 64, 128]
        for a, b in zip(channels[:-1], channels[1:]):
            layers.extend([
                nn.Conv2d(a, b, 3, padding=1),
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


class ScreamPredictor:
    def __init__(self, model_dir):
        model_dir = Path(model_dir)
        self.device = torch.device(
            "cuda" if torch.cuda.is_available() else "cpu"
        )
        self.config = json.loads(
            (model_dir / "config.json").read_text()
        )

        checkpoint = torch.load(
            model_dir / "best.pt",
            map_location=self.device,
            weights_only=False,
        )

        self.model = ScreamCNN().to(self.device)
        self.model.load_state_dict(checkpoint["model"])
        self.model.eval()

        self.sample_rate = int(self.config["sample_rate"])
        self.duration = int(self.config["duration_seconds"])
        self.n_samples = self.sample_rate * self.duration
        self.threshold = float(
            self.config.get("threshold_used_during_validation", 0.5)
        )

    def preprocess(self, audio_bytes):
        # Decode the uploaded audio file. SoundFile supports common
        # WAV/FLAC/OGG formats; MP3 support depends on the installed
        # libsndfile build.
        audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")

        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        if audio.size == 0:
            raise ValueError("The audio file is empty.")

        if sr != self.sample_rate:
            audio = librosa.resample(
                audio, orig_sr=sr, target_sr=self.sample_rate
            )

        if len(audio) < self.n_samples:
            audio = np.pad(audio, (0, self.n_samples - len(audio)))
        else:
            audio = audio[:self.n_samples]

        mel = librosa.feature.melspectrogram(
            y=audio,
            sr=self.sample_rate,
            n_fft=int(self.config["n_fft"]),
            hop_length=int(self.config["hop_length"]),
            n_mels=int(self.config["n_mels"]),
            fmin=int(self.config["fmin"]),
            fmax=int(self.config["fmax"]),
        )
        mel = librosa.power_to_db(mel, ref=np.max)
        mel = (mel - mel.mean()) / (mel.std() + 1e-6)

        return torch.tensor(
            mel, dtype=torch.float32
        ).unsqueeze(0).unsqueeze(0).to(self.device)

    @torch.inference_mode()
    def predict_bytes(self, audio_bytes):
        x = self.preprocess(audio_bytes)
        logit = self.model(x)
        probability = torch.sigmoid(logit).item()
        label = "scream" if probability >= self.threshold else "non_scream"

        return {
            "label": label,
            "probability": round(probability, 6),
            "threshold": self.threshold,
            "model_version": "1.0",
        }

    def predict_base64(self, encoded_audio):
        # Accept plain base64 or a data URI.
        if encoded_audio.startswith("data:"):
            encoded_audio = encoded_audio.split(",", 1)[1]
        audio_bytes = base64.b64decode(encoded_audio, validate=True)
        return self.predict_bytes(audio_bytes)

---
pipeline_tag: audio-classification
tags:
- pytorch
- audio-classification
- scream-detection
- shield
---

# Shield Scream Detection

Private research model for classifying five-second audio clips as
`scream` or `non_scream`.

## Input

Send a JSON request with `inputs` containing base64-encoded WAV audio.
The model resamples audio to 16 kHz and evaluates a five-second clip.

## Output

Returns a predicted label and the model's sigmoid score.

The score is not a calibrated probability of danger. This research model
must not be used as the sole trigger for emergency or SOS decisions.

## Files

- `best.pt`: trained PyTorch checkpoint
- `config.json`: preprocessing and model configuration
- `inference.py`: model and preprocessing implementation
- `handler.py`: Hugging Face Inference Endpoint handler
- `requirements.txt`: runtime dependencies

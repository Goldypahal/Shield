import base64
import binascii
from inference import ScreamPredictor


class EndpointHandler:
    def __init__(self, path=""):
        self.predictor = ScreamPredictor(path)

    def __call__(self, data):
        """
        Expected JSON:
        {
          "inputs": "<base64-encoded WAV audio>",
          "parameters": {}
        }
        """
        if not isinstance(data, dict):
            raise ValueError("Request body must be a JSON object.")

        encoded = data.get("inputs")
        if not isinstance(encoded, str) or not encoded:
            raise ValueError(
                "Provide base64-encoded audio in the 'inputs' field."
            )

        try:
            return self.predictor.predict_base64(encoded)
        except (ValueError, binascii.Error) as exc:
            raise ValueError(f"Invalid audio input: {exc}") from exc

"""
SHIELD Walk Audio Threshold Calibration & Evaluation (SRS DET-3, DET-7)
Performs threshold sweep across [0.30 - 0.90] to evaluate Precision, Recall, F1,
and False Positive Rates against held-out Scream and ESC-50 environmental distractors.
"""

from typing import List, Dict, Any
import numpy as np

def evaluate_threshold_sweep(
    y_true: np.ndarray,
    y_probs: np.ndarray,
    thresholds: List[float] = None
) -> List[Dict[str, Any]]:
    """
    Sweeps thresholds and computes precision, recall, specificity, and F1 score.
    Target per SRS DET-3: threshold = 0.80.
    """
    if thresholds is None:
        thresholds = [0.30, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90]

    results = []
    for th in thresholds:
        y_pred = (y_probs >= th).astype(int)

        tp = int(np.sum((y_pred == 1) & (y_true == 1)))
        fp = int(np.sum((y_pred == 1) & (y_true == 0)))
        fn = int(np.sum((y_pred == 0) & (y_true == 1)))
        tn = int(np.sum((y_pred == 0) & (y_true == 0)))

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        results.append({
            "threshold": th,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "false_positive_rate": round(fpr, 4),
            "f1_score": round(f1, 4),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "true_negatives": tn
        })

    return results

if __name__ == "__main__":
    # Synthetic validation sweep demonstration
    np.random.seed(42)
    y_true = np.concatenate([np.ones(100), np.zeros(200)])
    y_probs = np.concatenate([
        np.random.beta(8, 2, 100), # Positive screams skewed high
        np.random.beta(2, 8, 200)  # Negatives skewed low
    ])
    sweep = evaluate_threshold_sweep(y_true, y_probs)
    print("Threshold | Recall | Precision | FPR | F1")
    for r in sweep:
        print(f"  {r['threshold']:.2f}    |  {r['recall']:.2f}  |   {r['precision']:.2f}    | {r['false_positive_rate']:.2f}| {r['f1_score']:.2f}")

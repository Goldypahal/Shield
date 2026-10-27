/**
 * Live status of the automatic SOS detectors, for the Home screen card: whether each one
 * is running and how (e.g. fall detection with the model or the physics fallback).
 */
export interface DetectorStatus {
  fall: 'off' | 'model' | 'physics';
}

let status: DetectorStatus = { fall: 'off' };
const listeners = new Set<(s: DetectorStatus) => void>();

export function setDetectorStatus(patch: Partial<DetectorStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

export function getDetectorStatus(): DetectorStatus {
  return status;
}

export function onDetectorStatus(l: (s: DetectorStatus) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

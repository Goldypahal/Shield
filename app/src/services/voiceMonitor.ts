import { DEFAULT_SPEECH_DB, getDiscreetSettings, onDiscreetSettingsChange, triggerLevelDb, updateDiscreetSettings } from './discreetSettings';

/**
 * Shared live state of voice SOS detection, fed by the two microphone users:
 *   - the scream listener (raw audio: exact loudness, voicing, noise floor), and
 *   - the keyword listener (speech recognition: words, plus the recogniser's volume).
 * The Home card shows it (level meter with the trigger line, what was heard, why an SOS
 * did or did not start), and the keyword listener asks it whether a cry was loud enough.
 */
export type MicState = 'off' | 'starting' | 'on' | 'silenced' | 'denied' | 'unavailable' | 'error';

export interface VoiceState {
  /** Raw-audio listener (scream / shout detection). */
  scream: MicState;
  /** Speech-recognition listener (keywords). */
  keywords: MicState;
  /** Latest loudness on the app's dB scale (0 when nothing measures it). */
  levelDb: number;
  /** Background noise floor (dB). */
  floorDb: number;
  /** Normal speaking level (calibrated or default 60 dB). */
  baselineDb: number;
  /** Raised-voice level that counts as a cry (baseline + 15 % by default). */
  triggerDb: number;
  /** Whether keywords must be said at the trigger level. */
  keywordNeedsLoud: boolean;
  /** Where levelDb comes from right now. */
  levelSource: 'audio' | 'speech' | null;
  /** Last words the recogniser heard. */
  heard: string;
  /** Last emergency phrase recognised, and whether it was loud enough. */
  match: { phrase: string; loud: boolean; at: number } | null;
  /** How long a scream / shout has been going on (ms), for the progress bar. */
  crySustainedMs: number;
  /** Calibration in progress: ms epoch when it ends. */
  calibratingUntil: number;
  /** Short status line for the walker. */
  note: string | null;
}

let state: VoiceState = {
  scream: 'off',
  keywords: 'off',
  levelDb: 0,
  floorDb: 35,
  baselineDb: DEFAULT_SPEECH_DB,
  triggerDb: triggerLevelDb({ voiceBaselineDb: null, voiceRaisePct: 15 }),
  keywordNeedsLoud: true,
  levelSource: null,
  heard: '',
  match: null,
  crySustainedMs: 0,
  calibratingUntil: 0,
  note: null,
};

const listeners = new Set<(s: VoiceState) => void>();
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getVoiceState(): VoiceState {
  return state;
}

export function onVoiceState(l: (s: VoiceState) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function setMicState(which: 'scream' | 'keywords', s: MicState, note?: string | null) {
  set({ [which]: s, ...(note !== undefined ? { note } : {}) } as Partial<VoiceState>);
}

// --- trigger level from settings ------------------------------------------------

const applySettings = (d: { voiceBaselineDb: number | null; voiceRaisePct: number; keywordNeedsLoud: boolean }) =>
  set({ baselineDb: d.voiceBaselineDb ?? DEFAULT_SPEECH_DB, triggerDb: triggerLevelDb(d), keywordNeedsLoud: d.keywordNeedsLoud });
getDiscreetSettings().then(applySettings).catch(() => undefined);
onDiscreetSettingsChange(applySettings);

// --- loudness ---------------------------------------------------------------------

/** Recent levels: [time, dB, voiced] (a few seconds, for "was the cry loud?"). */
let recent: Array<[number, number, boolean]> = [];
let lastAudioAt = 0;
let calibration: number[] | null = null;

/**
 * A new loudness reading. Raw audio wins when both listeners run: it is measured exactly,
 * the recogniser's volume is only an estimate. `voiced`: a human voice (raw audio) or
 * speech-like level above the floor (recogniser).
 */
export function pushLevel(db: number, source: 'audio' | 'speech', opts: { floorDb?: number; voiced?: boolean } = {}) {
  const now = Date.now();
  if (source === 'speech' && now - lastAudioAt < 1500) {
    // raw audio is live: only keep the recogniser's reading for the loudness check
    recent.push([now, db, opts.voiced ?? false]);
  } else {
    if (source === 'audio') lastAudioAt = now;
    recent.push([now, db, opts.voiced ?? false]);
    set({ levelDb: db, levelSource: source, ...(opts.floorDb !== undefined ? { floorDb: opts.floorDb } : {}) });
  }
  recent = recent.filter(([t]) => now - t <= 6000);
  if (calibration && (opts.voiced ?? db >= state.floorDb + 8)) calibration.push(db);
}

/** Loudest reading in the last `ms` (dB). */
export function recentPeakDb(ms = 3500): number {
  const now = Date.now();
  return recent.reduce((m, [t, db]) => (now - t <= ms ? Math.max(m, db) : m), 0);
}

export function setCryProgress(ms: number) {
  if (ms !== state.crySustainedMs) set({ crySustainedMs: ms });
}

// --- words --------------------------------------------------------------------------

export function reportHeard(text: string) {
  if (text && text !== state.heard) set({ heard: text });
}

/**
 * The keyword listener matched an emergency phrase. Returns whether it should start an SOS:
 * always when loudness is not required, else only if the cry reached the trigger level.
 */
export function judgeKeyword(phrase: string): boolean {
  const peak = recentPeakDb(3500);
  const loud = !state.keywordNeedsLoud || peak >= state.triggerDb || (state.levelSource === null && peak === 0);
  set({
    match: { phrase, loud, at: Date.now() },
    note: loud ? null : `Heard "${phrase}" at ${Math.round(peak)} dB. Say it louder (${Math.round(state.triggerDb)} dB+) to start an SOS.`,
  });
  return loud;
}

// --- calibration -------------------------------------------------------------------

/**
 * Measures the walker's normal speaking level: they talk normally for `ms`; the median of
 * the voiced readings becomes the baseline, and the trigger level is that + voiceRaisePct.
 */
export async function calibrateVoice(ms = 5000): Promise<{ baselineDb: number; triggerDb: number } | { error: string }> {
  if (state.scream !== 'on' && state.keywords !== 'on') return { error: 'The microphone is not listening. Turn voice SOS on first.' };
  calibration = [];
  set({ calibratingUntil: Date.now() + ms, note: 'Speak normally, as you would talk to a friend next to you...' });
  await new Promise((r) => setTimeout(r, ms));
  const got = calibration;
  calibration = null;
  set({ calibratingUntil: 0 });
  if (!got || got.length < 4) {
    set({ note: 'Could not hear your voice. Hold the phone as usual and speak for the whole 5 seconds.' });
    return { error: 'Not enough speech heard.' };
  }
  const sorted = [...got].sort((a, b) => a - b);
  const baseline = Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
  const d = await updateDiscreetSettings({ voiceBaselineDb: baseline });
  const trigger = triggerLevelDb(d);
  set({ note: `Your normal voice: ${Math.round(baseline)} dB. A cry for help needs ${Math.round(trigger)} dB or more.` });
  return { baselineDb: baseline, triggerDb: trigger };
}

export function clearVoiceNote() {
  if (state.note) set({ note: null });
}

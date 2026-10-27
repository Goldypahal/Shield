/**
 * Which spoken words start a voice SOS. Used by the browser and the phone recognisers.
 *
 * Rules (a voice SOS is PIN-locked and sounds a siren, so false alarms are costly):
 *  1. Distress phrases count anywhere in what was said, as whole words:
 *     "help", "help me", "save me", "bachao", "madad karo", "बचाओ" ...
 *     ("helpful" or "saved" never match: whole words only.)
 *  2. "stop", "police" and "emergency" are everyday words ("bus stop", "police station",
 *     "emergency exit"), so they count only when said as a cry:
 *       - on their own or with a few cry words: "stop!", "stop it", "police!", "emergency please"
 *       - repeated: "stop stop", "police police"
 *       - in a cry phrase: "call the police", "police help", "this is an emergency", "stop touching me"
 *     These are only judged on final results, because a partial result "stop" may still
 *     become "stop by the shop".
 */

export const DISTRESS_PHRASES = [
  'help', 'help me', 'please help', 'someone help', 'help us', 'help help',
  'save me', 'please save me', 'somebody save me',
  'bachao', 'bachaao', 'bachav', 'bachaav', 'bachaw', 'bacha o', 'mujhe bachao', 'koi bachao',
  // how English recognisers often write "madad" / "bachao"
  'madat', 'madad karo', 'madat karo', 'mujhe bachao',
  'madad', 'madad karo', 'chhodo mujhe', 'chodo mujhe', 'leave me alone', 'let me go',
  // Devanagari, for the Hindi recogniser
  'बचाओ', 'मुझे बचाओ', 'कोई बचाओ', 'मदद', 'मदद करो', 'छोड़ो मुझे', 'छोड़ दो',
];

export const GUARDED_WORDS = ['stop', 'police', 'emergency', 'पुलिस', 'रुको'];

/** Words that may stand next to a guarded word without making it everyday speech. */
const CRY_WORDS = new Set([
  'stop', 'police', 'emergency', 'please', 'it', 'now', 'no', 'oh', 'hey', 'help', 'me',
  'right', 'call', 'the', 'an', 'its', 'pls', 'पुलिस', 'रुको', 'बचाओ',
]);

export const GUARDED_PHRASES = [
  'call the police', 'call police', 'get the police', 'police help', 'help police',
  'this is an emergency', 'its an emergency', 'it is an emergency', 'emergency help',
  'stop it', 'stop touching me', 'please stop', 'stop please', 'dont touch me', 'get away from me',
  'पुलिस बुलाओ', 'पुलिस को बुलाओ',
];

/** Lower-case words with punctuation removed ("Don't!" -> "dont"); keeps Devanagari. */
export function normalizeSpeech(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const hasPhrase = (padded: string, phrase: string) => padded.includes(` ${phrase} `);

/**
 * Returns the phrase that should start an SOS, or null.
 * @param isFinal the recogniser's final result for this utterance (guarded words need it)
 */
export function matchEmergency(transcript: string, isFinal = true): string | null {
  const words = normalizeSpeech(transcript);
  if (words.length === 0) return null;
  const padded = ` ${words.join(' ')} `;

  for (const p of DISTRESS_PHRASES) if (hasPhrase(padded, p)) return p;
  if (!isFinal) return null;

  for (const p of GUARDED_PHRASES) if (hasPhrase(padded, p)) return p;
  for (const w of GUARDED_WORDS) {
    const count = words.filter((x) => x === w).length;
    if (count === 0) continue;
    if (count >= 2) return `${w} ${w}`;
    // short cry made only of cry words: "stop!", "stop it now", "police please"
    if (words.length <= 4 && words.every((x) => CRY_WORDS.has(x))) return w;
  }
  return null;
}

/** Back-compat: true when the transcript should start an SOS. */
export function isEmergencyPhrase(transcript: string, isFinal = true): boolean {
  return matchEmergency(transcript, isFinal) !== null;
}

/** Hints for recognisers that accept a vocabulary bias (Android 13+, iOS). */
export const RECOGNIZER_HINTS = ['help', 'help me', 'save me', 'bachao', 'mujhe bachao', 'madad karo', 'stop', 'police', 'emergency', 'call the police', 'leave me alone'];

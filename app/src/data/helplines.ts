import type { StringKey } from '../i18n/locales/en';

/**
 * Nationwide instant-response helplines, verified October 2026 against:
 *  - india.gov.in/directory/helpline (National Portal of India)
 *  - ncw.gov.in/other-useful-helplines (14490 launched 24 Nov 2025, linked to 7827170170)
 *  - Tele-MANAS: 14416 / 1-800-891-4416, 24x7, ~20 languages
 *  - NHAI/IHMCL: 1033 for National Highways
 * India has no government helpline specifically for men; the "men" group lists the
 * gender-neutral services that help men in distress. Re-verify before each release.
 */
export type HelplineCategory = 'emergency' | 'women' | 'children' | 'men' | 'health' | 'elders' | 'travel' | 'cyber';

export interface Helpline {
  id: string;
  /** Digits as dialled. */
  number: string;
  category: HelplineCategory;
  name: StringKey;
  description: StringKey;
  /** Confirmed as answered round the clock (shows a 24x7 badge); false = not confirmed. */
  allDay: boolean;
}

export const HELPLINE_CATEGORIES: { key: HelplineCategory; label: StringKey; icon: string }[] = [
  { key: 'emergency', label: 'helplines.cat.emergency', icon: 'alert-circle' },
  { key: 'women', label: 'helplines.cat.women', icon: 'woman' },
  { key: 'children', label: 'helplines.cat.children', icon: 'happy' },
  { key: 'men', label: 'helplines.cat.men', icon: 'man' },
  { key: 'health', label: 'helplines.cat.health', icon: 'medkit' },
  { key: 'elders', label: 'helplines.cat.elders', icon: 'accessibility' },
  { key: 'travel', label: 'helplines.cat.travel', icon: 'car' },
  { key: 'cyber', label: 'helplines.cat.cyber', icon: 'shield-half' },
];

export const HELPLINES: Helpline[] = [
  // Emergency
  { id: 'erss', number: '112', category: 'emergency', name: 'hl.112.name', description: 'hl.112.desc', allDay: true },
  { id: 'police', number: '100', category: 'emergency', name: 'hl.100.name', description: 'hl.100.desc', allDay: true },
  { id: 'fire', number: '101', category: 'emergency', name: 'hl.101.name', description: 'hl.101.desc', allDay: true },
  { id: 'amb108', number: '108', category: 'emergency', name: 'hl.108.name', description: 'hl.108.desc', allDay: true },
  { id: 'amb102', number: '102', category: 'emergency', name: 'hl.102.name', description: 'hl.102.desc', allDay: true },
  { id: 'disaster', number: '1070', category: 'emergency', name: 'hl.1070.name', description: 'hl.1070.desc', allDay: false },
  { id: 'lpg', number: '1906', category: 'emergency', name: 'hl.1906.name', description: 'hl.1906.desc', allDay: true },

  // Women
  { id: 'ncw', number: '14490', category: 'women', name: 'hl.14490.name', description: 'hl.14490.desc', allDay: true },
  { id: 'women181', number: '181', category: 'women', name: 'hl.181.name', description: 'hl.181.desc', allDay: true },
  { id: 'women1091', number: '1091', category: 'women', name: 'hl.1091.name', description: 'hl.1091.desc', allDay: false },
  { id: 'ncwwa', number: '7827170170', category: 'women', name: 'hl.7827170170.name', description: 'hl.7827170170.desc', allDay: true },

  // Children
  { id: 'childline', number: '1098', category: 'children', name: 'hl.1098.name', description: 'hl.1098.desc', allDay: true },
  { id: 'child112', number: '112', category: 'children', name: 'hl.112.name', description: 'hl.112.child', allDay: true },

  // Men (no dedicated government line; these gender-neutral services help men)
  { id: 'men112', number: '112', category: 'men', name: 'hl.112.name', description: 'hl.112.men', allDay: true },
  { id: 'menmanas', number: '14416', category: 'men', name: 'hl.14416.name', description: 'hl.14416.men', allDay: true },
  { id: 'mennhrc', number: '14433', category: 'men', name: 'hl.14433.name', description: 'hl.14433.desc', allDay: false },
  { id: 'mencyber', number: '1930', category: 'men', name: 'hl.1930.name', description: 'hl.1930.desc', allDay: true },

  // Health
  { id: 'manas', number: '14416', category: 'health', name: 'hl.14416.name', description: 'hl.14416.desc', allDay: true },
  { id: 'narcotics', number: '1933', category: 'health', name: 'hl.1933.name', description: 'hl.1933.desc', allDay: false },

  // Elders and disability
  { id: 'elderline', number: '14567', category: 'elders', name: 'hl.14567.name', description: 'hl.14567.desc', allDay: false },
  { id: 'pwd', number: '14456', category: 'elders', name: 'hl.14456.name', description: 'hl.14456.desc', allDay: false },

  // Travel
  { id: 'highway', number: '1033', category: 'travel', name: 'hl.1033.name', description: 'hl.1033.desc', allDay: true },
  { id: 'road', number: '1073', category: 'travel', name: 'hl.1073.name', description: 'hl.1073.desc', allDay: true },
  { id: 'rail', number: '139', category: 'travel', name: 'hl.139.name', description: 'hl.139.desc', allDay: true },
  { id: 'tourist', number: '1363', category: 'travel', name: 'hl.1363.name', description: 'hl.1363.desc', allDay: true },

  // Cyber and rights
  { id: 'cyber', number: '1930', category: 'cyber', name: 'hl.1930.name', description: 'hl.1930.desc', allDay: true },
  { id: 'nhrc', number: '14433', category: 'cyber', name: 'hl.14433.name', description: 'hl.14433.desc', allDay: false },
];

/** Shown on Home: the four numbers people most need in a hurry. */
export const HOME_HELPLINE_IDS = ['erss', 'ncw', 'childline', 'amb108'];

/** Readable grouping for long numbers, e.g. 78271 70170. */
export function formatHelplineNumber(n: string): string {
  return n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;
}

import type { StringKey } from './en';

export type Translation = Partial<Record<StringKey, string>>;

// Filled in by the per-language files; English is the fallback in translate().
export const TRANSLATIONS: Record<string, Translation> = {};

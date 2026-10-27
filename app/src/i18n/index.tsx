import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en, { StringKey } from './locales/en';
import { TRANSLATIONS } from './locales';

/**
 * App-wide language. English is the source; every other language falls back to English
 * for any string it does not translate yet, so a missing translation never shows a key.
 */
export type LanguageCode =
  | 'en' | 'hi' | 'bn' | 'te' | 'mr' | 'ta' | 'ur' | 'gu' | 'kn' | 'ml' | 'or' | 'pa' | 'as';

export interface LanguageInfo {
  code: LanguageCode;
  /** Name in the language itself, shown in the picker. */
  native: string;
  english: string;
  rtl?: boolean;
}

/** English plus the twelve most widely spoken scheduled languages of India. */
export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'ur', native: 'اردو', english: 'Urdu', rtl: true },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'as', native: 'অসমীয়া', english: 'Assamese' },
];

const STORAGE_KEY = '@shield_language';

export type TFunction = (key: StringKey, params?: Record<string, string | number>) => string;

interface I18nValue {
  lang: LanguageCode;
  language: LanguageInfo;
  setLang: (code: LanguageCode) => void;
  t: TFunction;
  /** Text alignment for the current script (right for Urdu). */
  textAlign: 'left' | 'right';
}

function deviceLanguage(): LanguageCode {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale?.toLowerCase() ?? 'en';
    const base = tag.split('-')[0] as LanguageCode;
    return LANGUAGES.some((l) => l.code === base) ? base : 'en';
  } catch {
    return 'en';
  }
}

export function translate(lang: LanguageCode, key: StringKey, params?: Record<string, string | number>): string {
  const table = TRANSLATIONS[lang] as Partial<Record<StringKey, string>> | undefined;
  let text = table?.[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  language: LANGUAGES[0],
  setLang: () => undefined,
  t: (key, params) => translate('en', key, params),
  textAlign: 'left',
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(deviceLanguage);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved && LANGUAGES.some((l) => l.code === saved)) setLangState(saved as LanguageCode);
      })
      .catch(() => undefined);
  }, []);

  const setLang = useCallback((code: LanguageCode) => {
    setLangState(code);
    AsyncStorage.setItem(STORAGE_KEY, code).catch(() => undefined);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const language = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
    return {
      lang,
      language,
      setLang,
      t: (key, params) => translate(lang, key, params),
      textAlign: language.rtl ? 'right' : 'left',
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export type { StringKey };

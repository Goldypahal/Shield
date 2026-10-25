import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorTokens, lightColors, darkColors } from './colors';
import { typography } from './typography';
import { spacing, radii, shadows } from './spacing';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  mode: ThemeMode;
  resolvedMode: ResolvedTheme;
  isDark: boolean;
  colors: ColorTokens;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  shadows: typeof shadows;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const THEME_STORAGE_KEY = '@heimdal_theme_mode';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function loadSavedTheme() {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved as ThemeMode);
        }
      } catch (err) {
        console.warn('Failed to load theme preference', err);
      } finally {
        setIsReady(true);
      }
    }
    loadSavedTheme();
  }, []);

  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (err) {
      console.warn('Failed to persist theme preference', err);
    }
  };

  const resolvedMode: ResolvedTheme = useMemo(() => {
    if (mode === 'system') {
      return systemColorScheme === 'dark' ? 'dark' : 'light';
    }
    return mode;
  }, [mode, systemColorScheme]);

  const isDark = resolvedMode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const contextValue = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedMode,
    isDark,
    colors,
    typography,
    spacing,
    radii,
    shadows,
    setMode,
  }), [mode, resolvedMode, isDark, colors]);

  if (!isReady) {
    return null;
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

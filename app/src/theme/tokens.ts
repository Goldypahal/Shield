export const TOKENS = {
  colors: {
    brand: {
      orange: '#FF5A1F',
      orangeHover: '#E64A12',
      orangePressed: '#CC400F',
      orangeTint: '#FFF0E8',
      navy: '#0B132B',
      gold: '#F59E0B',
    },
    safe: {
      green: '#22C55E',
      dark: '#16A34A',
      tint: '#ECFDF3',
      border: '#86EFAC',
    },
    moderate: {
      amber: '#F59E0B',
      dark: '#D97706',
      tint: '#FFF8E6',
      border: '#FCD34D',
    },
    risk: {
      red: '#EF4444',
      dark: '#DC2626',
      tint: '#FEF2F2',
      border: '#FCA5A5',
    },
    ink: {
      900: '#1F2937',
      600: '#4B5563',
      400: '#9CA3AF',
      300: '#D1D5DB',
      100: '#F3F4F6',
    },
    surface: {
      bg: '#FFFFFF',
      card: '#FFFFFF',
      divider: '#F1E5DB',
    },
    map: {
      bg: '#0B1220',
    },
  },
  radii: {
    button: 14,
    card: 16,
    sheetTop: 28,
    pill: 999,
  },
  shadows: {
    card: {
      shadowColor: '#1F2937',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
      elevation: 3,
    },
    floating: {
      shadowColor: '#1F2937',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 6,
    },
    sos: {
      shadowColor: '#EF4444',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.45,
      shadowRadius: 30,
      elevation: 10,
    },
  },
  typography: {
    appName: {
      fontSize: 22,
      fontWeight: '800' as const,
      letterSpacing: 3.5,
    },
    tagline: {
      fontSize: 12,
      fontWeight: '500' as const,
      color: '#FF5A1F',
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700' as const,
    },
    routeTime: {
      fontSize: 22,
      fontWeight: '800' as const,
    },
    routeCardLabel: {
      fontSize: 11,
      fontWeight: '700' as const,
      letterSpacing: 0.5,
      textTransform: 'uppercase' as const,
    },
    bulletText: {
      fontSize: 11,
      fontWeight: '500' as const,
    },
    buttonText: {
      fontSize: 13,
      fontWeight: '600' as const,
    },
    tabLabel: {
      fontSize: 11,
      fontWeight: '500' as const,
    },
  },
} as const;

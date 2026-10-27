export interface ColorTokens {
  background: string;
  surface: string;
  surfaceSecondary: string;
  surfaceElevated: string;
  border: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverted: string;
  
  // Brand
  brandPrimary: string;
  brandAccent: string;
  brandGold: string;
  brandGoldLight: string;
  
  // Status & Safety
  statusSuccess: string;
  statusSuccessBg: string;
  statusSuccessBorder: string;
  statusSuccessText: string;
  
  statusWarning: string;
  statusWarningBg: string;
  
  // Emergency SOS
  sosPrimary: string;
  sosSecondary: string;
  sosRing: string;
  sosOuterRing: string;
  sosText: string;
  
  // Navigation
  navBackground: string;
  navBorder: string;
  navActive: string;
  navInactive: string;
  
  // Map visualization
  mapBackground: string;
  mapGrid: string;
  mapBuilding: string;
  mapRoad: string;
  mapRoute: string;
  mapRouteGlow: string;
  mapStartMarker: string;
  mapEndMarker: string;
  mapAccuracyFill: string;
  mapAccuracyBorder: string;
  
  // Shadow/Overlay
  shadowColor: string;
  cardOverlay: string;
  badgeBg: string;
}

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSecondary: '#FFF4EC',
  surfaceElevated: '#FFFFFF',
  border: '#F1E5DB',
  borderSubtle: '#FAF2EC',
  textPrimary: '#0B132B',
  textSecondary: '#5C6675',
  textMuted: '#98A2B3',
  textInverted: '#FFFFFF',
  
  brandPrimary: '#FF5A1F',
  brandAccent: '#FF5A1F',
  brandGold: '#F59E0B',
  brandGoldLight: '#FFF4D6',
  
  statusSuccess: '#10B981',
  statusSuccessBg: '#ECFDF5',
  statusSuccessBorder: '#A7F3D0',
  statusSuccessText: '#047857',
  
  statusWarning: '#F59E0B',
  statusWarningBg: '#FFFBEB',
  
  sosPrimary: '#DC2626',
  sosSecondary: '#EF4444',
  sosRing: 'rgba(239, 68, 68, 0.18)',
  sosOuterRing: 'rgba(239, 68, 68, 0.08)',
  sosText: '#FFFFFF',
  
  navBackground: '#FFFFFF',
  navBorder: '#F1E5DB',
  navActive: '#FF5A1F',
  navInactive: '#98A2B3',
  
  mapBackground: '#FFF7F2',
  mapGrid: '#F1E5DB',
  mapBuilding: '#F7EDE6',
  mapRoad: '#FFFFFF',
  mapRoute: '#FF5A1F',
  mapRouteGlow: 'rgba(255, 90, 31, 0.22)',
  mapStartMarker: '#FF5A1F',
  mapEndMarker: '#DC2626',
  mapAccuracyFill: 'rgba(255, 90, 31, 0.12)',
  mapAccuracyBorder: 'rgba(255, 90, 31, 0.35)',
  
  shadowColor: '#0B132B',
  cardOverlay: 'rgba(255, 255, 255, 0.9)',
  badgeBg: '#FFF4EC',
};

export const darkColors: ColorTokens = {
  background: '#0B111E',
  surface: '#131E32',
  surfaceSecondary: '#1A2844',
  surfaceElevated: '#1A2844',
  border: '#1E2E48',
  borderSubtle: '#18243A',
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textInverted: '#0B111E',
  
  brandPrimary: '#FF5A1F',
  brandAccent: '#FF5A1F',
  brandGold: '#FBBF24',
  brandGoldLight: '#78350F',
  
  statusSuccess: '#10B981',
  statusSuccessBg: 'rgba(16, 185, 129, 0.12)',
  statusSuccessBorder: 'rgba(16, 185, 129, 0.25)',
  statusSuccessText: '#34D399',
  
  statusWarning: '#F59E0B',
  statusWarningBg: 'rgba(245, 158, 11, 0.15)',
  
  sosPrimary: '#EF4444',
  sosSecondary: '#DC2626',
  sosRing: 'rgba(239, 68, 68, 0.25)',
  sosOuterRing: 'rgba(239, 68, 68, 0.12)',
  sosText: '#FFFFFF',
  
  navBackground: '#0E1726',
  navBorder: '#1E2E48',
  navActive: '#FF5A1F',
  navInactive: '#64748B',
  
  mapBackground: '#0F1726',
  mapGrid: '#18243A',
  mapBuilding: '#141E30',
  mapRoad: '#1A2840',
  mapRoute: '#FF5A1F',
  mapRouteGlow: 'rgba(255, 90, 31, 0.3)',
  mapStartMarker: '#FF5A1F',
  mapEndMarker: '#EF4444',
  mapAccuracyFill: 'rgba(255, 90, 31, 0.18)',
  mapAccuracyBorder: 'rgba(255, 90, 31, 0.45)',
  
  shadowColor: '#000000',
  cardOverlay: 'rgba(19, 30, 50, 0.9)',
  badgeBg: '#1A2844',
};

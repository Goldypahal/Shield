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
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',
  surfaceElevated: '#FFFFFF',
  border: '#E2E8F0',
  borderSubtle: '#EDF2F7',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  textInverted: '#FFFFFF',
  
  brandPrimary: '#1E293B',
  brandAccent: '#2563EB',
  brandGold: '#F59E0B',
  brandGoldLight: '#FEF3C7',
  
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
  navBorder: '#E2E8F0',
  navActive: '#2563EB',
  navInactive: '#94A3B8',
  
  mapBackground: '#F1F5F9',
  mapGrid: '#E2E8F0',
  mapBuilding: '#E2E8F0',
  mapRoad: '#FFFFFF',
  mapRoute: '#2563EB',
  mapRouteGlow: 'rgba(37, 99, 235, 0.25)',
  mapStartMarker: '#2563EB',
  mapEndMarker: '#EF4444',
  mapAccuracyFill: 'rgba(37, 99, 235, 0.12)',
  mapAccuracyBorder: 'rgba(37, 99, 235, 0.35)',
  
  shadowColor: '#0F172A',
  cardOverlay: 'rgba(255, 255, 255, 0.9)',
  badgeBg: '#F1F5F9',
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
  
  brandPrimary: '#3B82F6',
  brandAccent: '#3B82F6',
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
  navActive: '#3B82F6',
  navInactive: '#64748B',
  
  mapBackground: '#0F1726',
  mapGrid: '#18243A',
  mapBuilding: '#141E30',
  mapRoad: '#1A2840',
  mapRoute: '#3B82F6',
  mapRouteGlow: 'rgba(59, 130, 246, 0.3)',
  mapStartMarker: '#3B82F6',
  mapEndMarker: '#EF4444',
  mapAccuracyFill: 'rgba(59, 130, 246, 0.18)',
  mapAccuracyBorder: 'rgba(59, 130, 246, 0.45)',
  
  shadowColor: '#000000',
  cardOverlay: 'rgba(19, 30, 50, 0.9)',
  badgeBg: '#1A2844',
};

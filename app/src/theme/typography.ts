import { TextStyle } from 'react-native';

export const typography = {
  // Headings
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as TextStyle['fontWeight'],
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as TextStyle['fontWeight'],
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as TextStyle['fontWeight'],
    letterSpacing: -0.2,
  },
  h4: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as TextStyle['fontWeight'],
  },
  
  // Body text
  bodyLarge: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as TextStyle['fontWeight'],
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as TextStyle['fontWeight'],
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as TextStyle['fontWeight'],
  },
  
  // Subtitle / Caption
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as TextStyle['fontWeight'],
  },
  
  // Buttons
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600' as TextStyle['fontWeight'],
    letterSpacing: 0.1,
  },
  
  // Brand
  brandName: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800' as TextStyle['fontWeight'],
    letterSpacing: -0.8,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500' as TextStyle['fontWeight'],
  },
  
  // Metric
  metricValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700' as TextStyle['fontWeight'],
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as TextStyle['fontWeight'],
  },
};

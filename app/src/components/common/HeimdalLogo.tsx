import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { useTheme } from '../../theme';

interface HeimdalLogoProps {
  size?: number;
}

export default function HeimdalLogo({ size = 80 }: HeimdalLogoProps) {
  const { colors, isDark } = useTheme();

  const goldColor = isDark ? '#FBBF24' : '#F59E0B';
  const shieldBodyColor = isDark ? '#1E293B' : '#1E293B';
  const keyholeCutoutColor = isDark ? '#0B111E' : '#F8FAFC';

  return (
    <View style={[styles.container, { width: size, height: size * 1.15 }]}>
      <Svg
        width={size}
        height={size * 1.15}
        viewBox="0 0 100 115"
        fill="none"
      >
        <G>
          {/* Top Golden Roof / Crest Chevron */}
          <Path
            d="M 50 4 
               L 92 24 
               L 84 32 
               L 50 16 
               L 16 32 
               L 8 24 
               Z"
            fill={goldColor}
          />
          
          {/* Main Shield Body */}
          <Path
            d="M 18 36 
               L 50 21 
               L 82 36 
               C 82 68, 68 96, 50 110 
               C 32 96, 18 68, 18 36 
               Z"
            fill={shieldBodyColor}
          />

          {/* Keyhole cut-out inside shield */}
          <Path
            d="M 50 50 
               m -7 0 
               a 7 7 0 1 0 14 0 
               a 7 7 0 1 0 -14 0"
            fill={keyholeCutoutColor}
          />
          <Path
            d="M 46.5 53 
               L 53.5 53 
               L 55.5 72 
               L 44.5 72 
               Z"
            fill={keyholeCutoutColor}
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

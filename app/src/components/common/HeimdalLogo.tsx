import React from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, View } from 'react-native';

interface HeimdalLogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export default function HeimdalLogo({ size = 80, style }: HeimdalLogoProps) {
  const height = size * (1122 / 1402);

  return (
    <View style={[styles.container, { width: size, height }]}>
      <Image
        source={require('../../../assets/images/heimdal_logo.png')}
        style={[
          {
            width: size,
            height,
          },
          style,
        ]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="HEIMDAL: Watch | Protect | Respond"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle on-device ML models (assets/models/*.tflite) so they can be loaded with require()
config.resolver.assetExts.push('tflite');

module.exports = config;

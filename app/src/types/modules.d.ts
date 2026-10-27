declare module 'crypto-js';
declare module 'react-native-rsa-native';

declare module 'maplibre-gl' {
  export type Map = any;
  export type Marker = any;
  export type GeoJSONSource = any;
  const content: any;
  export default content;
}

declare module '@maplibre/maplibre-react-native' {
  export type CameraRef = any;
  export const Map: any;
  export const Camera: any;
  export const GeoJSONSource: any;
  export const Layer: any;
  export const Marker: any;
  const content: any;
  export default content;
}

declare module 'react-native-fast-tflite' {
  export type TfliteModel = any;
  export function loadTensorflowModel(path: any): Promise<any>;
  const content: any;
  export default content;
}

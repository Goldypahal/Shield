import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { NavMapProps, PLACE_COLORS } from './navMapShared';
import { navMapHtml } from './navMapHtml';

/** Phone map: MapLibre GL JS + OpenFreeMap in a WebView (see navMapHtml.ts). */
export default function NavMapWebView(props: NavMapProps) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const handlers = useRef(props);
  handlers.current = props;
  const html = useMemo(() => navMapHtml(), []);

  const { routes, selectedId, origin, destination, places, incidents, me, fitKey, recenterKey, follow, padding } = props;
  const payload = useMemo(() => JSON.stringify({
    routes: routes.map((r) => ({ id: r.id, coords: r.coords, caution: r.caution.map((c) => ({ coords: c.coords })), color: r.color })),
    selectedId,
    origin,
    destination,
    places: places.map((p) => ({ lat: p.lat, lon: p.lon, color: PLACE_COLORS[p.kind] })),
    incidents: incidents.map((p) => ({ lat: p.lat, lon: p.lon })),
    me: me ? { lat: me.lat, lon: me.lon, accuracy: me.accuracy } : null,
    fitKey,
    recenterKey,
    follow,
    padding,
  }), [routes, selectedId, origin, destination, places, incidents, me, fitKey, recenterKey, follow, padding.top, padding.bottom]);

  const send = () => web.current?.injectJavaScript(`window.__update && window.__update(${payload}); true;`);
  useEffect(() => { if (ready.current) send(); }, [payload]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    const h = handlers.current;
    if (m.type === 'ready') { ready.current = true; send(); }
    else if (m.type === 'selectRoute') h.onSelectRoute(m.id);
    else if (m.type === 'selectPlace' && h.places[m.i]) h.onSelectPlace(h.places[m.i]);
    else if (m.type === 'longPress') h.onLongPress({ lat: m.lat, lon: m.lon });
    else if (m.type === 'error') console.warn('[NavMap] map error:', m.message);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://shield.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        androidLayerType="hardware"
        style={styles.web}
        onLoadStart={() => { ready.current = false; }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#E5E7EB' } });

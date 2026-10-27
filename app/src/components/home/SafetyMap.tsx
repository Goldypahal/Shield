import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import MapControls from './MapControls';

interface SafetyMapProps {
  onShowToast: (message: string) => void;
}

const CARTO_KEY = 'cb1_4uf4_1_3a6cdee0f5a3fede97b66881';

export default function SafetyMap({ onShowToast }: SafetyMapProps) {
  const {
    routes,
    selectedRoute,
    selectRoute,
    origin,
    destination,
    activeLayers,
    isJourneyActive,
    startJourney,
    mapType,
    currentStepIndex,
  } = useJourneyStore();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const postStateToMap = () => {
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'UPDATE_MAP',
          mapType,
          routes,
          selectedRoute,
          origin,
          destination,
          activeLayers,
          isJourneyActive,
          currentStepIndex,
        },
        '*'
      );
    }
  };

  useEffect(() => {
    postStateToMap();
  }, [routes, selectedRoute, origin, destination, activeLayers, isJourneyActive, mapType, currentStepIndex]);

  // Handle postMessage from Leaflet map
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'SELECT_ROUTE') {
        selectRoute(e.data.routeId);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  const handleRecenter = () => {
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'RECENTER' }, '*');
    }
    onShowToast('Centered on My Location');
  };

  const handleNavigateStart = () => {
    if (!routes || !routes[selectedRoute]) {
      onShowToast('Please select a valid route first');
      return;
    }
    startJourney();
    onShowToast(`Journey started via ${routes[selectedRoute].title}`);
  };

  // Build the complete interactive Leaflet map document
  const mapHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #050A14; transition: background 0.3s; }
    .leaflet-control-attribution { font-size: 8px !important; opacity: 0.6; background: rgba(0,0,0,0.5) !important; color: #FFFFFF !important; }
    
    /* Current location pulsing blue dot */
    .user-pulse-marker {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #FF5A1F;
      border: 3px solid #FFFFFF;
      box-shadow: 0 0 14px rgba(255, 90, 31, 1);
      position: relative;
    }
    .user-pulse-marker::after {
      content: '';
      position: absolute;
      top: -10px; left: -10px; right: -10px; bottom: -10px;
      border-radius: 50%;
      background: rgba(255, 90, 31, 0.45);
      animation: pulse-ring 1.8s infinite ease-out;
    }
    @keyframes pulse-ring {
      0% { transform: scale(0.8); opacity: 0.9; }
      100% { transform: scale(2.4); opacity: 0; }
    }

    /* Destination teardrop pin */
    .dest-pin-marker {
      position: relative;
      display: flex;
      align-items: center;
    }
    .dest-pin-icon {
      width: 26px;
      height: 26px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      background: #FF5A1F;
      border: 2px solid #FFFFFF;
      box-shadow: 0 2px 8px rgba(0,0,0,0.6);
    }
    .dest-label-chip {
      background: rgba(15, 23, 42, 0.9);
      color: #FFFFFF;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 12px;
      white-space: nowrap;
      margin-left: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Route midpoint label bubbles */
    .route-bubble {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 700;
      color: #FFFFFF;
      padding: 4px 9px;
      border-radius: 10px;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 4px 10px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      gap: 4px;
      border: 1.5px solid #FFFFFF;
    }
    .bubble-safer { background: #22C55E; }
    .bubble-moderate { background: #FF5A1F; }
    .bubble-risk { background: #F59E0B; }
    .bubble-alt { background: #475569; }

    /* Live navigation turn-by-turn beacon */
    .nav-active-beacon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #FF5A1F;
      border: 3px solid #FFFFFF;
      box-shadow: 0 0 16px rgba(255, 90, 31, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 14px;
      animation: pulse-beacon 1.6s infinite;
    }
    @keyframes pulse-beacon {
      0% { box-shadow: 0 0 0 0 rgba(255, 90, 31, 0.7); }
      70% { box-shadow: 0 0 0 14px rgba(255, 90, 31, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 90, 31, 0); }
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([30.735, 76.643], 12);
    
    // Map style layer definitions
    var mapLayers = {
      satellite: [
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          attribution: '&copy; Esri World Imagery'
        }),
        L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          opacity: 0.85
        })
      ],
      default: [
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          maxZoom: 19,
          subdomains: 'abcd',
          attribution: '&copy; OpenStreetMap &copy; CARTO'
        })
      ],
      terrain: [
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          attribution: '&copy; Esri World Topographic'
        })
      ]
    };

    var currentMapType = 'satellite';
    function switchMapType(type) {
      if (!mapLayers[type]) type = 'satellite';
      if (type === currentMapType && mapLayers[type][0]._map) return;
      
      // Remove all current basemap layers
      Object.keys(mapLayers).forEach(function(k) {
        mapLayers[k].forEach(function(layer) {
          if (map.hasLayer(layer)) {
            map.removeLayer(layer);
          }
        });
      });

      // Add target style layers
      mapLayers[type].forEach(function(layer) {
        layer.addTo(map);
      });

      currentMapType = type;
      var mapEl = document.getElementById('map');
      if (mapEl) {
        mapEl.style.background = type === 'satellite' ? '#050A14' : '#E5E7EB';
      }
    }

    // Initialize with satellite
    switchMapType('satellite');

    var layerGroup = L.layerGroup().addTo(map);
    var currentData = null;

    function renderMap(data) {
      if (!data) return;
      currentData = data;

      // Handle Map style switch if requested
      if (data.mapType && data.mapType !== currentMapType) {
        switchMapType(data.mapType);
      }

      layerGroup.clearLayers();

      // Always draw accurate live user location marker
      if (data.origin) {
        L.marker([data.origin.lat, data.origin.lng], {
          icon: L.divIcon({ html: '<div class="user-pulse-marker"></div>', className: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
          zIndexOffset: 1000
        }).addTo(layerGroup);
      }

      // If destination exists, draw destination pin
      if (data.destination) {
        var destHtml = '<div class="dest-pin-marker"><div class="dest-pin-icon"></div><div class="dest-label-chip">' + data.destination.label.split(',')[0] + '</div></div>';
        L.marker([data.destination.lat, data.destination.lng], {
          icon: L.divIcon({ html: destHtml, className: '', iconSize: [160, 30], iconAnchor: [12, 24] }),
          zIndexOffset: 900
        }).addTo(layerGroup);
      }

      // If no route exists (e.g. transit unavailable, or initial state)
      if (!data.destination || !data.routes) {
        if (data.origin && data.destination) {
          // Zoom bounds to both points even if no transit line is possible
          var boundsNoRoute = L.latLngBounds([
            [data.origin.lat, data.origin.lng],
            [data.destination.lat, data.destination.lng]
          ]);
          map.fitBounds(boundsNoRoute, { padding: [50, 50], maxZoom: 16 });
        } else if (data.origin) {
          map.setView([data.origin.lat, data.origin.lng], 16, { animate: true });
        }
        return;
      }

      var routes = data.routes;
      var selected = data.selectedRoute;

      // Draw real road lines for each calculated route (Google Maps style path view)
      var routeOrder = ['risk', 'moderate', 'safer']; // Draw selected on top
      routeOrder.sort(function(a, b) {
        return a === selected ? 1 : b === selected ? -1 : 0;
      });

      routeOrder.forEach(function(rId) {
        var r = routes[rId];
        if (!r || !r.path || r.path.length < 2) return;
        var isSelected = rId === selected;
        var color = isSelected ? (rId === 'safer' ? '#22C55E' : '#FF5A1F') : '#94A3B8';
        var weight = isSelected ? 8 : 5;
        var opacity = isSelected ? 1 : 0.75;

        // White casing border to make path stand out crisply against satellite/terrain imagery
        L.polyline(r.path, {
          color: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
          weight: weight + 4,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(layerGroup);

        // Main polyline following actual road turns
        var line = L.polyline(r.path, {
          color: color,
          weight: weight,
          opacity: opacity,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(layerGroup);

        line.on('click', function() {
          parent.postMessage({ type: 'SELECT_ROUTE', routeId: rId }, '*');
        });

        // Midpoint Bubble Label (Google Maps style)
        var midIdx = Math.floor(r.path.length / 2);
        var midCoord = r.path[midIdx];
        var labelClass = isSelected ? (rId === 'safer' ? 'bubble-safer' : 'bubble-moderate') : 'bubble-alt';

        var bubbleHtml = '<div class="route-bubble ' + labelClass + '">' + r.minutes + ' min • ' + r.title + '</div>';
        var bubbleMarker = L.marker(midCoord, {
          icon: L.divIcon({ html: bubbleHtml, className: '', iconAnchor: [60, 12] })
        }).addTo(layerGroup);

        bubbleMarker.on('click', function() {
          parent.postMessage({ type: 'SELECT_ROUTE', routeId: rId }, '*');
        });
      });

      // If journey is active, place live navigation beacon and center on current turn
      if (data.isJourneyActive && routes[selected]) {
        var activePath = routes[selected].path;
        var totalSteps = (routes[selected].steps && routes[selected].steps.length) || 4;
        var stepPct = (data.currentStepIndex || 0) / Math.max(1, totalSteps - 1);
        var currentIdx = Math.min(activePath.length - 1, Math.floor(stepPct * (activePath.length - 1)));
        var currentCoord = activePath[currentIdx] || [data.origin.lat, data.origin.lng];

        L.marker(currentCoord, {
          icon: L.divIcon({
            html: '<div class="nav-active-beacon">▲</div>',
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          }),
          zIndexOffset: 1200
        }).addTo(layerGroup);

        map.setView(currentCoord, 17, { animate: true });
      } else {
        // Auto-fit bounds to actual route
        var bounds = L.latLngBounds([
          [data.origin.lat, data.origin.lng],
          [data.destination.lat, data.destination.lng]
        ]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
      }
    }

    window.addEventListener('message', function(e) {
      if (!e.data) return;
      if (e.data.type === 'UPDATE_MAP') {
        renderMap(e.data);
      } else if (e.data.type === 'SET_MAP_TYPE' && e.data.mapType) {
        switchMapType(e.data.mapType);
      } else if (e.data.type === 'RECENTER' && currentData && currentData.origin) {
        map.setView([currentData.origin.lat, currentData.origin.lng], 17, { animate: true });
      }
    });
  </script>
</body>
</html>`;

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={(r) => {
            iframeRef.current = r;
            postStateToMap();
          }}
          srcDoc={mapHtml}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Safety Map"
        />
      ) : (
        <View style={styles.nativeFallback} />
      )}

      {/* Floating Controls (Layers, Recenter, Navigate) */}
      <MapControls onRecenter={handleRecenter} onNavigateStart={handleNavigateStart} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 280,
    backgroundColor: '#0B1220',
    position: 'relative',
    overflow: 'hidden',
  },
  nativeFallback: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
});

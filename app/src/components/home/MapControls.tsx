import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, Text, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore, MapType } from '../../store/useJourneyStore';

interface MapControlsProps {
  onRecenter: () => void;
  onNavigateStart: () => void;
}

export default function MapControls({ onRecenter, onNavigateStart }: MapControlsProps) {
  const { mapType, setMapType, activeLayers, toggleLayer } = useJourneyStore();
  const [layersMenuVisible, setLayersMenuVisible] = useState(false);

  const MAP_TYPES: { key: MapType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'satellite', label: 'Satellite', icon: 'earth' },
    { key: 'default', label: 'Default / Plain', icon: 'map' },
    { key: 'terrain', label: 'Terrain', icon: 'trail-sign' },
  ];

  return (
    <View style={styles.container}>
      {/* 1. Layers Toggle Button (Google Maps style) */}
      <TouchableOpacity
        style={styles.controlBtn}
        onPress={() => setLayersMenuVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Map type and layers"
        activeOpacity={0.8}
      >
        <Ionicons name="layers" size={20} color="#202124" />
      </TouchableOpacity>

      {/* 2. My Location (Recenter) Button */}
      <TouchableOpacity
        style={styles.controlBtn}
        onPress={onRecenter}
        accessibilityRole="button"
        accessibilityLabel="Recenter map on my location"
        activeOpacity={0.8}
      >
        <Ionicons name="locate" size={20} color="#FF5A1F" />
      </TouchableOpacity>

      {/* 3. Navigate (Start Route) Button */}
      <TouchableOpacity
        style={[styles.controlBtn, styles.navigateBtn]}
        onPress={onNavigateStart}
        accessibilityRole="button"
        accessibilityLabel="Start navigation"
        activeOpacity={0.8}
      >
        <Ionicons name="navigate" size={20} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Google Maps Style Map Type & Details Modal */}
      <Modal
        visible={layersMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLayersMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setLayersMenuVisible(false)}
        >
          <View style={styles.menuCard}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Map details</Text>
              <TouchableOpacity onPress={() => setLayersMenuVisible(false)}>
                <Ionicons name="close" size={20} color="#5F6368" />
              </TouchableOpacity>
            </View>

            {/* Google Maps Map Type Grid */}
            <Text style={styles.sectionHeading}>Map type</Text>
            <View style={styles.mapTypeGrid}>
              {MAP_TYPES.map((t) => {
                const isActive = mapType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[
                      styles.mapTypeOption,
                      isActive && styles.activeMapTypeOption,
                    ]}
                    onPress={() => {
                      setMapType(t.key);
                      setLayersMenuVisible(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.mapTypeIconCircle,
                        isActive && { backgroundColor: '#FFF0E8' },
                      ]}
                    >
                      <Ionicons
                        name={t.icon}
                        size={22}
                        color={isActive ? '#FF5A1F' : '#5F6368'}
                      />
                    </View>
                    <Text
                      style={[
                        styles.mapTypeLabel,
                        isActive && { color: '#FF5A1F', fontWeight: '700' },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Safety Layers Toggle */}
            <Text style={[styles.sectionHeading, { marginTop: 16 }]}>Map details</Text>
            <View style={styles.layerRow}>
              <View style={styles.layerIconTitle}>
                <Ionicons name="shield-checkmark" size={18} color="#16A34A" />
                <Text style={styles.layerText}>Verified Safe Zones</Text>
              </View>
              <Switch
                value={true}
                disabled
                trackColor={{ false: '#E5E7EB', true: '#86EFAC' }}
                thumbColor="#16A34A"
              />
            </View>

            <View style={styles.layerRow}>
              <View style={styles.layerIconTitle}>
                <Ionicons name="bulb-outline" size={18} color="#D97706" />
                <Text style={styles.layerText}>Street Lighting Info</Text>
              </View>
              <Switch
                value={activeLayers.streetlights}
                onValueChange={() => toggleLayer('streetlights')}
                trackColor={{ false: '#E5E7EB', true: '#FCD34D' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    top: 70,
    gap: 10,
    zIndex: 15,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F2937',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  navigateBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    borderColor: TOKENS.colors.brand.orange,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  menuCard: {
    width: '90%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 10,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#70757A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  mapTypeGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  mapTypeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DADCE0',
    backgroundColor: '#FFFFFF',
  },
  activeMapTypeOption: {
    borderColor: '#FF5A1F',
    backgroundColor: '#F8FAFD',
  },
  mapTypeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F3F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  mapTypeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3C4043',
    textAlign: 'center',
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
  },
  layerIconTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  layerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#202124',
  },
});

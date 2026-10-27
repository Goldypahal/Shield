import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { RouteItem } from '../../data/mockRoutes';

interface RouteDetailsModalProps {
  visible: boolean;
  route: RouteItem;
  onClose: () => void;
}

export default function RouteDetailsModal({ visible, route, onClose }: RouteDetailsModalProps) {
  const { lightingScore, walkabilityScore, incidentCount30d, openShopsNearby } = route.breakdown;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />
          
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{route.title} Details</Text>
              <Text style={styles.subtitle}>
                {route.distanceKm} km • {route.minutes} minutes walk
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={TOKENS.colors.ink[600]} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Safety Metrics Grid */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Ionicons name="flashlight" size={22} color={TOKENS.colors.brand.gold} />
                <Text style={styles.metricValue}>{lightingScore}%</Text>
                <Text style={styles.metricLabel}>Lighting Coverage</Text>
              </View>

              <View style={styles.metricCard}>
                <Ionicons name="footsteps" size={22} color={TOKENS.colors.safe.green} />
                <Text style={styles.metricValue}>{walkabilityScore}%</Text>
                <Text style={styles.metricLabel}>Walkability Score</Text>
              </View>

              <View style={styles.metricCard}>
                <Ionicons name="shield-checkmark" size={22} color={TOKENS.colors.safe.green} />
                <Text style={styles.metricValue}>0</Text>
                <Text style={styles.metricLabel}>Cases Registered</Text>
              </View>

              <View style={styles.metricCard}>
                <Ionicons name="storefront" size={22} color={TOKENS.colors.brand.orange} />
                <Text style={styles.metricValue}>{openShopsNearby}</Text>
                <Text style={styles.metricLabel}>Open Havens / Shops</Text>
              </View>
            </View>

            {/* Badges List */}
            <Text style={styles.sectionHeading}>Route Highlights</Text>
            {route.badges.map((b, i) => (
              <View key={i} style={styles.highlightRow}>
                <Ionicons name="checkmark-circle" size={18} color={TOKENS.colors.safe.green} />
                <Text style={styles.highlightText}>{b.text}</Text>
              </View>
            ))}

            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Back to Map</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
  },
  subtitle: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    marginTop: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  metricCard: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: TOKENS.colors.ink[900],
    marginTop: 6,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: TOKENS.colors.ink[600],
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: TOKENS.colors.ink[900],
    marginBottom: 10,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  highlightText: {
    fontSize: 13,
    color: TOKENS.colors.ink[900],
    marginLeft: 8,
    fontWeight: '500',
  },
  doneBtn: {
    backgroundColor: TOKENS.colors.brand.orange,
    borderRadius: 14,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

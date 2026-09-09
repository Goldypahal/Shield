import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert as RNAlert } from 'react-native';
import AuthService from '../services/authService';
import LocationTracker from '../services/LocationTracker';
import NotificationService from '../services/notificationService';

interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  victim_name: string;
  threat_level: string;
  explainable_reason: string;
  lat: number;
  lon: number;
  state: string;
}

export default function GuardianDashboard() {
  const [activeAlerts, setActiveAlerts] = useState<IncidentAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestTrailPoint, setLatestTrailPoint] = useState<{ lat: number; lon: number } | null>(null);
  const subscribedAlertId = useRef<string | null>(null);
  const seenIncidentIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    const loadAlerts = async () => {
      try {
        const client = await AuthService.getAuthenticatedClient();
        const response = await client.get<{ incidents: IncidentAlert[] }>('/api/v1/incidents/active');
        if (!mounted) return;

        const incidents = response.data.incidents || [];
        setActiveAlerts(incidents);

        incidents.forEach((incident) => {
          if (seenIncidentIds.current.has(incident.incident_id)) return;
          seenIncidentIds.current.add(incident.incident_id);
          NotificationService.notifyGuardianAlert(
            `Guardian alert: ${incident.threat_level.toUpperCase()}`,
            incident.explainable_reason
          ).catch(() => undefined);
        });

        const firstLiveAlert = incidents.find((incident) => incident.alert_id);
        if (firstLiveAlert && subscribedAlertId.current !== firstLiveAlert.alert_id) {
          subscribedAlertId.current = firstLiveAlert.alert_id;
          await LocationTracker.subscribeToLiveIncident(firstLiveAlert.alert_id, (locationData) => {
            setLatestTrailPoint({ lat: locationData.lat, lon: locationData.lon });
          });
        }
      } catch (error) {
        if (mounted) {
          console.warn('Failed to load guardian feed', error);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
      LocationTracker.unsubscribeFromLiveIncident();
    };
  }, []);

  const handleRespond = async (incidentId: string) => {
    try {
      const client = await AuthService.getAuthenticatedClient();
      await client.put(`/api/v1/incidents/${incidentId}/state`, { state: 'verified' });
      setActiveAlerts((prev) =>
        prev.map((alert) =>
          alert.incident_id === incidentId ? { ...alert, state: 'verified' } : alert
        )
      );
      RNAlert.alert('Responding', 'You have marked yourself as responding.');
    } catch (error) {
      RNAlert.alert('Update Failed', 'Could not update the incident state.');
    }
  };

  const escalatePolice = async (incidentId: string) => {
    try {
      const client = await AuthService.getAuthenticatedClient();
      await client.put(`/api/v1/incidents/${incidentId}/state`, { state: 'active' });
      RNAlert.alert('Escalated', 'The incident has been marked for urgent escalation.');
    } catch (error) {
      RNAlert.alert('Escalation Failed', 'Could not escalate this incident right now.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Guardian Dashboard</Text>

      {latestTrailPoint && (
        <View style={styles.liveTrailCard}>
          <Text style={styles.liveTrailTitle}>Latest Live Trail Point</Text>
          <Text style={styles.liveTrailText}>
            {latestTrailPoint.lat.toFixed(5)}, {latestTrailPoint.lon.toFixed(5)}
          </Text>
        </View>
      )}

      {!loading && activeAlerts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No active alerts.</Text>
        </View>
      ) : (
        activeAlerts.map((alert) => (
          <View key={alert.incident_id} style={styles.alertCard}>
            <View style={styles.headerRow}>
              <Text style={styles.victimName}>{alert.victim_name}</Text>
              <View style={[styles.badge, alert.threat_level === 'high' ? styles.badgeHigh : styles.badgeMedium]}>
                <Text style={styles.badgeText}>{alert.threat_level.toUpperCase()} Risk</Text>
              </View>
            </View>

            <View style={styles.explainBlock}>
              <Text style={styles.explainTitle}>Why was this triggered?</Text>
              <Text style={styles.explainText}>{alert.explainable_reason}</Text>
            </View>

            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapText}>Live trail coordinates</Text>
              <Text style={styles.coordText}>Lat: {alert.lat}, Lon: {alert.lon}</Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.callButton}>
                <Text style={styles.callText}>Call Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.respondButton, alert.state === 'verified' && styles.respondedButton]}
                onPress={() => handleRespond(alert.incident_id)}
              >
                <Text style={styles.respondText}>
                  {alert.state === 'verified' ? 'Responding' : "I'm Responding"}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.escalateButton} onPress={() => escalatePolice(alert.incident_id)}>
              <Text style={styles.escalateText}>Escalate to Police</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  title: { color: '#FFF', fontSize: 28, fontWeight: 'bold', marginBottom: 20, paddingTop: 40 },
  liveTrailCard: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 16, marginBottom: 16 },
  liveTrailTitle: { color: '#AAA', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  liveTrailText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyStateText: { color: '#888', fontSize: 16 },
  alertCard: { backgroundColor: '#1E1E1E', borderRadius: 16, padding: 20, marginBottom: 20, borderLeftWidth: 4, borderLeftColor: '#F44336' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  victimName: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  badgeHigh: { backgroundColor: '#F44336' },
  badgeMedium: { backgroundColor: '#FF9800' },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  explainBlock: { backgroundColor: '#2A2A2A', padding: 12, borderRadius: 8, marginBottom: 15 },
  explainTitle: { color: '#AAA', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  explainText: { color: '#E0E0E0', fontSize: 14, lineHeight: 20 },
  mapPlaceholder: { height: 120, backgroundColor: '#333', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  mapText: { color: '#888', fontSize: 14, marginBottom: 5 },
  coordText: { color: '#AAA', fontSize: 12 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  callButton: { flex: 1, backgroundColor: '#333', padding: 12, borderRadius: 8, marginRight: 10, alignItems: 'center' },
  callText: { color: '#FFF', fontWeight: 'bold' },
  respondButton: { flex: 1, backgroundColor: '#2196F3', padding: 12, borderRadius: 8, marginLeft: 10, alignItems: 'center' },
  respondedButton: { backgroundColor: '#4CAF50' },
  respondText: { color: '#FFF', fontWeight: 'bold' },
  escalateButton: { backgroundColor: '#D32F2F', padding: 15, borderRadius: 8, alignItems: 'center' },
  escalateText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});

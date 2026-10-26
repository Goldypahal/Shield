import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import PinPromptModal from '../common/PinPromptModal';
import { LatLon, PlannedRoute, formatDistance } from '../../services/routeService';
import { Trip, TripMode, TripStatus, confirmTripSafe, endTrip, reportMissedCheckin, startTrip } from '../../services/tripService';
import { Instruction, VoiceGuide, buildInstructions, distanceM } from '../../services/voiceGuide';
import { authErrorMessage } from '../../services/authService';

interface TripPanelProps {
  route: PlannedRoute;
  destinationName: string;
  mode: TripMode;
  vehiclePlate: string | null;
  onPosition: (p: LatLon) => void;
  onEnded: (message?: string) => void;
}

const CHECKIN_TIMEOUT_S = 60;

/**
 * Live walk/ride: shares the trip with guardians, speaks turns and caution warnings,
 * and asks "Are you OK?" when the server sees a deviation or a long stop. No answer
 * within a minute alerts the guardians; answering "I'm OK" needs the SOS PIN.
 */
export default function TripPanel({ route, destinationName, mode, vehiclePlate, onPosition, onEnded }: TripPanelProps) {
  const { colors, typography, radii } = useTheme();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [starting, setStarting] = useState(true);
  const [status, setStatus] = useState<TripStatus | null>(null);
  const [position, setPosition] = useState<LatLon | null>(null);
  const [next, setNext] = useState<{ ins: Instruction | null; dist: number }>({ ins: null, dist: 0 });
  const [voiceOn, setVoiceOn] = useState(true);
  const [checkinLeft, setCheckinLeft] = useState<number | null>(null);
  const [alerted, setAlerted] = useState(false);
  const [pinFor, setPinFor] = useState<'safe' | 'end' | null>(null);
  const guide = useRef(new VoiceGuide(buildInstructions(route)));
  const tripRef = useRef<Trip | null>(null);

  useEffect(() => {
    let cancelled = false;
    startTrip(route, destinationName, mode, vehiclePlate,
      (pos) => {
        setPosition(pos);
        onPosition(pos);
        const u = guide.current.update([pos.lat, pos.lon]);
        setNext({ ins: u.next, dist: u.distance });
      },
      setStatus)
      .then((t) => {
        if (cancelled) return t.stop();
        tripRef.current = t;
        setTrip(t);
      })
      .catch((e) => onEnded(authErrorMessage(e, 'Could not start the trip. Check your connection.')))
      .finally(() => setStarting(false));
    return () => {
      cancelled = true;
      tripRef.current?.stop();
      guide.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { guide.current.setEnabled(voiceOn); }, [voiceOn]);

  // Server asked for a check-in (deviation or long stop away from a safe place): start the countdown
  useEffect(() => {
    if (status?.checkinRequired && checkinLeft === null && !alerted) setCheckinLeft(CHECKIN_TIMEOUT_S);
  }, [status?.checkinRequired]);

  useEffect(() => {
    if (checkinLeft === null || !trip) return;
    if (checkinLeft <= 0) {
      reportMissedCheckin(trip.id).catch(() => undefined);
      setAlerted(true);
      setCheckinLeft(null);
      setPinFor(null);
      return;
    }
    const t = setTimeout(() => setCheckinLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [checkinLeft, trip]);

  const confirmSafe = async (pin: string) => {
    if (!trip) return null;
    const err = await confirmTripSafe(trip.id, pin);
    if (err) return err;
    setCheckinLeft(null);
    setStatus((s) => (s ? { ...s, checkinRequired: false, deviationAlert: false } : s));
    setPinFor(null);
    return null;
  };

  const finish = async (pin?: string): Promise<string | null> => {
    if (!trip) return null;
    const r = await endTrip(trip.id, pin);
    if (r === 'pin_required') {
      setPinFor('end');
      return null;
    }
    if (r !== 'ended') return r;
    trip.stop();
    setPinFor(null);
    onEnded(status?.arrived ? 'You arrived. Trip ended.' : 'Trip ended.');
    return null;
  };

  const remaining = position
    ? distanceM([position.lat, position.lon], route.coords[route.coords.length - 1])
    : route.distance_m;

  if (starting) {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.brandAccent} />
        <Text style={[typography.bodyMedium, { color: colors.textSecondary, marginLeft: 10 }]}>Starting and sharing with your guardians…</Text>
      </View>
    );
  }

  return (
    <View>
      {checkinLeft !== null && (
        <View style={[styles.alertBox, { backgroundColor: colors.sosRing, borderColor: colors.sosPrimary, borderRadius: radii.lg }]}>
          <Text style={[typography.h4, { color: colors.sosPrimary }]}>Are you OK?</Text>
          <Text style={[typography.bodySmall, { color: colors.textPrimary, marginTop: 2 }]}>
            {status?.deviationAlert ? `You are ${status.deviationM} m off your route.` : 'You have stopped away from a safe place.'}{' '}
            Guardians will be alerted in {checkinLeft}s.
          </Text>
          <View style={[styles.row, { marginTop: 8 }]}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.statusSuccess }]} onPress={() => setPinFor('safe')}
              accessibilityRole="button" accessibilityLabel="I am OK, confirm with PIN">
              <Text style={[typography.button, { color: '#FFFFFF' }]}>I'm OK (PIN)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.sosPrimary, marginLeft: 8 }]}
              onPress={() => setCheckinLeft(0)} accessibilityRole="button" accessibilityLabel="Alert my guardians now">
              <Text style={[typography.button, { color: '#FFFFFF' }]}>Alert now</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {alerted && (
        <Text style={[typography.bodySmall, { color: colors.sosPrimary, marginBottom: 8 }]}>
          Your guardians have been alerted and can see your location.
        </Text>
      )}

      <View style={styles.row}>
        <Ionicons name={next.ins?.kind === 'caution' ? 'warning' : next.ins?.kind === 'arrive' ? 'flag' : 'navigate'} size={24}
          color={next.ins?.kind === 'caution' ? colors.sosPrimary : colors.brandAccent} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[typography.h4, { color: colors.textPrimary }]} numberOfLines={2}>
            {status?.arrived ? 'You have arrived' : next.ins ? next.ins.text : 'Follow the blue line'}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            {next.ins && !status?.arrived ? `in ${formatDistance(next.dist)} · ` : ''}{formatDistance(remaining)} to go
            {mode === 'ride' && vehiclePlate ? ` · ${vehiclePlate}` : ''} · shared live
          </Text>
        </View>
        <TouchableOpacity onPress={() => setVoiceOn((v) => !v)} style={styles.iconBtn}
          accessibilityRole="button" accessibilityLabel={voiceOn ? 'Mute voice guidance' : 'Turn on voice guidance'}>
          <Ionicons name={voiceOn ? 'volume-high' : 'volume-mute'} size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => finish()}
        style={[styles.end, { backgroundColor: status?.arrived ? colors.statusSuccess : colors.sosPrimary, borderRadius: radii.pill }]}
        accessibilityRole="button" accessibilityLabel="End trip"
      >
        <Text style={[typography.button, { color: '#FFFFFF' }]}>{status?.arrived ? "I'm here safely" : 'End trip'}</Text>
      </TouchableOpacity>

      <PinPromptModal
        visible={pinFor !== null}
        title={pinFor === 'safe' ? "Confirm you're OK" : 'End trip early'}
        message={pinFor === 'safe'
          ? 'Enter your SOS PIN so we know it is really you.'
          : 'You are not at your destination. Enter your SOS PIN to stop sharing your location.'}
        confirmLabel={pinFor === 'safe' ? "I'm OK" : 'End trip'}
        dismissLabel="Back"
        onSubmit={pinFor === 'safe' ? confirmSafe : (pin) => finish(pin)}
        onDismiss={() => setPinFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  alertBox: { borderWidth: 1.5, padding: 12, marginBottom: 10 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  iconBtn: { padding: 8 },
  end: { marginTop: 12, paddingVertical: 13, alignItems: 'center' },
});

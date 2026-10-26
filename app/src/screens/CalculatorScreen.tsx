import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import * as Location from 'expo-location';
import { AxiosError } from 'axios';
import AuthService from '../services/authService';
import { checkPinOffline } from '../services/pinVault';

interface CalculatorScreenProps {
  /** Called when the SOS PIN is typed followed by "=". */
  onUnlock: () => void;
  /** Called when the duress PIN is typed followed by "=": send a silent SOS, stay disguised. */
  onDuress: () => void;
}

const KEYS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
];

/**
 * Discreet mode: SHIELD opens as an ordinary, working calculator. Typing the SOS PIN
 * and "=" opens SHIELD; typing the duress PIN and "=" sends a silent SOS while the
 * calculator just shows a result. Anything else is calculated normally.
 */
export default function CalculatorScreen({ onUnlock, onDuress }: CalculatorScreenProps) {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  const apply = (a: number, b: number, o: string) =>
    o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : o === '÷' ? (b === 0 ? NaN : a / b) : b;

  const format = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : 'Error');

  const checkSecret = async (typed: string): Promise<boolean> => {
    if (!/^\d{4,6}$/.test(typed) || op) return false;
    const local = await checkPinOffline(typed);
    if (local === 'normal') { onUnlock(); return true; }
    if (local === 'duress') { onDuress(); return false; } // stays a calculator
    if (local === 'unknown') {
      // No PIN hashes on this phone: ask the server, which opens a silent alert itself for the duress PIN
      try {
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (await AuthService.checkPinOnline(typed, last?.coords.latitude, last?.coords.longitude)) {
          onUnlock();
          return true;
        }
      } catch (e) {
        if ((e as AxiosError).response?.status === 423) return false;
      }
    }
    return false;
  };

  const press = async (k: string) => {
    if (/^\d$/.test(k) || k === '.') {
      if (k === '.' && display.includes('.') && !fresh) return;
      setDisplay(fresh || display === '0' ? (k === '.' ? '0.' : k) : (display + k).slice(0, 15));
      setFresh(false);
      return;
    }
    const cur = parseFloat(display);
    switch (k) {
      case 'C': setDisplay('0'); setAcc(null); setOp(null); setFresh(true); return;
      case '⌫': setDisplay(display.length > 1 ? display.slice(0, -1) : '0'); return;
      case '±': setDisplay(format(-cur)); return;
      case '%': setDisplay(format(cur / 100)); return;
      case '=': {
        if (await checkSecret(display)) return;
        if (op !== null && acc !== null) setDisplay(format(apply(acc, cur, op)));
        setAcc(null); setOp(null); setFresh(true);
        return;
      }
      default: {
        const result = op !== null && acc !== null && !fresh ? apply(acc, cur, op) : cur;
        setAcc(result);
        setDisplay(format(result));
        setOp(k);
        setFresh(true);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Display ${display}`}>{display}</Text>
      {KEYS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => {
            const isOp = ['÷', '×', '−', '+', '='].includes(k);
            const isFn = ['C', '±', '%'].includes(k);
            const pending = op === k && fresh; // operator chosen, waiting for the next number
            return (
              <TouchableOpacity
                key={k}
                onPress={() => press(k)}
                style={[styles.key, { backgroundColor: pending ? '#FFFFFF' : isOp ? '#FF9F0A' : isFn ? '#A5A5A5' : '#333333' }]}
                accessibilityRole="button"
                accessibilityLabel={k}
              >
                <Text style={[styles.keyText, { color: isFn ? '#000000' : pending ? '#FF9F0A' : '#FFFFFF' }]}>{k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', justifyContent: 'flex-end', padding: 14 },
  display: { color: '#FFFFFF', fontSize: 72, fontWeight: '300', textAlign: 'right', marginBottom: 16, paddingHorizontal: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  key: { width: '22.5%', aspectRatio: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  keyText: { fontSize: 30, fontWeight: '500' },
});

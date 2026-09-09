import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Props = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
};

export default function ThreatBanner({ score, level }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Threat Level: {level}</Text>
      <Text style={styles.score}>Score: {score}/100</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#1e1e1e',
    marginBottom: 20
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700'
  },
  score: {
    color: '#ddd',
    marginTop: 6,
    fontSize: 16
  }
});

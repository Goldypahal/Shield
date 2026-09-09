import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  onPress: () => void;
};

export default function SOSButton({ onPress }: Props) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.text}>SOS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#d32f2f',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8
  },
  text: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '800'
  }
});

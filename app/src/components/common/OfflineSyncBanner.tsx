import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import OfflineQueue from '../../services/OfflineQueue';

export default function OfflineSyncBanner() {
  const { colors, typography, radii } = useTheme();
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    return OfflineQueue.onQueueChange((pending) => {
      setCount(pending);
    });
  }, []);

  if (count === 0) return null;

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await OfflineQueue.syncWhenOnline();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          borderRadius: radii.md,
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={18} color={colors.sosPrimary} />
        <Text style={[typography.caption, { color: colors.textPrimary, marginLeft: 8, flex: 1 }]}>
          {count} {count === 1 ? 'alert' : 'alerts'} saved offline. Ready to dispatch.
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.syncButton, { backgroundColor: colors.brandAccent }]}
        onPress={handleSync}
        disabled={syncing}
        accessibilityRole="button"
        accessibilityLabel="Sync offline alerts now"
      >
        {syncing ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="sync-outline" size={14} color="#FFFFFF" />
            <Text style={[typography.caption, { color: '#FFFFFF', marginLeft: 4, fontWeight: '700' }]}>
              Sync
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 20,
    marginTop: 8,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
});

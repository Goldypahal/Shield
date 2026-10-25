import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeMode } from '../../theme';

interface ThemeToggleModalProps {
  visible: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: { label: string; mode: ThemeMode; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Light', mode: 'light', icon: 'sunny-outline' },
  { label: 'Dark', mode: 'dark', icon: 'moon-outline' },
  { label: 'System default', mode: 'system', icon: 'phone-portrait-outline' },
];

export default function ThemeToggleModal({ visible, onClose }: ThemeToggleModalProps) {
  const { mode, setMode, colors, typography, radii } = useTheme();

  const handleSelect = async (selectedMode: ThemeMode) => {
    await setMode(selectedMode);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[
            styles.dialog,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.xl,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>Choose Theme</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsList}>
            {THEME_OPTIONS.map((opt) => {
              const isSelected = mode === opt.mode;

              return (
                <TouchableOpacity
                  key={opt.mode}
                  onPress={() => handleSelect(opt.mode)}
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: isSelected ? colors.surfaceSecondary : 'transparent',
                      borderRadius: radii.md,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.optionLeft}>
                    <Ionicons
                      name={opt.icon}
                      size={20}
                      color={isSelected ? colors.brandAccent : colors.textSecondary}
                    />
                    <Text
                      style={[
                        typography.bodyMedium,
                        styles.optionLabel,
                        {
                          color: isSelected ? colors.brandAccent : colors.textPrimary,
                          fontWeight: isSelected ? '600' : '400',
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </View>

                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color={colors.brandAccent} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeBtn: {
    padding: 4,
  },
  optionsList: {
    gap: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionLabel: {
    marginLeft: 12,
  },
});

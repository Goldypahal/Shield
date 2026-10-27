import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useI18n } from '../../i18n';
import { Helpline, formatHelplineNumber } from '../../data/helplines';

export const callNumber = (number: string) => Linking.openURL(`tel:${number}`).catch(() => undefined);

interface HelplineRowProps {
  helpline: Helpline;
  /** Hide the description line (compact Home list). */
  compact?: boolean;
  last?: boolean;
}

/**
 * One helpline: a large call button on the left, the number and what it is for on the
 * right. Only the button dials, so scrolling past a row never places a call by accident.
 */
export default function HelplineRow({ helpline, compact, last }: HelplineRowProps) {
  const { colors, typography } = useTheme();
  const { t, textAlign } = useI18n();
  const isPrimary = helpline.number === '112';
  const name = t(helpline.name);

  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => callNumber(helpline.number)}
        style={[styles.callButton, { backgroundColor: isPrimary ? colors.sosPrimary : colors.statusSuccess }]}
        accessibilityRole="button"
        accessibilityLabel={`${t('common.callNumber', { number: helpline.number })}, ${name}`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="call" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.info}>
        <View style={styles.numberLine}>
          <Text style={[styles.number, { color: colors.textPrimary }]} selectable>
            {formatHelplineNumber(helpline.number)}
          </Text>
          {helpline.allDay && (
            <View style={[styles.badge, { backgroundColor: colors.statusSuccessBg, borderColor: colors.statusSuccessBorder }]}>
              <Text style={[styles.badgeText, { color: colors.statusSuccessText }]}>{t('common.allDay')}</Text>
            </View>
          )}
        </View>
        <Text style={[typography.bodyMedium, styles.name, { color: colors.textPrimary, textAlign }]} numberOfLines={1}>
          {name}
        </Text>
        {!compact && (
          <Text style={[typography.bodySmall, { color: colors.textSecondary, textAlign }]} numberOfLines={2}>
            {t(helpline.description)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
  },
  callButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  numberLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  number: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  name: {
    fontWeight: '700',
    marginTop: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

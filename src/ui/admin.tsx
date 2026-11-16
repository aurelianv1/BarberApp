/** UI pieces used only by the admin panel. */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BookingStatus } from '@/lib/adminRules';
import { texts } from '@/texts/ro';

import { Button } from './components';
import { colors, font, radius, space, TOUCH } from './theme';

/**
 * Native date / time picker. The app targets the web only, so the browser's own control is
 * used: it gives phones their familiar wheel or calendar picker.
 */
export function PickerField({
  label,
  type,
  value,
  onChange,
  min,
  testID,
}: {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  min?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <input
        type={type}
        value={value}
        min={min}
        aria-label={label}
        data-testid={testID}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: TOUCH,
          boxSizing: 'border-box',
          width: '100%',
          border: `1px solid ${colors.border}`,
          borderRadius: radius.sm,
          padding: `0 ${space.md}px`,
          fontSize: font.md,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: colors.text,
          backgroundColor: colors.surface,
        }}
      />
    </View>
  );
}

/** A destructive action that needs a second tap within a few seconds. */
export function ConfirmButton({
  label,
  confirmLabel = texts.admin.removeConfirm,
  onConfirm,
  busy,
  testID,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  testID?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      label={armed ? confirmLabel : label}
      variant="danger"
      busy={busy}
      testID={testID}
      onPress={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    />
  );
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const tone =
    status === 'confirmed'
      ? styles.badgeConfirmed
      : status === 'completed'
        ? styles.badgeNeutral
        : styles.badgeCancelled;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={styles.badgeText}>{texts.booking.status[status]}</Text>
    </View>
  );
}

/** One selectable chip in a row of options. */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      role="button"
      aria-pressed={selected}
      testID={testID}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

/** Title on the left, actions on the right; wraps on narrow screens. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <View style={styles.toolbar}>{children}</View>;
}

const styles = StyleSheet.create({
  field: { gap: space.xs, flexGrow: 1, flexBasis: 140 },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  badgeConfirmed: { backgroundColor: colors.successSoft },
  badgeCancelled: { backgroundColor: colors.dangerSoft },
  badgeNeutral: { backgroundColor: colors.background },
  badgeText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  chipTextSelected: { color: colors.onPrimary },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});

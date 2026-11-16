import type { ComponentRef, ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { texts } from '@/texts/ro';

import { colors, CONTENT_WIDTH, font, radius, space, TOUCH } from './theme';

export function Screen({
  children,
  footer,
  wide,
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** Admin screens use more of a desktop window. */
  wide?: boolean;
}) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.column, wide && styles.columnWide]}>{children}</View>
      </ScrollView>
      {footer ? (
        <View style={styles.footer}>
          <View style={styles.footerInner}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} role="heading" aria-level={1}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.heading} role="heading" aria-level={2}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  testID,
}: ButtonProps) {
  const inactive = disabled || busy;
  const labelColor =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.danger
        : variant === 'link'
          ? colors.accent
          : colors.text;
  return (
    <Pressable
      role="button"
      testID={testID}
      aria-disabled={inactive}
      aria-busy={busy}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'link' && styles.buttonLink,
        inactive && variant === 'primary' && styles.buttonPrimaryDisabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={labelColor} style={styles.buttonSpinner} /> : null}
      <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label = texts.common.loading }: { label?: string }) {
  return (
    <View style={styles.center} role="status" aria-live="polite">
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.body, styles.muted, styles.centerText]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Notice tone="danger">{message}</Notice>
      {onRetry ? <Button label={texts.common.retry} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'danger' | 'success' | 'info';
}) {
  const toneStyle =
    tone === 'danger'
      ? styles.noticeDanger
      : tone === 'success'
        ? styles.noticeSuccess
        : styles.noticeInfo;
  const textColor =
    tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.text;
  return (
    <View
      style={[styles.notice, toneStyle]}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    >
      <Text style={[styles.body, { color: textColor }]}>{children}</Text>
    </View>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  ref?: Ref<TextInputRef>;
}

export type TextInputRef = ComponentRef<typeof TextInput>;

export function Field({ label, hint, error, ref, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        aria-label={label}
        aria-invalid={Boolean(error)}
        placeholderTextColor={colors.disabled}
        style={[styles.input, error ? styles.inputError : null]}
        {...input}
      />
      {error ? (
        <Text style={styles.fieldError} role="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  error,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  error?: string | null;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Pressable
        role="checkbox"
        testID={testID}
        aria-checked={checked}
        onPress={() => onChange(!checked)}
        style={styles.checkboxRow}
      >
        <View
          style={[
            styles.checkbox,
            checked && styles.checkboxChecked,
            error ? styles.inputError : null,
          ]}
        >
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={[styles.body, styles.checkboxLabel]}>{label}</Text>
      </Pressable>
      {error ? (
        <Text style={styles.fieldError} role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Label/value line used in summaries. */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.body, styles.muted, styles.rowLabel]}>{label}</Text>
      <Text style={[styles.body, styles.rowValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, alignItems: 'center', padding: space.lg, paddingBottom: space.xxl },
  column: { width: '100%', maxWidth: CONTENT_WIDTH, gap: space.lg },
  columnWide: { maxWidth: 1100 },
  footer: {
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerInner: { width: '100%', maxWidth: CONTENT_WIDTH, gap: space.sm },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  heading: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { fontSize: font.md, lineHeight: 22, color: colors.text },
  muted: { color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  button: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonPrimaryDisabled: { backgroundColor: colors.disabled },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  buttonLink: { paddingHorizontal: 0, alignSelf: 'flex-start' },
  buttonLabel: { fontSize: font.md, fontWeight: '600', textAlign: 'center' },
  buttonSpinner: { marginRight: space.sm },
  pressed: { opacity: 0.7 },
  center: { alignItems: 'stretch', gap: space.md, paddingVertical: space.xl },
  centerText: { textAlign: 'center' },
  notice: { borderRadius: radius.md, padding: space.md, borderWidth: 1 },
  noticeDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  noticeSuccess: { backgroundColor: colors.successSoft, borderColor: colors.success },
  noticeInfo: { backgroundColor: colors.accentSoft, borderColor: colors.border },
  field: { gap: space.xs },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  input: {
    minHeight: TOUCH,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    // 16px keeps iOS Safari from zooming in when the field gets focus.
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  hint: { fontSize: font.sm, color: colors.textMuted },
  fieldError: { fontSize: font.sm, color: colors.danger },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: TOUCH },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.onPrimary, fontSize: 18, fontWeight: '700', lineHeight: 22 },
  checkboxLabel: { flex: 1 },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.xs },
  rowLabel: { width: 84 },
  rowValue: { flex: 1, fontWeight: '600' },
});

import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  addTimeOff,
  addWorkingHours,
  deleteTimeOff,
  deleteWorkingHours,
  listBookings,
  listTimeOff,
  listWorkingHours,
  toAdminError,
  type WorkingHours,
} from '@/lib/admin';
import { checkInterval, dayRange } from '@/lib/adminRules';
import { addDays, formatDay } from '@/lib/datetime';
import { localDateOf } from '@/lib/shared';
import { useAdminData, useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { ConfirmButton, PickerField } from '@/ui/admin';
import {
  Body,
  Button,
  Card,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Screen,
  Title,
} from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const t = texts.admin.hours;
/** Monday first, as Romanian calendars show it. Values are JS weekdays (0 = Sunday). */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** "luni", "marți", ... for a JS weekday number. 2024-01-07 was a Sunday. */
const weekdayName = (weekday: number) =>
  new Intl.DateTimeFormat('ro-RO', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 7 + weekday)),
  );

export default function HoursScreen() {
  const shop = useShop();
  if (shop.status === 'loading') {
    return (
      <Screen wide>
        <Loading />
      </Screen>
    );
  }
  if (shop.status === 'error') {
    return (
      <Screen wide>
        <ErrorState message={adminErrorText(shop.error.code)} onRetry={shop.reload} />
      </Screen>
    );
  }
  return (
    <Screen wide>
      <Stack.Screen options={{ title: `${t.title} · ${texts.admin.title}` }} />
      <Title>{t.title}</Title>
      <WeeklyHours staffId={shop.data.staffId} />
      <Title>{t.timeOffTitle}</Title>
      <TimeOffSection staffId={shop.data.staffId} timezone={shop.data.settings.timezone} />
    </Screen>
  );
}

function WeeklyHours({ staffId }: { staffId: string }) {
  const hours = useAdminData(() => listWorkingHours(staffId), 'hours');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (hours.status === 'loading') return <Loading />;
  if (hours.status === 'error') {
    return <ErrorState message={adminErrorText(hours.error.code)} onRetry={hours.reload} />;
  }

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteWorkingHours(id);
      hours.reload();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {WEEKDAYS.map((weekday) => {
        const intervals = hours.data.filter((row) => row.weekday === weekday);
        return (
          <Card key={weekday}>
            <View testID={`weekday-${weekday}`} style={styles.day}>
              <Heading>{weekdayName(weekday)}</Heading>
              {intervals.length === 0 ? <Body muted>{t.closed}</Body> : null}
              {intervals.map((interval) => (
                <View key={interval.id} style={styles.interval}>
                  <Text style={styles.intervalText}>
                    {texts.admin.agenda.timeRange(
                      interval.start_time.slice(0, 5),
                      interval.end_time.slice(0, 5),
                    )}
                  </Text>
                  <ConfirmButton
                    label={texts.admin.remove}
                    busy={busyId === interval.id}
                    testID="remove-interval"
                    onConfirm={() => remove(interval.id)}
                  />
                </View>
              ))}
              <AddInterval
                staffId={staffId}
                weekday={weekday}
                existing={intervals}
                onAdded={hours.reload}
              />
            </View>
          </Card>
        );
      })}
    </>
  );
}

function AddInterval({
  staffId,
  weekday,
  existing,
  onAdded,
}: {
  staffId: string;
  weekday: number;
  existing: WorkingHours[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        label={`+ ${t.addInterval}`}
        variant="link"
        testID="add-interval"
        onPress={() => setOpen(true)}
      />
    );
  }

  const submit = async () => {
    const problem = checkInterval(
      { start, end },
      existing.map((row) => ({ start: row.start_time, end: row.end_time })),
    );
    if (problem) {
      setError(t.errors[problem]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addWorkingHours(staffId, weekday, start, end);
      setOpen(false);
      setStart('');
      setEnd('');
      onAdded();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.pair}>
        <PickerField
          label={t.from}
          type="time"
          value={start}
          onChange={setStart}
          testID="interval-start"
        />
        <PickerField label={t.to} type="time" value={end} onChange={setEnd} testID="interval-end" />
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.actions}>
        <Button label={texts.admin.add} busy={busy} onPress={submit} testID="save-interval" />
        <Button
          label={texts.admin.cancelEdit}
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setOpen(false);
            setError(null);
          }}
        />
      </View>
    </View>
  );
}

function TimeOffSection({ staffId, timezone }: { staffId: string; timezone: string }) {
  const timeOff = useAdminData(() => listTimeOff(staffId), 'time-off');
  const today = localDateOf(new Date(), timezone);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const add = async () => {
    setWarning(null);
    const lastDay = last || first;
    if (!first || lastDay < first) {
      setError(t.timeOffError);
      return;
    }
    setBusy('add');
    setError(null);
    try {
      const { from, to } = dayRange(first, lastDay, timezone);
      await addTimeOff(staffId, from, to, reason.trim());
      // Existing bookings are not cancelled automatically: tell the barber about them.
      const affected = (await listBookings(from, to)).filter((b) => b.status === 'confirmed');
      if (affected.length > 0) setWarning(t.bookingsInRange(affected.length));
      setFirst('');
      setLast('');
      setReason('');
      timeOff.reload();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await deleteTimeOff(id);
      timeOff.reload();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {timeOff.status === 'loading' ? <Loading /> : null}
      {timeOff.status === 'error' ? (
        <ErrorState message={adminErrorText(timeOff.error.code)} onRetry={timeOff.reload} />
      ) : null}
      {timeOff.status === 'ready' && timeOff.data.length === 0 ? (
        <Body muted>{t.timeOffEmpty}</Body>
      ) : null}
      {timeOff.data?.map((row) => {
        // ends_at is the midnight after the last day off.
        const firstDay = localDateOf(row.starts_at, timezone);
        const lastDay = addDays(localDateOf(row.ends_at, timezone), -1);
        return (
          <Card key={row.id}>
            <View style={styles.interval} testID="time-off-row">
              <View style={styles.rowText}>
                <Text style={styles.intervalText}>
                  {t.timeOffRange(
                    formatDay(firstDay),
                    formatDay(lastDay < firstDay ? firstDay : lastDay),
                  )}
                </Text>
                {row.reason ? <Body muted>{row.reason}</Body> : null}
              </View>
              <ConfirmButton
                label={texts.admin.remove}
                busy={busy === row.id}
                testID="remove-time-off"
                onConfirm={() => remove(row.id)}
              />
            </View>
          </Card>
        );
      })}

      <Card>
        <Heading>{t.addTimeOff}</Heading>
        <View style={styles.pair}>
          <PickerField
            label={t.firstDay}
            type="date"
            value={first}
            min={today}
            onChange={setFirst}
            testID="time-off-first"
          />
          <PickerField
            label={t.lastDay}
            type="date"
            value={last}
            min={first || today}
            onChange={setLast}
            testID="time-off-last"
          />
        </View>
        <Field label={t.reason} value={reason} onChangeText={setReason} maxLength={100} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {warning ? <Notice tone="danger">{warning}</Notice> : null}
        <Button label={t.addTimeOff} busy={busy === 'add'} onPress={add} testID="save-time-off" />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  day: { gap: space.sm },
  interval: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  intervalText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  rowText: { flex: 1, gap: 2 },
  form: { gap: space.sm },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

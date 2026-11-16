import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listBookings, type Booking } from '@/lib/admin';
import { dayRange } from '@/lib/adminRules';
import { addDays, formatDay, formatTime } from '@/lib/datetime';
import { localDateOf } from '@/lib/shared';
import { useAdminData, useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { StatusBadge, Toolbar } from '@/ui/admin';
import { Body, Button, ErrorState, Loading, Notice, Screen, Title } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Agenda for one day. */
export default function AgendaScreen() {
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
  return <Agenda timezone={shop.data.settings.timezone} />;
}

function Agenda({ timezone }: { timezone: string }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = localDateOf(new Date(), timezone);
  const date = params.date && DATE.test(params.date) ? params.date : today;

  const bookings = useAdminData(() => {
    const { from, to } = dayRange(date, date, timezone);
    return listBookings(from, to);
  }, `agenda:${date}`);

  const go = (target: string) => router.setParams({ date: target === today ? undefined : target });
  const active = bookings.data?.filter((booking) => booking.status !== 'cancelled') ?? [];

  return (
    <Screen wide>
      <Stack.Screen options={{ title: `${texts.admin.nav.today} · ${texts.admin.title}` }} />
      <Toolbar>
        <Title>{formatDay(date)}</Title>
        <Button
          label={`+ ${texts.admin.agenda.newBooking}`}
          testID="new-booking"
          onPress={() => router.push({ pathname: '/admin/bookings/new', params: { date } })}
        />
      </Toolbar>

      <View style={styles.nav}>
        <Button
          label={`‹ ${texts.admin.agenda.previousDay}`}
          variant="secondary"
          onPress={() => go(addDays(date, -1))}
        />
        {date !== today ? (
          <Button label={texts.admin.agenda.today} variant="secondary" onPress={() => go(today)} />
        ) : null}
        <Button
          label={`${texts.admin.agenda.nextDay} ›`}
          variant="secondary"
          testID="next-day"
          onPress={() => go(addDays(date, 1))}
        />
      </View>

      {bookings.status === 'loading' ? <Loading /> : null}
      {bookings.status === 'error' ? (
        <ErrorState message={adminErrorText(bookings.error.code)} onRetry={bookings.reload} />
      ) : null}
      {bookings.status === 'ready' ? (
        <>
          <Toolbar>
            <Body muted>
              {active.length === 0
                ? texts.admin.agenda.empty
                : texts.admin.agenda.count(active.length)}
            </Body>
            <Button label={texts.admin.refresh} variant="link" onPress={bookings.reload} />
          </Toolbar>
          {bookings.data.length === 0 ? null : (
            <View style={styles.list}>
              {bookings.data.map((booking) => (
                <BookingRow key={booking.id} booking={booking} timezone={timezone} />
              ))}
            </View>
          )}
          {bookings.data.length > 0 && active.length === 0 ? (
            <Notice tone="info">{texts.admin.agenda.empty}</Notice>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function BookingRow({ booking, timezone }: { booking: Booking; timezone: string }) {
  const router = useRouter();
  const dimmed = booking.status === 'cancelled';
  return (
    <Pressable
      role="link"
      testID="agenda-booking"
      onPress={() => router.push({ pathname: '/admin/bookings/[id]', params: { id: booking.id } })}
      style={({ pressed }) => [
        styles.row,
        dimmed && styles.rowDimmed,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.time}>
        <Text style={styles.timeStart}>{formatTime(booking.starts_at, timezone)}</Text>
        <Text style={styles.timeEnd}>{formatTime(booking.ends_at, timezone)}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.name}>{booking.customer_name}</Text>
        <Text style={styles.meta}>{booking.services.name}</Text>
      </View>
      <StatusBadge status={booking.status} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDimmed: { opacity: 0.55 },
  rowPressed: { backgroundColor: colors.accentSoft },
  time: { width: 56 },
  timeStart: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  timeEnd: { fontSize: font.sm, color: colors.textMuted },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: '600', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
});

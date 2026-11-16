import { PageTitle } from '@/ui/PageTitle';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { listBookings, type Booking } from '@/lib/admin';
import { dayRange, weekOf } from '@/lib/adminRules';
import { addDays, dayChipParts, formatDay, formatTime } from '@/lib/datetime';
import { localDateOf } from '@/lib/shared';
import { useAdminData, useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { Toolbar } from '@/ui/admin';
import { Button, ErrorState, Loading, Screen, Title } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** From this width up the week is shown as seven columns; below it, as a list of days. */
const COLUMNS_FROM = 900;

export default function WeekScreen() {
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
  return <Week timezone={shop.data.settings.timezone} />;
}

function Week({ timezone }: { timezone: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = localDateOf(new Date(), timezone);
  const days = weekOf(params.date && DATE.test(params.date) ? params.date : today);
  const first = days[0]!;
  const last = days[6]!;

  const bookings = useAdminData(() => {
    const { from, to } = dayRange(first, last, timezone);
    return listBookings(from, to);
  }, `week:${first}`);

  const byDay = new Map<string, Booking[]>(days.map((day) => [day, []]));
  for (const booking of bookings.data ?? []) {
    if (booking.status === 'cancelled') continue;
    byDay.get(localDateOf(booking.starts_at, timezone))?.push(booking);
  }

  const columns = width >= COLUMNS_FROM;
  const thisWeek = days.includes(today);

  return (
    <Screen wide>
      <PageTitle title={`${texts.admin.nav.week} · ${texts.admin.title}`} />
      <Title>{texts.admin.hours.timeOffRange(formatDay(first), formatDay(last))}</Title>
      <Toolbar>
        <View style={styles.nav}>
          <Button
            label={`‹ ${texts.admin.agenda.previousWeek}`}
            variant="secondary"
            onPress={() => router.setParams({ date: addDays(first, -7) })}
          />
          {!thisWeek ? (
            <Button
              label={texts.admin.agenda.thisWeek}
              variant="secondary"
              onPress={() => router.setParams({ date: undefined })}
            />
          ) : null}
          <Button
            label={`${texts.admin.agenda.nextWeek} ›`}
            variant="secondary"
            onPress={() => router.setParams({ date: addDays(first, 7) })}
          />
        </View>
        <Button label={texts.admin.refresh} variant="link" onPress={bookings.reload} />
      </Toolbar>

      {bookings.status === 'loading' ? <Loading /> : null}
      {bookings.status === 'error' ? (
        <ErrorState message={adminErrorText(bookings.error.code)} onRetry={bookings.reload} />
      ) : null}
      {bookings.status === 'ready' ? (
        <View style={columns ? styles.grid : styles.stack}>
          {days.map((day) => {
            const parts = dayChipParts(day);
            const items = byDay.get(day) ?? [];
            return (
              <View key={day} style={[styles.day, columns && styles.dayColumn]} testID="week-day">
                <Pressable
                  role="link"
                  aria-label={formatDay(day)}
                  onPress={() => router.push({ pathname: '/admin', params: { date: day } })}
                  style={[styles.dayHeader, day === today && styles.dayHeaderToday]}
                >
                  <Text style={[styles.dayTitle, day === today && styles.dayTitleToday]}>
                    {parts.weekday} {parts.day} {parts.month}
                  </Text>
                  <Text style={[styles.dayCount, day === today && styles.dayTitleToday]}>
                    {items.length === 0 ? texts.admin.agenda.free : items.length}
                  </Text>
                </Pressable>
                {items.map((booking) => (
                  <Pressable
                    key={booking.id}
                    role="link"
                    testID="week-booking"
                    onPress={() =>
                      router.push({ pathname: '/admin/bookings/[id]', params: { id: booking.id } })
                    }
                    style={({ pressed }) => [
                      styles.item,
                      booking.status !== 'confirmed' && styles.itemDone,
                      pressed && styles.itemPressed,
                    ]}
                  >
                    <Text style={styles.itemTime}>{formatTime(booking.starts_at, timezone)}</Text>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {booking.customer_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stack: { gap: space.md },
  day: { gap: space.xs },
  dayColumn: { flex: 1, minWidth: 0 },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayHeaderToday: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  dayTitleToday: { color: colors.onPrimary },
  dayCount: { fontSize: font.sm, color: colors.textMuted },
  item: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
  },
  itemDone: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  itemPressed: { opacity: 0.7 },
  itemTime: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  itemName: { flex: 1, fontSize: font.sm, color: colors.text },
});

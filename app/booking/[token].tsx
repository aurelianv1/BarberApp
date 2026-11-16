import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, type BookingView } from '@/lib/api';
import { buildIcs, downloadIcs, googleCalendarUrl, type CalendarEvent } from '@/lib/calendar';
import { formatLongDate, formatPhone, formatPrice, formatTime } from '@/lib/datetime';
import { currentSubscription, pushSupport, subscribeToPush } from '@/lib/push';
import { forgetBooking, saveBooking } from '@/lib/savedBookings';
import { toApiError, useAsync } from '@/lib/useAsync';
import { errorText, texts } from '@/texts/ro';
import {
  Body,
  Button,
  Card,
  ErrorState,
  Heading,
  Loading,
  Notice,
  Row,
  Screen,
  Title,
} from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';

export default function BookingScreen() {
  const { token, new: isNew } = useLocalSearchParams<{ token: string; new?: string }>();
  const router = useRouter();
  const state = useAsync(() => api.getBooking(token), token);

  // Set after a successful cancel so the page shows the new state without another request.
  const [updated, setUpdated] = useState<BookingView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Keep this browser's list of bookings in step with what the server says.
  const view = updated ?? state.data;
  const missing = state.error?.code === 'not_found' || state.error?.code === 'invalid_input';
  const viewStatus = view?.booking.status;
  const viewStartsAt = view?.booking.starts_at;
  useEffect(() => {
    if (missing) forgetBooking(token);
    else if (viewStatus === 'confirmed' && viewStartsAt) {
      saveBooking({ token, startsAt: viewStartsAt });
    } else if (viewStatus) forgetBooking(token);
  }, [token, missing, viewStatus, viewStartsAt]);

  if (state.status === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen>
        <Stack.Screen options={{ title: texts.booking.title }} />
        <Title>{missing ? texts.booking.notFoundTitle : texts.booking.title}</Title>
        {missing ? (
          <>
            <Body muted>{texts.booking.notFoundBody}</Body>
            <Button label={texts.booking.bookAgain} onPress={() => router.replace('/book')} />
          </>
        ) : (
          <ErrorState message={errorText(state.error.code)} onRetry={state.reload} />
        )}
      </Screen>
    );
  }

  const { booking, shop } = updated ?? state.data;
  const tz = shop.timezone;

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      setUpdated(await api.cancelBooking(token));
      setConfirming(false);
    } catch (error) {
      const { code } = toApiError(error);
      setCancelError(errorText(code));
      setConfirming(false);
      // The booking changed on the server (e.g. deadline passed): show its real state.
      if (code === 'cancel_too_late' || code === 'not_cancellable') state.reload();
    } finally {
      setCancelling(false);
    }
  };

  const statusStyle =
    booking.status === 'confirmed'
      ? styles.badgeConfirmed
      : booking.status === 'cancelled' || booking.status === 'no_show'
        ? styles.badgeCancelled
        : styles.badgeNeutral;

  return (
    <Screen>
      <Stack.Screen options={{ title: `${texts.booking.title} · ${shop.name}` }} />
      <Title>{texts.booking.title}</Title>

      {isNew === '1' && booking.status === 'confirmed' && !updated ? (
        <Notice tone="success">
          <Text style={styles.bannerTitle}>{texts.booking.confirmedBanner}</Text>
          {'\n'}
          {texts.booking.confirmedHint}
        </Notice>
      ) : null}

      <Card>
        <View style={[styles.badge, statusStyle]} testID="booking-status">
          <Text style={styles.badgeText}>{texts.booking.status[booking.status]}</Text>
        </View>
        <Row label={texts.booking.serviceLabel} value={booking.service.name} />
        <Row label={texts.booking.dateLabel} value={formatLongDate(booking.starts_at, tz)} />
        <Row label={texts.booking.timeLabel} value={formatTime(booking.starts_at, tz)} />
        <Row
          label={texts.booking.durationLabel}
          value={texts.common.minutes(booking.service.duration_min)}
        />
        <Row label={texts.booking.priceLabel} value={formatPrice(booking.service.price_ron)} />
        <Row label={texts.booking.nameLabel} value={booking.customer_name} />
      </Card>

      <Card>
        <Heading>{shop.name}</Heading>
        {shop.address ? <Body muted>{shop.address}</Body> : null}
        {shop.phone ? <Body muted>{formatPhone(shop.phone)}</Body> : null}
      </Card>

      {booking.status === 'confirmed' && booking.cancel_blocked_reason !== 'already_started' ? (
        <Reminders token={token} view={{ booking, shop }} />
      ) : null}

      {cancelError ? <Notice tone="danger">{cancelError}</Notice> : null}

      {booking.status === 'cancelled' ? (
        <>
          <Notice tone="info">{texts.booking.cancelledInfo}</Notice>
          <Button label={texts.booking.bookAgain} onPress={() => router.replace('/book')} />
        </>
      ) : null}

      {booking.status === 'confirmed' && booking.can_cancel ? (
        confirming ? (
          <Card>
            <Heading>{texts.booking.cancelConfirmTitle}</Heading>
            <Button
              label={cancelling ? texts.booking.cancelling : texts.booking.cancelConfirmYes}
              variant="danger"
              busy={cancelling}
              onPress={cancel}
              testID="cancel-confirm"
            />
            <Button
              label={texts.booking.cancelConfirmNo}
              variant="secondary"
              disabled={cancelling}
              onPress={() => setConfirming(false)}
            />
          </Card>
        ) : (
          <>
            <Body muted>
              {texts.booking.cancelUntil(
                formatLongDate(booking.cancel_deadline, tz),
                formatTime(booking.cancel_deadline, tz),
              )}
            </Body>
            <Button
              label={texts.booking.cancel}
              variant="danger"
              onPress={() => setConfirming(true)}
              testID="cancel-booking"
            />
          </>
        )
      ) : null}

      {booking.status === 'confirmed' && booking.cancel_blocked_reason === 'too_late' ? (
        <Notice tone="info">{texts.booking.cancelTooLate(formatPhone(shop.phone))}</Notice>
      ) : null}

      <Button label={texts.common.home} variant="link" onPress={() => router.replace('/')} />
    </Screen>
  );
}

/** Ways to remember the booking: calendar event and push notifications. */
function Reminders({ token, view }: { token: string; view: BookingView }) {
  const { booking, shop } = view;
  const [push, setPush] = useState<'idle' | 'working' | 'active' | 'declined' | 'error'>('idle');
  const support = pushSupport();

  // This browser already allows notifications: attach it to this booking without asking.
  useEffect(() => {
    let current = true;
    (async () => {
      const subscription = await currentSubscription();
      if (!subscription) return;
      await api.subscribePush(token, subscription);
      if (current) setPush('active');
    })().catch(() => undefined);
    return () => {
      current = false;
    };
  }, [token]);

  const enablePush = async () => {
    setPush('working');
    try {
      const subscription = await subscribeToPush();
      if (!subscription) {
        setPush('declined');
        return;
      }
      await api.subscribePush(token, subscription);
      setPush('active');
    } catch {
      setPush('error');
    }
  };

  const event: CalendarEvent = {
    uid: `${token.slice(0, 16)}@barberapp`,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    title: texts.booking.calendarEventTitle(booking.service.name, shop.name),
    location: shop.address,
    description: texts.booking.calendarDescription,
    url: `${window.location.origin}/booking/${token}`,
    alarmsMinutesBefore: [24 * 60, 2 * 60],
    alarmText: texts.booking.calendarAlarm(shop.name),
  };

  return (
    <Card>
      <Heading>{texts.booking.calendarTitle}</Heading>
      <Button
        label={texts.booking.addToCalendar}
        variant="secondary"
        testID="add-to-calendar"
        onPress={() => downloadIcs(buildIcs(event), texts.booking.calendarFileName)}
      />
      <Button
        label={texts.booking.addToGoogle}
        variant="secondary"
        testID="add-to-google"
        onPress={() => window.open(googleCalendarUrl(event), '_blank', 'noopener')}
      />

      {push === 'active' ? (
        <Notice tone="success">{texts.booking.notifyActive}</Notice>
      ) : support === 'available' && push !== 'declined' ? (
        <>
          <Button
            label={push === 'working' ? texts.booking.notifyEnabling : texts.booking.notifyCta}
            variant="secondary"
            busy={push === 'working'}
            testID="enable-push"
            onPress={enablePush}
          />
          <Body muted>
            {push === 'error' ? texts.booking.notifyError : texts.booking.notifyHint}
          </Body>
        </>
      ) : support === 'blocked' || push === 'declined' ? (
        <Body muted>{texts.booking.notifyBlocked}</Body>
      ) : support === 'needs-install' ? (
        <Body muted>{texts.booking.notifyNeedsInstall}</Body>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  bannerTitle: { fontWeight: '700', fontSize: font.lg },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    marginBottom: space.xs,
  },
  badgeConfirmed: { backgroundColor: colors.successSoft },
  badgeCancelled: { backgroundColor: colors.dangerSoft },
  badgeNeutral: { backgroundColor: colors.background },
  badgeText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
});

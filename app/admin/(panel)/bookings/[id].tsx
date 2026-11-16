import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import {
  getBooking,
  setBookingNotes,
  setBookingStatus,
  toAdminError,
  type Booking,
} from '@/lib/admin';
import { nextStatuses, type BookingStatus } from '@/lib/adminRules';
import { formatLongDate, formatPhone, formatPrice, formatTime } from '@/lib/datetime';
import { useAdminData, useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { ConfirmButton, StatusBadge } from '@/ui/admin';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Row,
  Screen,
  Title,
} from '@/ui/components';

export default function AdminBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const shop = useShop();
  const booking = useAdminData(() => getBooking(id), `booking:${id}`);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/admin'));

  if (shop.status === 'loading' || booking.status === 'loading') {
    return (
      <Screen wide>
        <Loading />
      </Screen>
    );
  }
  const error = shop.error ?? booking.error;
  if (error || !shop.data || !booking.data) {
    return (
      <Screen wide>
        <Button label={`‹ ${texts.common.back}`} variant="link" onPress={back} />
        <ErrorState
          message={
            error?.code === 'not_found'
              ? texts.admin.booking.notFound
              : adminErrorText(error?.code ?? 'unknown')
          }
          onRetry={error?.code === 'not_found' ? undefined : booking.reload}
        />
      </Screen>
    );
  }

  return (
    <Details
      // Remount when the stored notes change, so the field shows what was saved.
      key={`${booking.data.id}:${booking.data.notes ?? ''}`}
      booking={booking.data}
      timezone={shop.data.settings.timezone}
      onChanged={booking.reload}
      onBack={back}
    />
  );
}

function Details({
  booking,
  timezone,
  onChanged,
  onBack,
}: {
  booking: Booking;
  timezone: string;
  onChanged: () => void;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [busy, setBusy] = useState<BookingStatus | 'notes' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async (what: BookingStatus | 'notes', action: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setSaved(false);
    try {
      await action();
      if (what === 'notes') setSaved(true);
      onChanged();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen wide>
      <Stack.Screen options={{ title: `${booking.customer_name} · ${texts.admin.title}` }} />
      <Button label={`‹ ${texts.common.back}`} variant="link" onPress={onBack} />
      <Title>{booking.customer_name}</Title>

      <Card>
        <StatusBadge status={booking.status} />
        <Row label={texts.booking.serviceLabel} value={booking.services.name} />
        <Row label={texts.booking.dateLabel} value={formatLongDate(booking.starts_at, timezone)} />
        <Row
          label={texts.booking.timeLabel}
          value={texts.admin.agenda.timeRange(
            formatTime(booking.starts_at, timezone),
            formatTime(booking.ends_at, timezone),
          )}
        />
        <Row label={texts.booking.priceLabel} value={formatPrice(booking.services.price_ron)} />
        <Row
          label={texts.admin.booking.phone}
          value={
            booking.customer_phone
              ? formatPhone(booking.customer_phone)
              : texts.admin.booking.noPhone
          }
        />
        <Row
          label={texts.admin.booking.source}
          value={
            booking.source === 'online'
              ? texts.admin.booking.sourceOnline
              : texts.admin.booking.sourceAdmin
          }
        />
        <Row
          label={texts.admin.booking.createdAt}
          value={`${formatLongDate(booking.created_at, timezone)}, ${formatTime(booking.created_at, timezone)}`}
        />
        {booking.customer_phone ? (
          <Button
            label={`${texts.admin.booking.call}: ${formatPhone(booking.customer_phone)}`}
            variant="secondary"
            onPress={() => Linking.openURL(`tel:${booking.customer_phone}`)}
          />
        ) : null}
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <Heading>{texts.admin.booking.changeStatus}</Heading>
        {nextStatuses(booking.status).map((status) =>
          status === 'cancelled' ? (
            <ConfirmButton
              key={status}
              label={texts.admin.booking.mark.cancelled}
              confirmLabel={texts.admin.booking.cancelConfirm}
              busy={busy === status}
              testID="mark-cancelled"
              onConfirm={() => run(status, () => setBookingStatus(booking.id, status))}
            />
          ) : (
            <Button
              key={status}
              label={texts.admin.booking.mark[status]}
              variant={status === 'completed' ? 'primary' : 'secondary'}
              busy={busy === status}
              disabled={busy !== null}
              testID={`mark-${status}`}
              onPress={() => run(status, () => setBookingStatus(booking.id, status))}
            />
          ),
        )}
      </Card>

      <Card>
        <Field
          label={texts.admin.booking.notes}
          placeholder={texts.admin.booking.notesPlaceholder}
          value={notes}
          onChangeText={(value) => {
            setNotes(value);
            setSaved(false);
          }}
          maxLength={500}
          multiline
          testID="booking-notes"
        />
        <Button
          label={busy === 'notes' ? texts.admin.saving : texts.admin.save}
          variant="secondary"
          busy={busy === 'notes'}
          disabled={notes === (booking.notes ?? '')}
          testID="save-notes"
          onPress={() => run('notes', () => setBookingNotes(booking.id, notes))}
        />
        {saved ? <Notice tone="success">{texts.admin.saved}</Notice> : null}
      </Card>
    </Screen>
  );
}

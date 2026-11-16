import { PageTitle } from '@/ui/PageTitle';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  createBooking,
  listBookings,
  listServices,
  listTimeOffBetween,
  listWorkingHours,
  toAdminError,
  type Service,
  type Settings,
} from '@/lib/admin';
import { dayRange } from '@/lib/adminRules';
import { addDays, formatDay, formatPrice, formatTime } from '@/lib/datetime';
import {
  computeSlots,
  localDateOf,
  NAME_MAX_LENGTH,
  normalizeCustomerName,
  normalizeRoPhone,
} from '@/lib/shared';
import { useAdminData, useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { Chip, Chips, PickerField } from '@/ui/admin';
import {
  Body,
  Button,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Screen,
  Title,
} from '@/ui/components';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Manual booking, for customers who call or walk in. */
export default function NewBookingScreen() {
  const shop = useShop();
  const services = useAdminData(listServices, 'services');

  if (shop.status === 'loading' || services.status === 'loading') {
    return (
      <Screen wide>
        <Loading />
      </Screen>
    );
  }
  const error = shop.error ?? services.error;
  if (error || !shop.data || !services.data) {
    return (
      <Screen wide>
        <ErrorState message={adminErrorText(error?.code ?? 'unknown')} onRetry={shop.reload} />
      </Screen>
    );
  }
  return (
    <Form
      settings={shop.data.settings}
      staffId={shop.data.staffId}
      services={services.data.filter((service) => service.active)}
    />
  );
}

function Form({
  settings,
  staffId,
  services,
}: {
  settings: Settings;
  staffId: string;
  services: Service[];
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const tz = settings.timezone;
  const today = localDateOf(new Date(), tz);

  const [serviceId, setServiceId] = useState<string | null>(
    services.length === 1 ? services[0]!.id : null,
  );
  const [date, setDate] = useState(
    params.date && DATE.test(params.date) && params.date >= today ? params.date : today,
  );
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((item) => item.id === serviceId);

  // Free times for the chosen service and day, by the same rules customers get, except that
  // the barber may book at short notice and as far ahead as needed.
  const slots = useAdminData(async () => {
    if (!service) return [];
    const { from, to } = dayRange(addDays(date, -1), addDays(date, 1), tz);
    const [hours, timeOff, bookings] = await Promise.all([
      listWorkingHours(staffId),
      listTimeOffBetween(staffId, from, to),
      listBookings(from, to),
    ]);
    return computeSlots({
      settings: {
        timezone: tz,
        slotStepMin: settings.slot_step_min,
        minNoticeMin: 0,
        maxAdvanceDays: 3650,
      },
      durationMin: service.duration_min,
      date,
      workingHours: hours.map((row) => ({
        weekday: row.weekday,
        startTime: row.start_time,
        endTime: row.end_time,
      })),
      timeOff: timeOff.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at })),
      bookings: bookings.map((row) => ({
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
      })),
      now: new Date(),
    });
  }, `slots:${serviceId}:${date}`);

  const cleanName = normalizeCustomerName(name);
  const cleanPhone = phone.trim() ? normalizeRoPhone(phone) : null;
  const phoneInvalid = phone.trim() !== '' && !cleanPhone;
  // A slot picked earlier may no longer be offered after changing service or day.
  const chosen = slot && slots.data?.includes(slot) ? slot : null;

  const submit = async () => {
    setShowErrors(true);
    setError(null);
    if (!service || !chosen || !cleanName || phoneInvalid || busy) return;
    setBusy(true);
    try {
      const id = await createBooking({
        staffId,
        serviceId: service.id,
        startsAt: chosen,
        durationMin: service.duration_min,
        customerName: cleanName,
        customerPhone: cleanPhone,
        notes,
      });
      router.replace({ pathname: '/admin/bookings/[id]', params: { id } });
    } catch (cause) {
      const code = toAdminError(cause).code;
      setError(adminErrorText(code));
      if (code === 'slot_taken') {
        setSlot(null);
        slots.reload();
      }
      setBusy(false);
    }
  };

  return (
    <Screen
      wide
      footer={
        <Button
          label={busy ? texts.admin.saving : texts.admin.newBooking.submit}
          busy={busy}
          onPress={submit}
          testID="save-booking"
        />
      }
    >
      <PageTitle title={`${texts.admin.newBooking.title} · ${texts.admin.title}`} />
      <Button
        label={`‹ ${texts.common.back}`}
        variant="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))}
      />
      <Title>{texts.admin.newBooking.title}</Title>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Heading>{texts.admin.newBooking.service}</Heading>
      <Chips>
        {services.map((item) => (
          <Chip
            key={item.id}
            testID="admin-service"
            label={`${item.name} · ${texts.common.minutes(item.duration_min)} · ${formatPrice(item.price_ron)}`}
            selected={item.id === serviceId}
            onPress={() => setServiceId(item.id)}
          />
        ))}
      </Chips>

      <PickerField
        label={`${texts.admin.newBooking.date}: ${formatDay(date)}`}
        type="date"
        value={date}
        min={today}
        testID="admin-date"
        onChange={(value) => DATE.test(value) && setDate(value)}
      />

      <Heading>{texts.admin.newBooking.time}</Heading>
      {!service ? (
        <Body muted>{texts.admin.newBooking.pickService}</Body>
      ) : slots.status === 'loading' ? (
        <Loading />
      ) : slots.status === 'error' ? (
        <ErrorState message={adminErrorText(slots.error.code)} onRetry={slots.reload} />
      ) : slots.data.length === 0 ? (
        <Notice tone="info">{texts.admin.newBooking.noSlots}</Notice>
      ) : (
        <Chips>
          {slots.data.map((item) => (
            <Chip
              key={item}
              testID="admin-slot"
              label={formatTime(item, tz)}
              selected={item === chosen}
              onPress={() => setSlot(item)}
            />
          ))}
        </Chips>
      )}
      {showErrors && service && !chosen ? (
        <Notice tone="danger">{texts.admin.newBooking.timeError}</Notice>
      ) : null}

      <View style={{ gap: 16 }}>
        <Field
          label={texts.admin.newBooking.name}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX_LENGTH}
          autoCapitalize="words"
          error={showErrors && !cleanName ? texts.admin.newBooking.nameError : null}
          testID="admin-name"
        />
        <Field
          label={texts.admin.newBooking.phoneOptional}
          placeholder={texts.book.phonePlaceholder}
          value={phone}
          onChangeText={setPhone}
          inputMode="tel"
          maxLength={20}
          error={showErrors && phoneInvalid ? texts.admin.newBooking.phoneError : null}
          testID="admin-phone"
        />
        <Field
          label={texts.admin.booking.notes}
          placeholder={texts.admin.booking.notesPlaceholder}
          value={notes}
          onChangeText={setNotes}
          maxLength={500}
          multiline
        />
      </View>
    </Screen>
  );
}

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, type Service, type ShopDetails } from '@/lib/api';
import {
  dayChipParts,
  formatDay,
  formatPrice,
  formatTime,
  groupSlots,
  upcomingDays,
} from '@/lib/datetime';
import {
  localDateOf,
  NAME_MAX_LENGTH,
  normalizeCustomerName,
  normalizeRoPhone,
} from '@/lib/shared';
import { toApiError, useAsync } from '@/lib/useAsync';
import { errorText, texts } from '@/texts/ro';
import {
  Body,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Row,
  Screen,
  Title,
  type TextInputRef,
} from '@/ui/components';
import { colors, font, radius, space, TOUCH } from '@/ui/theme';

const TOTAL_STEPS = 3;
/** How many days ahead to look for the first day that still has free slots. */
const FIRST_DAY_SEARCH = 14;

type Params = { service?: string; date?: string; slot?: string; taken?: string };

/**
 * Booking flow. The step is derived from the URL (?service=&date=&slot=), so the browser's
 * back button and the phone's back gesture move one step back instead of leaving the flow.
 */
export default function BookScreen() {
  const params = useLocalSearchParams<Params>();
  const state = useAsync(api.getServices, 'services');

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
        <Title>{texts.book.title}</Title>
        <ErrorState message={errorText(state.error.code)} onRetry={state.reload} />
      </Screen>
    );
  }

  const { shop, services } = state.data;
  const service = services.find((item) => item.id === params.service);

  if (!service) return <ServiceStep services={services} />;
  if (!params.slot) {
    return (
      <TimeStep shop={shop} service={service} date={params.date} slotTaken={params.taken === '1'} />
    );
  }
  return <DetailsStep shop={shop} service={service} slot={params.slot} />;
}

function StepHeader({ step, title }: { step: number; title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Stack.Screen options={{ title: `${title} · ${texts.book.title}` }} />
      <Button
        label={`‹ ${texts.common.back}`}
        variant="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text style={styles.stepLabel}>{texts.book.stepOf(step, TOTAL_STEPS)}</Text>
      <Title>{title}</Title>
    </View>
  );
}

// --- Step 1: service -------------------------------------------------------

function ServiceStep({ services }: { services: Service[] }) {
  const router = useRouter();
  return (
    <Screen>
      <StepHeader step={1} title={texts.book.serviceTitle} />
      {services.length === 0 ? <Body muted>{texts.book.noServices}</Body> : null}
      {services.map((service) => (
        <Pressable
          key={service.id}
          role="button"
          testID="service-option"
          onPress={() => router.push({ pathname: '/book', params: { service: service.id } })}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        >
          <View style={styles.optionText}>
            <Text style={styles.optionName}>{service.name}</Text>
            <Text style={styles.optionMeta}>{texts.common.minutes(service.duration_min)}</Text>
          </View>
          <Text style={styles.optionPrice}>{formatPrice(service.price_ron)}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

// --- Step 2: day and time --------------------------------------------------

interface TimeStepProps {
  shop: ShopDetails;
  service: Service;
  date?: string;
  slotTaken: boolean;
}

function TimeStep({ shop, service, date, slotTaken }: TimeStepProps) {
  const router = useRouter();
  const days = upcomingDays(shop.timezone, shop.max_advance_days + 1);
  const selected = date && days.includes(date) ? date : undefined;

  // No day chosen yet: jump to the first day that still has free slots.
  const [searching, setSearching] = useState(!selected);
  useEffect(() => {
    if (selected) return;
    let current = true;
    (async () => {
      let first = days[0];
      for (const day of days.slice(0, FIRST_DAY_SEARCH)) {
        try {
          const { slots } = await api.getSlots(service.id, day);
          if (slots.length > 0) {
            first = day;
            break;
          }
        } catch {
          break; // The slot list below reports the error for the chosen day.
        }
      }
      if (current) {
        router.setParams({ date: first });
        setSearching(false);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, service.id]);

  return (
    <Screen>
      <StepHeader step={2} title={texts.book.timeTitle} />
      <Body muted>
        {service.name} · {texts.common.minutes(service.duration_min)} ·{' '}
        {formatPrice(service.price_ron)}
      </Body>
      {slotTaken ? <Notice tone="danger">{texts.book.slotTaken}</Notice> : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        style={styles.daysScroll}
      >
        {days.map((day, index) => {
          const parts = dayChipParts(day);
          const active = day === selected;
          const top =
            index === 0 ? texts.book.today : index === 1 ? texts.book.tomorrow : parts.weekday;
          return (
            <Pressable
              key={day}
              role="button"
              testID="day-option"
              aria-pressed={active}
              aria-label={formatDay(day)}
              onPress={() => router.setParams({ date: day, taken: undefined })}
              style={[styles.day, active && styles.dayActive]}
            >
              <Text style={[styles.dayTop, active && styles.dayTextActive]}>{top}</Text>
              <Text style={[styles.dayNumber, active && styles.dayTextActive]}>{parts.day}</Text>
              <Text style={[styles.dayTop, active && styles.dayTextActive]}>{parts.month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {searching || !selected ? (
        <Loading />
      ) : (
        <SlotList shop={shop} service={service} date={selected} />
      )}
    </Screen>
  );
}

function SlotList({ shop, service, date }: { shop: ShopDetails; service: Service; date: string }) {
  const router = useRouter();
  const state = useAsync(() => api.getSlots(service.id, date), `${service.id}:${date}`);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return <ErrorState message={errorText(state.error.code)} onRetry={state.reload} />;
  }

  const { morning, afternoon } = groupSlots(state.data.slots, shop.timezone);
  if (morning.length + afternoon.length === 0) {
    return (
      <View style={styles.group}>
        <Heading>{formatDay(date)}</Heading>
        <Notice tone="info">{texts.book.noSlots}</Notice>
      </View>
    );
  }

  const renderGroup = (title: string, slots: string[]) =>
    slots.length === 0 ? null : (
      <View style={styles.group}>
        <Text style={styles.groupTitle}>{title}</Text>
        <View style={styles.slots}>
          {slots.map((slot) => (
            <Pressable
              key={slot}
              role="button"
              testID="slot-option"
              onPress={() =>
                router.push({ pathname: '/book', params: { service: service.id, date, slot } })
              }
              style={({ pressed }) => [styles.slot, pressed && styles.optionPressed]}
            >
              <Text style={styles.slotText}>{formatTime(slot, shop.timezone)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );

  return (
    <View style={styles.group}>
      <Heading>{formatDay(date)}</Heading>
      {renderGroup(texts.book.morning, morning)}
      {renderGroup(texts.book.afternoon, afternoon)}
    </View>
  );
}

// --- Step 3: customer details ----------------------------------------------

function DetailsStep({
  shop,
  service,
  slot,
}: {
  shop: ShopDetails;
  service: Service;
  slot: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot, see below
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const phoneRef = useRef<TextInputRef>(null);

  const validSlot = !Number.isNaN(Date.parse(slot));
  const date = validSlot ? localDateOf(slot, shop.timezone) : undefined;

  const backToTimes = (taken: boolean) =>
    router.replace({
      pathname: '/book',
      params: { service: service.id, ...(date ? { date } : {}), ...(taken ? { taken: '1' } : {}) },
    });

  useEffect(() => {
    if (!validSlot) backToTimes(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSlot]);
  if (!validSlot || !date) return null;

  const nameError = normalizeCustomerName(name) ? null : texts.book.nameError;
  const phoneError = normalizeRoPhone(phone) ? null : texts.book.phoneError;
  const consentError = consent ? null : texts.book.consentError;

  const submit = async () => {
    setShowErrors(true);
    setSubmitError(null);
    if (nameError || phoneError || consentError || submitting) return;

    setSubmitting(true);
    try {
      const { cancel_token } = await api.createBooking({
        service_id: service.id,
        starts_at: slot,
        customer_name: name,
        customer_phone: phone,
        consent,
        website,
      });
      router.replace({ pathname: '/booking/[token]', params: { token: cancel_token, new: '1' } });
    } catch (error) {
      const { code } = toApiError(error);
      if (code === 'slot_taken') {
        backToTimes(true);
        return;
      }
      setSubmitError(errorText(code));
      setSubmitting(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          label={submitting ? texts.book.submitting : texts.book.submit}
          busy={submitting}
          onPress={submit}
          testID="submit-booking"
        />
      }
    >
      <StepHeader step={3} title={texts.book.detailsTitle} />

      <Card>
        <Heading>{texts.book.summaryTitle}</Heading>
        <Row label={texts.booking.serviceLabel} value={service.name} />
        <Row label={texts.booking.dateLabel} value={formatDay(date)} />
        <Row label={texts.booking.timeLabel} value={formatTime(slot, shop.timezone)} />
        <Row label={texts.booking.priceLabel} value={formatPrice(service.price_ron)} />
      </Card>

      {submitError ? <Notice tone="danger">{submitError}</Notice> : null}

      <Field
        label={texts.book.nameLabel}
        placeholder={texts.book.namePlaceholder}
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX_LENGTH}
        autoComplete="name"
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
        error={showErrors ? nameError : null}
        testID="name-input"
      />
      <Field
        ref={phoneRef}
        label={texts.book.phoneLabel}
        placeholder={texts.book.phonePlaceholder}
        value={phone}
        onChangeText={setPhone}
        maxLength={20}
        inputMode="tel"
        autoComplete="tel"
        returnKeyType="done"
        onSubmitEditing={submit}
        hint={texts.book.phoneHint}
        error={showErrors ? phoneError : null}
        testID="phone-input"
      />
      <Checkbox
        checked={consent}
        onChange={setConsent}
        label={texts.book.consent}
        error={showErrors ? consentError : null}
        testID="consent-checkbox"
      />

      {/* Honeypot: invisible to people and to screen readers; bots that fill it are rejected. */}
      <View style={styles.honeypot} aria-hidden>
        <TextInput
          value={website}
          onChangeText={setWebsite}
          tabIndex={-1}
          autoComplete="off"
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  stepLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  option: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionPressed: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  optionText: { flex: 1, gap: 2 },
  optionName: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  optionMeta: { fontSize: font.sm, color: colors.textMuted },
  optionPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  daysScroll: { marginHorizontal: -space.lg, flexGrow: 0 },
  days: { gap: space.sm, paddingHorizontal: space.lg },
  day: {
    width: 64,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTop: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  dayNumber: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  dayTextActive: { color: colors.onPrimary },
  group: { gap: space.md },
  groupTitle: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: {
    minHeight: TOUCH,
    flexBasis: '22%',
    flexGrow: 1,
    maxWidth: '25%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  slotText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  honeypot: { position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' },
});

import { PageTitle } from '@/ui/PageTitle';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  deleteAdminPushSubscription,
  hasAdminPushSubscription,
  saveAdminPushSubscription,
  signOut,
  toAdminError,
  updateSettings,
  type Settings,
} from '@/lib/admin';
import { parseIntInRange } from '@/lib/adminRules';
import { currentSubscription, pushSupport, subscribeToPush } from '@/lib/push';
import { normalizeRoPhone } from '@/lib/shared';
import { useShop } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
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

const t = texts.admin.settings;

/** Numeric rules: field, label and allowed range (matching the database checks). */
const RULES = [
  { key: 'slot_step_min', label: t.slotStep, min: 5, max: 120 },
  { key: 'min_notice_min', label: t.minNotice, min: 0, max: 10080 },
  { key: 'max_advance_days', label: t.maxAdvance, min: 1, max: 365 },
  { key: 'cancel_deadline_min', label: t.cancelDeadline, min: 0, max: 10080 },
  { key: 'reminder_before_min', label: t.reminderBefore, min: 30, max: 10080 },
] as const;

type RuleKey = (typeof RULES)[number]['key'];

export default function SettingsScreen() {
  const shop = useShop();
  const router = useRouter();

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
      <PageTitle title={`${t.title} · ${texts.admin.title}`} />
      <Title>{t.title}</Title>
      <SettingsForm settings={shop.data.settings} onSaved={shop.reload} />
      <PushSection />
      <Card>
        <Heading>{t.accountSection}</Heading>
        <Button
          label={texts.admin.logout}
          variant="secondary"
          testID="logout"
          onPress={async () => {
            await signOut();
            router.replace('/admin/login');
          }}
        />
      </Card>
    </Screen>
  );
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [shopName, setShopName] = useState(settings.shop_name);
  const [address, setAddress] = useState(settings.address);
  const [phone, setPhone] = useState(settings.phone);
  const [rules, setRules] = useState<Record<RuleKey, string>>(
    () =>
      Object.fromEntries(RULES.map((rule) => [rule.key, String(settings[rule.key])])) as Record<
        RuleKey,
        string
      >,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const cleanName = shopName.trim();
  const cleanPhone = phone.trim() === '' ? '' : normalizeRoPhone(phone);
  const parsed = Object.fromEntries(
    RULES.map((rule) => [rule.key, parseIntInRange(rules[rule.key], rule.min, rule.max)]),
  ) as Record<RuleKey, number | null>;

  const submit = async () => {
    setShowErrors(true);
    setSaved(false);
    const numbersOk = RULES.every((rule) => parsed[rule.key] !== null);
    if (!cleanName || cleanPhone === null || !numbersOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateSettings(settings.id, {
        shop_name: cleanName,
        address: address.trim(),
        phone: cleanPhone,
        ...(parsed as Record<RuleKey, number>),
      });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <Heading>{t.shopSection}</Heading>
        <Field
          label={t.shopName}
          value={shopName}
          onChangeText={setShopName}
          maxLength={80}
          error={showErrors && !cleanName ? t.shopNameError : null}
          testID="settings-shop-name"
        />
        <Field label={t.address} value={address} onChangeText={setAddress} maxLength={200} />
        <Field
          label={t.phone}
          value={phone}
          onChangeText={setPhone}
          inputMode="tel"
          maxLength={20}
          error={showErrors && cleanPhone === null ? t.phoneError : null}
        />
      </Card>
      <Card>
        <Heading>{t.rulesSection}</Heading>
        {RULES.map((rule) => (
          <Field
            key={rule.key}
            label={rule.label}
            value={rules[rule.key]}
            onChangeText={(value) => setRules((current) => ({ ...current, [rule.key]: value }))}
            inputMode="numeric"
            maxLength={5}
            error={
              showErrors && parsed[rule.key] === null ? t.numberError(rule.min, rule.max) : null
            }
            testID={`settings-${rule.key}`}
          />
        ))}
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {saved ? <Notice tone="success">{texts.admin.saved}</Notice> : null}
      <Button
        label={busy ? texts.admin.saving : texts.admin.save}
        busy={busy}
        onPress={submit}
        testID="save-settings"
      />
    </>
  );
}

/** Turns push notifications for new and cancelled bookings on or off for this device. */
function PushSection() {
  const support = pushSupport();
  const [state, setState] = useState<'unknown' | 'off' | 'on' | 'working' | 'declined' | 'error'>(
    'unknown',
  );

  useEffect(() => {
    let current = true;
    (async () => {
      const subscription = await currentSubscription();
      const on = subscription ? await hasAdminPushSubscription(subscription.endpoint) : false;
      if (current) setState(on ? 'on' : 'off');
    })().catch(() => current && setState('off'));
    return () => {
      current = false;
    };
  }, []);

  const enable = async () => {
    setState('working');
    try {
      const subscription = await subscribeToPush();
      if (!subscription) {
        setState('declined');
        return;
      }
      await saveAdminPushSubscription(subscription);
      setState('on');
    } catch {
      setState('error');
    }
  };

  const disable = async () => {
    setState('working');
    try {
      const subscription = await currentSubscription();
      if (subscription) await deleteAdminPushSubscription(subscription.endpoint);
      setState('off');
    } catch {
      setState('error');
    }
  };

  return (
    <Card>
      <Heading>{t.notifySection}</Heading>
      <Body muted>{t.notifyHint}</Body>
      {support === 'unsupported' ? null : support === 'needs-install' ? (
        <Body muted>{texts.booking.notifyNeedsInstall}</Body>
      ) : support === 'blocked' || state === 'declined' ? (
        <Body muted>{texts.booking.notifyBlocked}</Body>
      ) : (
        <View style={{ gap: 8 }}>
          {state === 'on' ? <Notice tone="success">{t.notifyActive}</Notice> : null}
          {state === 'error' ? <Notice tone="danger">{texts.booking.notifyError}</Notice> : null}
          <Button
            label={state === 'on' ? t.notifyDisable : t.notifyEnable}
            variant="secondary"
            busy={state === 'working'}
            disabled={state === 'unknown'}
            testID="admin-push-toggle"
            onPress={state === 'on' ? disable : enable}
          />
        </View>
      )}
    </Card>
  );
}

import { PageTitle } from '@/ui/PageTitle';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { listServices, saveService, toAdminError, type Service } from '@/lib/admin';
import { parseIntInRange, parsePrice } from '@/lib/adminRules';
import { formatPrice } from '@/lib/datetime';
import { useAdminData } from '@/lib/useAdminData';
import { adminErrorText, texts } from '@/texts/ro';
import { Toolbar } from '@/ui/admin';
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
  Screen,
  Title,
} from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const t = texts.admin.services;

export default function ServicesScreen() {
  const services = useAdminData(listServices, 'services');
  /** Service being edited; 'new' for the add form. */
  const [editing, setEditing] = useState<Service | 'new' | null>(null);

  return (
    <Screen wide>
      <PageTitle title={`${t.title} · ${texts.admin.title}`} />
      <Toolbar>
        <Title>{t.title}</Title>
        {editing === null ? (
          <Button label={`+ ${t.new}`} testID="add-service" onPress={() => setEditing('new')} />
        ) : null}
      </Toolbar>

      {editing !== null ? (
        <ServiceForm
          key={editing === 'new' ? 'new' : editing.id}
          service={editing === 'new' ? null : editing}
          nextOrder={(services.data?.length ?? 0) + 1}
          onDone={(changed) => {
            setEditing(null);
            if (changed) services.reload();
          }}
        />
      ) : null}

      {services.status === 'loading' ? <Loading /> : null}
      {services.status === 'error' ? (
        <ErrorState message={adminErrorText(services.error.code)} onRetry={services.reload} />
      ) : null}
      {services.status === 'ready' && services.data.length === 0 ? (
        <Body muted>{t.empty}</Body>
      ) : null}
      {services.data?.map((service) => (
        <Card key={service.id} style={!service.active && styles.inactive}>
          <View style={styles.row} testID="service-row">
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {service.name}
                {service.active ? '' : ` (${t.inactive})`}
              </Text>
              <Text style={styles.meta}>
                {texts.common.minutes(service.duration_min)} · {formatPrice(service.price_ron)}
              </Text>
            </View>
            <Button
              label={texts.admin.edit}
              variant="secondary"
              testID="edit-service"
              onPress={() => setEditing(service)}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function ServiceForm({
  service,
  nextOrder,
  onDone,
}: {
  service: Service | null;
  nextOrder: number;
  onDone: (changed: boolean) => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [duration, setDuration] = useState(String(service?.duration_min ?? 30));
  const [price, setPrice] = useState(service ? String(service.price_ron).replace('.', ',') : '');
  const [order, setOrder] = useState(String(service?.sort_order ?? nextOrder));
  const [active, setActive] = useState(service?.active ?? true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName = name.trim().replace(/\s+/g, ' ');
  const durationMin = parseIntInRange(duration, 5, 480);
  const priceRon = parsePrice(price);
  const sortOrder = parseIntInRange(order, 0, 999);
  const nameOk = cleanName.length >= 1 && cleanName.length <= 80;

  const submit = async () => {
    setShowErrors(true);
    if (!nameOk || durationMin === null || priceRon === null || sortOrder === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveService({
        id: service?.id,
        name: cleanName,
        duration_min: durationMin,
        price_ron: priceRon,
        sort_order: sortOrder,
        active,
      });
      onDone(true);
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading>{service ? service.name : t.new}</Heading>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label={t.name}
        value={name}
        onChangeText={setName}
        maxLength={80}
        error={showErrors && !nameOk ? t.nameError : null}
        testID="service-name"
      />
      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <Field
            label={t.duration}
            value={duration}
            onChangeText={setDuration}
            inputMode="numeric"
            maxLength={3}
            error={showErrors && durationMin === null ? t.durationError : null}
            testID="service-duration"
          />
        </View>
        <View style={styles.pairItem}>
          <Field
            label={t.price}
            value={price}
            onChangeText={setPrice}
            inputMode="decimal"
            maxLength={9}
            error={showErrors && priceRon === null ? t.priceError : null}
            testID="service-price"
          />
        </View>
        <View style={styles.pairItem}>
          <Field
            label={t.order}
            value={order}
            onChangeText={setOrder}
            inputMode="numeric"
            maxLength={3}
            error={showErrors && sortOrder === null ? t.orderError : null}
          />
        </View>
      </View>
      <Checkbox checked={active} onChange={setActive} label={t.active} testID="service-active" />
      <View style={styles.actions}>
        <Button
          label={busy ? texts.admin.saving : texts.admin.save}
          busy={busy}
          onPress={submit}
          testID="save-service"
        />
        <Button
          label={texts.admin.cancelEdit}
          variant="secondary"
          disabled={busy}
          onPress={() => onDone(false)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  inactive: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: '600', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  pairItem: { flexGrow: 1, flexBasis: 150 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

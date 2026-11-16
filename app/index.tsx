import { Stack, useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { formatPhone, formatPrice } from '@/lib/datetime';
import { useAsync } from '@/lib/useAsync';
import { errorText, texts } from '@/texts/ro';
import { Body, Button, Card, ErrorState, Heading, Loading, Screen, Title } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export default function HomeScreen() {
  const router = useRouter();
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
        <Title>{texts.common.appName}</Title>
        <ErrorState message={errorText(state.error.code)} onRetry={state.reload} />
      </Screen>
    );
  }

  const { shop, services } = state.data;
  return (
    <Screen
      footer={
        services.length > 0 ? (
          <Button
            label={texts.home.bookCta}
            onPress={() => router.push('/book')}
            testID="book-cta"
          />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: shop.name }} />
      <View style={styles.header}>
        <Title>{shop.name}</Title>
        {shop.address ? <Body muted>{shop.address}</Body> : null}
        {shop.phone ? (
          <Text
            role="link"
            style={styles.phone}
            aria-label={texts.home.callLabel(formatPhone(shop.phone))}
            onPress={() => Linking.openURL(`tel:${shop.phone}`)}
          >
            {formatPhone(shop.phone)}
          </Text>
        ) : null}
      </View>

      <Heading>{texts.home.servicesTitle}</Heading>
      {services.length === 0 ? (
        <Body muted>{texts.book.noServices}</Body>
      ) : (
        <Card style={styles.list}>
          {services.map((service, index) => (
            <Pressable
              key={service.id}
              role="link"
              onPress={() => router.push({ pathname: '/book', params: { service: service.id } })}
              style={({ pressed }) => [
                styles.item,
                index > 0 && styles.itemBorder,
                pressed && styles.itemPressed,
              ]}
            >
              <View style={styles.itemText}>
                <Text style={styles.itemName}>{service.name}</Text>
                <Text style={styles.itemMeta}>{texts.common.minutes(service.duration_min)}</Text>
              </View>
              <Text style={styles.itemPrice}>{formatPrice(service.price_ron)}</Text>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs, paddingTop: space.lg },
  phone: { fontSize: font.md, color: colors.accent, fontWeight: '600', paddingVertical: space.sm },
  list: { padding: 0, gap: 0 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.lg,
    gap: space.md,
  },
  itemPressed: { backgroundColor: colors.background },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  itemText: { flex: 1, gap: 2 },
  itemName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: font.sm, color: colors.textMuted },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
});

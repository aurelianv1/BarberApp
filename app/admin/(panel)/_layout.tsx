import { Redirect, Slot, usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/lib/useSession';
import { texts } from '@/texts/ro';
import { Loading, Screen } from '@/ui/components';
import { colors, font, space, TOUCH } from '@/ui/theme';

const TABS: { href: Href; label: string; match: (path: string) => boolean }[] = [
  {
    href: '/admin',
    label: texts.admin.nav.today,
    match: (path) => path === '/admin' || path.startsWith('/admin/bookings'),
  },
  { href: '/admin/calendar', label: texts.admin.nav.week, match: (p) => p === '/admin/calendar' },
  {
    href: '/admin/services',
    label: texts.admin.nav.services,
    match: (p) => p === '/admin/services',
  },
  { href: '/admin/hours', label: texts.admin.nav.hours, match: (p) => p === '/admin/hours' },
  {
    href: '/admin/settings',
    label: texts.admin.nav.settings,
    match: (p) => p === '/admin/settings',
  },
];

/** Everything under /admin except the login page: requires a signed-in admin. */
export default function AdminPanelLayout() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (session === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (session === 'signed-out') return <Redirect href="/admin/login" />;

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} role="navigation">
          <View style={styles.tabs}>
            {TABS.map((tab) => {
              const active = tab.match(pathname);
              return (
                <Pressable
                  key={tab.label}
                  role="link"
                  aria-current={active ? 'page' : undefined}
                  onPress={() => router.navigate(tab.href)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { flexDirection: 'row', paddingHorizontal: space.sm },
  tab: {
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.text },
});

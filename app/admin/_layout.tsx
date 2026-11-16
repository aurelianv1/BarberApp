import { Stack } from 'expo-router';

import { texts } from '@/texts/ro';

export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: false, title: texts.admin.title }} />;
}

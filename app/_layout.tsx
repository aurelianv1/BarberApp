import { Stack } from 'expo-router';

import { texts } from '@/texts/ro';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false, title: texts.common.appName }} />;
}

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { registerServiceWorker } from '@/lib/push';
import { texts } from '@/texts/ro';

export default function RootLayout() {
  useEffect(() => {
    // Needed for push notifications; a failure here must never break the app.
    registerServiceWorker()?.catch(() => undefined);
  }, []);

  return <Stack screenOptions={{ headerShown: false, title: texts.common.appName }} />;
}

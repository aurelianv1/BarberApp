import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

/** Sets the browser tab title while its screen is the one in view. Renders nothing. */
export function PageTitle({ title }: { title: string }) {
  useFocusEffect(
    useCallback(() => {
      document.title = title;
    }, [title]),
  );
  return null;
}

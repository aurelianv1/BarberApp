import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { AdminError, getSettings, getStaffId, toAdminError, type Settings } from './admin';

export type AdminData<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: AdminError };

/**
 * Loads admin data for `key`, reloads it when the screen regains focus (another screen may
 * have changed it) and on demand. While reloading, the previous data stays on screen.
 */
export function useAdminData<T>(
  load: () => Promise<T>,
  key: string,
): AdminData<T> & { reload: () => void; refreshing: boolean } {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    version: number;
    state: AdminData<T>;
  } | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    let current = true;
    run().then(
      (data) => current && setSettled({ key, version, state: { status: 'ready', data } }),
      (error) =>
        current &&
        setSettled({ key, version, state: { status: 'error', error: toAdminError(error) } }),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useFocusEffect(reload);

  const state: AdminData<T> = settled?.key === key ? settled.state : { status: 'loading' };
  return { ...state, reload, refreshing: settled?.key === key && settled.version !== version };
}

/** Settings and the (single) staff member: needed by almost every admin screen. */
export function useShop() {
  return useAdminData<{ settings: Settings; staffId: string }>(async () => {
    const [settings, staffId] = await Promise.all([getSettings(), getStaffId()]);
    return { settings, staffId };
  }, 'shop');
}

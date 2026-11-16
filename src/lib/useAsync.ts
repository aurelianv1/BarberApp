import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { ApiError } from './api';

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: ApiError };

export const toApiError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError('internal_error', 0);

/**
 * Runs `load` on mount and whenever `key` changes. A result is only shown while it belongs to
 * the current request, so a slow response for a previous key can never overwrite a newer one.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  key: string,
): AsyncState<T> & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const requestId = `${key}#${attempt}`;
  const [settled, setSettled] = useState<{ requestId: string; state: AsyncState<T> } | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    let current = true;
    run().then(
      (data) => current && setSettled({ requestId, state: { status: 'ready', data } }),
      (error) =>
        current && setSettled({ requestId, state: { status: 'error', error: toApiError(error) } }),
    );
    return () => {
      current = false;
    };
  }, [requestId]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const state: AsyncState<T> =
    settled?.requestId === requestId ? settled.state : { status: 'loading' };
  return { ...state, reload };
}

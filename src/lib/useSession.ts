import { useEffect, useState } from 'react';

import { supabase } from './supabase';

export type SessionState = 'loading' | 'signed-out' | 'signed-in';

/** Tracks whether an admin is signed in on this device. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>('loading');
  useEffect(() => {
    // Fires once with the stored session (INITIAL_SESSION), then on every change.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? 'signed-in' : 'signed-out');
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

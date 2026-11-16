import { createClient } from '@supabase/supabase-js';

/**
 * Browser client for the admin panel. It uses the public (anon/publishable) key only; what a
 * signed-in admin may do is decided by Row Level Security in the database.
 */
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);

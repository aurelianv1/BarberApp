import { createClient, type SupabaseClient } from './deps.ts';

/**
 * Server-side client using the service_role key, which bypasses RLS.
 * It exists only inside Edge Functions; the key is never sent to the browser.
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

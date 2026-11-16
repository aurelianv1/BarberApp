import type { SupabaseClient } from './deps.ts';
import type { PushMessage } from './texts.ts';
import { sendPush, type VapidConfig } from './webpush.ts';

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendSummary {
  sent: number;
  failed: number;
}

/** VAPID keys from the function secrets; null (push disabled) when they are not configured. */
export function vapidConfig(): VapidConfig | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Hosts accepted in addition to the real push services. Used by local tests only. */
export function extraPushHosts(): string[] {
  return (Deno.env.get('PUSH_EXTRA_HOSTS') ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

async function sendTo(
  db: SupabaseClient,
  subscriptions: SubscriptionRow[],
  message: PushMessage,
): Promise<SendSummary> {
  const vapid = vapidConfig();
  if (!vapid) {
    if (subscriptions.length > 0) console.warn('Push not sent: VAPID keys are not configured');
    return { sent: 0, failed: subscriptions.length };
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const result = await sendPush(subscription, message, vapid);
      if (!result.ok) {
        console.warn(`Push failed (${result.status}): ${result.error}`);
        // The browser dropped the subscription: stop sending to it.
        if (result.gone) await db.from('push_subscriptions').delete().eq('id', subscription.id);
      }
      return result.ok;
    }),
  );
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}

export async function notifyBooking(
  db: SupabaseClient,
  bookingId: string,
  message: PushMessage,
): Promise<SendSummary> {
  const { data, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('booking_id', bookingId);
  if (error) throw error;
  return sendTo(db, data as SubscriptionRow[], message);
}

export async function notifyAdmins(db: SupabaseClient, message: PushMessage): Promise<SendSummary> {
  const { data, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .not('admin_user_id', 'is', null);
  if (error) throw error;
  return sendTo(db, data as SubscriptionRow[], message);
}

/**
 * Runs a notification without delaying or failing the HTTP response: the customer's booking
 * must succeed even when a push service is slow or down.
 */
export function inBackground(task: Promise<unknown>): void {
  const guarded = task.catch((error) => console.error('Background notification failed', error));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } })
    .EdgeRuntime;
  if (runtime) runtime.waitUntil(guarded);
}

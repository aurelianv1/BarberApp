import { loadSettings } from '../_shared/availability.ts';
import { ApiError, serve } from '../_shared/http.ts';
import { notifyBooking } from '../_shared/notify.ts';
import { pushTexts } from '../_shared/texts.ts';

interface DueReminder {
  booking_id: string;
  starts_at: string;
  service_name: string;
  cancel_token: string;
}

/** Compares without leaking, through timing, how many leading characters matched. */
function sameSecret(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

// POST /send-reminders, called by pg_cron every 10 minutes with the x-cron-secret header.
// Idempotent: the database hands each due booking to exactly one run.
serve(
  { method: 'POST', rateLimit: { name: 'cron', max: 30, windowSeconds: 60 } },
  async ({ req, db }) => {
    const expected = Deno.env.get('CRON_SECRET');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if (!expected || !sameSecret(provided, expected)) {
      throw new ApiError(404, 'not_found', 'Not found');
    }

    const [settings, due] = await Promise.all([loadSettings(db), db.rpc('claim_due_reminders')]);
    if (due.error) throw due.error;

    let sent = 0;
    let failed = 0;
    for (const reminder of due.data as DueReminder[]) {
      try {
        const result = await notifyBooking(
          db,
          reminder.booking_id,
          pushTexts.reminder({
            shopName: settings.shop_name,
            serviceName: reminder.service_name,
            startsAt: reminder.starts_at,
            timezone: settings.timezone,
            cancelToken: reminder.cancel_token,
          }),
        );
        sent += result.sent;
        failed += result.failed;
      } catch (error) {
        // One broken booking must not stop the others.
        console.error(`Reminder failed for booking ${reminder.booking_id}`, error);
        failed += 1;
      }
    }

    return { claimed: due.data.length, sent, failed };
  },
);

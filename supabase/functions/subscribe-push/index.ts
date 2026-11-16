import { loadSettings } from '../_shared/availability.ts';
import { loadBookingByToken, Token } from '../_shared/booking-view.ts';
import { z } from '../_shared/deps.ts';
import { ApiError, parse, readJson, serve } from '../_shared/http.ts';
import { extraPushHosts, notifyBooking } from '../_shared/notify.ts';
import { pushTexts } from '../_shared/texts.ts';
import { isAllowedPushEndpoint } from '../_shared/webpush.ts';

const MAX_SUBSCRIPTIONS_PER_BOOKING = 3;

const Body = z.object({
  token: Token,
  subscription: z.object({
    endpoint: z.string().max(1000),
    keys: z.object({
      p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
      auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
    }),
  }),
});

// POST /subscribe-push { token, subscription } -> attaches a browser push subscription to the
// customer's booking and sends the confirmation notification.
serve(
  { method: 'POST', rateLimit: { name: 'booking-token', max: 30, windowSeconds: 60 } },
  async ({ req, db }) => {
    const { token, subscription } = parse(Body, await readJson(req));

    if (!isAllowedPushEndpoint(subscription.endpoint, extraPushHosts())) {
      throw new ApiError(400, 'invalid_input', 'Unknown push service');
    }

    const [settings, booking] = await Promise.all([
      loadSettings(db),
      loadBookingByToken(db, token),
    ]);
    if (booking.status !== 'confirmed') {
      throw new ApiError(409, 'not_cancellable', 'Booking is not active');
    }

    const existing = await db
      .from('push_subscriptions')
      .select('endpoint')
      .eq('booking_id', booking.id);
    if (existing.error) throw existing.error;
    const known = existing.data.some((row) => row.endpoint === subscription.endpoint);
    if (!known && existing.data.length >= MAX_SUBSCRIPTIONS_PER_BOOKING) {
      throw new ApiError(429, 'rate_limited', 'Too many devices for this booking');
    }

    const saved = await db.from('push_subscriptions').upsert(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        booking_id: booking.id,
      },
      { onConflict: 'endpoint,booking_id,admin_user_id' },
    );
    if (saved.error) throw saved.error;

    // Sent right away: it confirms to the customer that notifications really work.
    const result = known
      ? { sent: 0, failed: 0 }
      : await notifyBooking(
          db,
          booking.id,
          pushTexts.confirmation({
            shopName: settings.shop_name,
            serviceName: booking.services.name,
            startsAt: booking.starts_at,
            timezone: settings.timezone,
            cancelToken: token,
          }),
        );

    return { subscribed: true, delivered: result.sent > 0 };
  },
);

import { loadSettings } from '../_shared/availability.ts';
import { canCancel } from '../_shared/booking-rules.ts';
import { loadBookingByToken, publicBooking, Token } from '../_shared/booking-view.ts';
import { z } from '../_shared/deps.ts';
import { ApiError, parse, readJson, serve } from '../_shared/http.ts';
import { inBackground, notifyAdmins } from '../_shared/notify.ts';
import { pushTexts } from '../_shared/texts.ts';

const Body = z.object({ token: Token });

// POST /cancel-booking { token } -> cancels while the cancellation deadline has not passed.
serve(
  { method: 'POST', rateLimit: { name: 'booking-token', max: 30, windowSeconds: 60 } },
  async ({ req, db }) => {
    const { token } = parse(Body, await readJson(req));
    const now = new Date();
    const [settings, booking] = await Promise.all([
      loadSettings(db),
      loadBookingByToken(db, token),
    ]);

    const check = canCancel(
      { status: booking.status, startsAt: booking.starts_at },
      settings.cancel_deadline_min,
      now,
    );
    if (!check.ok) {
      if (check.reason === 'too_late') {
        throw new ApiError(409, 'cancel_too_late', 'The cancellation deadline has passed');
      }
      throw new ApiError(409, 'not_cancellable', `Booking cannot be cancelled (${check.reason})`);
    }

    // The status filter makes the update a no-op if the booking changed in the meantime.
    const updated = await db
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', booking.id)
      .eq('status', 'confirmed')
      .select('id');
    if (updated.error) throw updated.error;
    if (updated.data.length === 0) {
      throw new ApiError(409, 'not_cancellable', 'Booking is no longer confirmed');
    }

    inBackground(
      notifyAdmins(
        db,
        pushTexts.adminCancelled({
          customerName: booking.customer_name,
          serviceName: booking.services.name,
          startsAt: booking.starts_at,
          timezone: settings.timezone,
        }),
      ),
    );

    return publicBooking({ ...booking, status: 'cancelled' }, settings, now);
  },
);

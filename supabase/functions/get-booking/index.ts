import { loadSettings } from '../_shared/availability.ts';
import { loadBookingByToken, publicBooking, Token } from '../_shared/booking-view.ts';
import { z } from '../_shared/deps.ts';
import { parse, serve } from '../_shared/http.ts';

const Query = z.object({ token: Token });

// GET /get-booking?token= -> the customer's own booking.
serve(
  // Tighter than other reads: this is the endpoint someone would hammer to guess tokens.
  { method: 'GET', rateLimit: { name: 'booking-token', max: 30, windowSeconds: 60 } },
  async ({ url, db }) => {
    const { token } = parse(Query, Object.fromEntries(url.searchParams));
    const [settings, booking] = await Promise.all([
      loadSettings(db),
      loadBookingByToken(db, token),
    ]);
    return publicBooking(booking, settings, new Date());
  },
);

import {
  loadActiveService,
  loadDefaultStaffId,
  loadSettings,
  slotIsFree,
} from '../_shared/availability.ts';
import {
  MAX_ACTIVE_BOOKINGS_PER_PHONE,
  normalizeCustomerName,
  normalizeRoPhone,
} from '../_shared/booking-rules.ts';
import { z } from '../_shared/deps.ts';
import { ApiError, parse, readJson, serve } from '../_shared/http.ts';
import { inBackground, notifyAdmins } from '../_shared/notify.ts';
import { localDateOf } from '../_shared/slots.ts';
import { pushTexts } from '../_shared/texts.ts';

const EXCLUSION_VIOLATION = '23P01';

const Body = z.object({
  service_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  customer_name: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const name = normalizeCustomerName(value);
      if (!name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid name' });
        return z.NEVER;
      }
      return name;
    }),
  customer_phone: z
    .string()
    .max(40)
    .transform((value, ctx) => {
      const phone = normalizeRoPhone(value);
      if (!phone) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Romanian mobile number' });
        return z.NEVER;
      }
      return phone;
    }),
  consent: z.literal(true),
  // Honeypot: a field hidden from people. Bots that fill every input get rejected.
  website: z.string().max(0).optional(),
});

function newCancelToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

// POST /create-booking { service_id, starts_at, customer_name, customer_phone, consent }
serve(
  { method: 'POST', rateLimit: { name: 'create-booking', max: 10, windowSeconds: 60 } },
  async ({ req, db }) => {
    const body = parse(Body, await readJson(req));
    const now = new Date();
    const startsAt = new Date(body.starts_at);

    const [settings, service, staffId] = await Promise.all([
      loadSettings(db),
      loadActiveService(db, body.service_id),
      loadDefaultStaffId(db),
    ]);

    const active = await db
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_phone', body.customer_phone)
      .eq('status', 'confirmed')
      .gt('starts_at', now.toISOString());
    if (active.error) throw active.error;
    if ((active.count ?? 0) >= MAX_ACTIVE_BOOKINGS_PER_PHONE) {
      throw new ApiError(429, 'too_many_bookings', 'Too many active bookings for this phone');
    }

    // Never trust the client: availability is recomputed here from the database.
    const localDate = localDateOf(startsAt, settings.timezone);
    if (!(await slotIsFree(db, settings, service, staffId, startsAt, now, localDate))) {
      throw new ApiError(409, 'slot_taken', 'This time is no longer available');
    }

    const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000);
    const inserted = await db
      .from('bookings')
      .insert({
        staff_id: staffId,
        service_id: service.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        cancel_token: newCancelToken(),
        source: 'online',
      })
      .select('cancel_token, status')
      .single();

    if (inserted.error) {
      // Someone else took the slot between the check above and the insert.
      if (inserted.error.code === EXCLUSION_VIOLATION) {
        throw new ApiError(409, 'slot_taken', 'This time was just taken');
      }
      throw inserted.error;
    }

    inBackground(
      notifyAdmins(
        db,
        pushTexts.adminNewBooking({
          customerName: body.customer_name,
          serviceName: service.name,
          startsAt: startsAt.toISOString(),
          timezone: settings.timezone,
        }),
      ),
    );

    return {
      cancel_token: inserted.data.cancel_token,
      booking: {
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: inserted.data.status,
        service: {
          name: service.name,
          duration_min: service.duration_min,
          price_ron: service.price_ron,
        },
      },
    };
  },
);

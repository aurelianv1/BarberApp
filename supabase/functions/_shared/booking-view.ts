import type { Settings } from './availability.ts';
import { canCancel, cancelDeadlineMs } from './booking-rules.ts';
import { z, type SupabaseClient } from './deps.ts';
import { ApiError } from './http.ts';

export const Token = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export interface BookingRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  services: { name: string; duration_min: number; price_ron: number };
}

export async function loadBookingByToken(db: SupabaseClient, token: string): Promise<BookingRow> {
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, starts_at, ends_at, status, customer_name, services (name, duration_min, price_ron)',
    )
    .eq('cancel_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'not_found', 'Booking not found');
  return data as unknown as BookingRow;
}

/** What the customer may see about their own booking. No internal ids, no other customers. */
export function publicBooking(row: BookingRow, settings: Settings, now: Date) {
  const check = canCancel(
    { status: row.status, startsAt: row.starts_at },
    settings.cancel_deadline_min,
    now,
  );
  return {
    booking: {
      starts_at: new Date(row.starts_at).toISOString(),
      ends_at: new Date(row.ends_at).toISOString(),
      status: row.status,
      customer_name: row.customer_name,
      service: row.services,
      can_cancel: check.ok,
      cancel_blocked_reason: check.ok ? null : check.reason,
      cancel_deadline: new Date(
        cancelDeadlineMs(row.starts_at, settings.cancel_deadline_min),
      ).toISOString(),
    },
    shop: {
      name: settings.shop_name,
      address: settings.address,
      phone: settings.phone,
      timezone: settings.timezone,
    },
  };
}

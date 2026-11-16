/** Client for the public booking API (Supabase Edge Functions). */

const BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1`;

export type ApiErrorCode =
  | 'method_not_allowed'
  | 'invalid_input'
  | 'rate_limited'
  | 'not_found'
  | 'service_unavailable'
  | 'slot_taken'
  | 'too_many_bookings'
  | 'not_cancellable'
  | 'cancel_too_late'
  | 'internal_error'
  | 'network_error';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly fields: string[] = [],
  ) {
    super(code);
  }
}

export interface Shop {
  name: string;
  address: string;
  phone: string;
  timezone: string;
}

export interface ShopDetails extends Shop {
  max_advance_days: number;
  min_notice_min: number;
  cancel_deadline_min: number;
}

export interface Service {
  id: string;
  name: string;
  duration_min: number;
  price_ron: number;
}

export interface Booking {
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  customer_name: string;
  service: { name: string; duration_min: number; price_ron: number };
  can_cancel: boolean;
  cancel_blocked_reason: 'not_confirmed' | 'already_started' | 'too_late' | null;
  cancel_deadline: string;
}

export interface BookingView {
  booking: Booking;
  shop: Shop;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/${path}`, init);
  } catch {
    throw new ApiError('network_error', 0);
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (gateway error page): handled below as an internal error.
  }

  if (!response.ok || body === null) {
    const code: ApiErrorCode = body?.error?.code ?? 'internal_error';
    const fields: string[] = Array.isArray(body?.error?.details)
      ? body.error.details.map((detail: { field?: string }) => detail.field ?? '')
      : [];
    throw new ApiError(code, response.status, fields);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const api = {
  getServices: () => request<{ shop: ShopDetails; services: Service[] }>('get-services'),

  getSlots: (serviceId: string, date: string) =>
    request<{ date: string; timezone: string; slots: string[] }>(
      `get-slots?service_id=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`,
    ),

  createBooking: (input: {
    service_id: string;
    starts_at: string;
    customer_name: string;
    customer_phone: string;
    consent: boolean;
    website?: string;
  }) => post<{ cancel_token: string }>('create-booking', input),

  getBooking: (token: string) =>
    request<BookingView>(`get-booking?token=${encodeURIComponent(token)}`),

  cancelBooking: (token: string) => post<BookingView>('cancel-booking', { token }),

  subscribePush: (
    token: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) => post<{ subscribed: boolean; delivered: boolean }>('subscribe-push', { token, subscription }),
};

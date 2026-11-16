/** Data access for the admin panel. Every call goes through RLS as the signed-in admin. */
import { newCancelToken, type BookingStatus } from './adminRules';
import { supabase } from './supabase';

export type AdminErrorCode =
  'slot_taken' | 'not_admin' | 'bad_credentials' | 'not_found' | 'in_use' | 'network' | 'unknown';

export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
  }
}

export const toAdminError = (error: unknown): AdminError =>
  error instanceof AdminError ? error : new AdminError('unknown');

/** Maps a database error to something the UI can explain. */
function fail(error: { code?: string; message?: string }): never {
  if (error.code === '23P01') throw new AdminError('slot_taken'); // exclusion violation
  if (error.code === '23503') throw new AdminError('in_use'); // foreign key
  if (error.code === 'PGRST116') throw new AdminError('not_found');
  if (/fetch|network/i.test(error.message ?? '')) throw new AdminError('network');
  throw new AdminError('unknown');
}

export interface Settings {
  id: string;
  shop_name: string;
  address: string;
  phone: string;
  timezone: string;
  slot_step_min: number;
  min_notice_min: number;
  max_advance_days: number;
  cancel_deadline_min: number;
  reminder_before_min: number;
}

export interface Service {
  id: string;
  name: string;
  duration_min: number;
  price_ron: number;
  active: boolean;
  sort_order: number;
}

export interface WorkingHours {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface TimeOff {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface Booking {
  id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string | null;
  notes: string | null;
  source: 'online' | 'admin';
  cancel_token: string;
  created_at: string;
  services: { name: string; duration_min: number; price_ron: number };
}

const BOOKING_COLUMNS =
  'id, starts_at, ends_at, status, customer_name, customer_phone, notes, source, cancel_token, created_at, services (name, duration_min, price_ron)';

// --- Session ---------------------------------------------------------------

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new AdminError(error.status === 400 ? 'bad_credentials' : 'network');
  }
  // A valid account that is not in `admins` sees no data at all; say so instead of showing
  // an empty panel.
  if (!(await isAdmin())) {
    await supabase.auth.signOut();
    throw new AdminError('not_admin');
  }
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.from('admins').select('user_id').limit(1);
  if (error) fail(error);
  return data.length > 0;
}

export const signOut = () => supabase.auth.signOut();

// --- Settings --------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from('settings')
    .select(
      'id, shop_name, address, phone, timezone, slot_step_min, min_notice_min, max_advance_days, cancel_deadline_min, reminder_before_min',
    )
    .single();
  if (error) fail(error);
  return data as Settings;
}

export async function updateSettings(id: string, patch: Partial<Omit<Settings, 'id'>>) {
  const { error } = await supabase.from('settings').update(patch).eq('id', id);
  if (error) fail(error);
}

export async function getStaffId(): Promise<string> {
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .single();
  if (error) fail(error);
  return data.id as string;
}

// --- Services --------------------------------------------------------------

export async function listServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, duration_min, price_ron, active, sort_order')
    .order('sort_order')
    .order('name');
  if (error) fail(error);
  return data as Service[];
}

export async function saveService(service: Omit<Service, 'id'> & { id?: string }): Promise<void> {
  const { id, ...values } = service;
  const { error } = id
    ? await supabase.from('services').update(values).eq('id', id)
    : await supabase.from('services').insert(values);
  if (error) fail(error);
}

// --- Working hours and time off --------------------------------------------

export async function listWorkingHours(staffId: string): Promise<WorkingHours[]> {
  const { data, error } = await supabase
    .from('working_hours')
    .select('id, weekday, start_time, end_time')
    .eq('staff_id', staffId)
    .order('weekday')
    .order('start_time');
  if (error) fail(error);
  return data as WorkingHours[];
}

export async function addWorkingHours(
  staffId: string,
  weekday: number,
  start: string,
  end: string,
): Promise<void> {
  const { error } = await supabase
    .from('working_hours')
    .insert({ staff_id: staffId, weekday, start_time: start, end_time: end });
  if (error) fail(error);
}

export async function deleteWorkingHours(id: string): Promise<void> {
  const { error } = await supabase.from('working_hours').delete().eq('id', id);
  if (error) fail(error);
}

/** Time off that has not ended yet. */
export async function listTimeOff(staffId: string): Promise<TimeOff[]> {
  const { data, error } = await supabase
    .from('time_off')
    .select('id, starts_at, ends_at, reason')
    .eq('staff_id', staffId)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at');
  if (error) fail(error);
  return data as TimeOff[];
}

export async function addTimeOff(
  staffId: string,
  startsAt: string,
  endsAt: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from('time_off')
    .insert({ staff_id: staffId, starts_at: startsAt, ends_at: endsAt, reason: reason || null });
  if (error) fail(error);
}

export async function deleteTimeOff(id: string): Promise<void> {
  const { error } = await supabase.from('time_off').delete().eq('id', id);
  if (error) fail(error);
}

/** Time off overlapping [from, to), for slot calculation. */
export async function listTimeOffBetween(staffId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from('time_off')
    .select('starts_at, ends_at')
    .eq('staff_id', staffId)
    .lt('starts_at', to)
    .gt('ends_at', from);
  if (error) fail(error);
  return data as { starts_at: string; ends_at: string }[];
}

// --- Bookings --------------------------------------------------------------

/** Bookings starting in [from, to), earliest first. */
export async function listBookings(from: string, to: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at');
  if (error) fail(error);
  return data as unknown as Booking[];
}

export async function getBooking(id: string): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .single();
  if (error) fail(error);
  return data as unknown as Booking;
}

export async function setBookingStatus(id: string, status: BookingStatus): Promise<void> {
  const { error } = await supabase.from('bookings').update({ status }).eq('id', id);
  if (error) fail(error);
}

export async function setBookingNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ notes: notes.trim() || null })
    .eq('id', id);
  if (error) fail(error);
}

export async function createBooking(input: {
  staffId: string;
  serviceId: string;
  startsAt: string;
  durationMin: number;
  customerName: string;
  customerPhone: string | null;
  notes: string;
}): Promise<string> {
  const startMs = Date.parse(input.startsAt);
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      staff_id: input.staffId,
      service_id: input.serviceId,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(startMs + input.durationMin * 60_000).toISOString(),
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      notes: input.notes.trim() || null,
      cancel_token: newCancelToken(),
      source: 'admin',
    })
    .select('id')
    .single();
  if (error) fail(error);
  return data.id as string;
}

// --- Push for the barber's device -------------------------------------------

export async function saveAdminPushSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new AdminError('not_admin');
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      admin_user_id: userId,
    },
    { onConflict: 'endpoint,booking_id,admin_user_id' },
  );
  if (error) fail(error);
}

export async function hasAdminPushSubscription(endpoint: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .not('admin_user_id', 'is', null)
    .limit(1);
  if (error) fail(error);
  return data.length > 0;
}

export async function deleteAdminPushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .not('admin_user_id', 'is', null);
  if (error) fail(error);
}

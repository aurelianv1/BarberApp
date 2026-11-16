import type { SupabaseClient } from './deps.ts';
import { ApiError } from './http.ts';
import {
  computeSlots,
  isSlotAvailable,
  zonedTimeToUtcMs,
  type SlotInput,
  type SlotSettings,
} from './slots.ts';

export interface Settings {
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
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db
    .from('settings')
    .select(
      'shop_name, address, phone, timezone, slot_step_min, min_notice_min, max_advance_days, cancel_deadline_min, reminder_before_min',
    )
    .single();
  if (error) throw error;
  return data as Settings;
}

export async function loadActiveService(db: SupabaseClient, serviceId: string): Promise<Service> {
  const { data, error } = await db
    .from('services')
    .select('id, name, duration_min, price_ron')
    .eq('id', serviceId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'service_unavailable', 'Service not found or inactive');
  return data as Service;
}

/** MVP: a single barber. Returns the first active staff member. */
export async function loadDefaultStaffId(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from('staff')
    .select('id')
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'service_unavailable', 'No active staff');
  return data.id as string;
}

function slotSettings(settings: Settings): SlotSettings {
  return {
    timezone: settings.timezone,
    slotStepMin: settings.slot_step_min,
    minNoticeMin: settings.min_notice_min,
    maxAdvanceDays: settings.max_advance_days,
  };
}

/** Loads everything the slot calculation needs for one local calendar day. */
async function loadDayInput(
  db: SupabaseClient,
  settings: Settings,
  service: Service,
  staffId: string,
  date: string,
  now: Date,
): Promise<SlotInput> {
  // A generous window around the local day; the calculation itself does the exact filtering.
  const dayStart = zonedTimeToUtcMs(date, '00:00', settings.timezone);
  const from = new Date(dayStart - DAY_MS).toISOString();
  const to = new Date(dayStart + 2 * DAY_MS).toISOString();

  const [hours, timeOff, bookings] = await Promise.all([
    db.from('working_hours').select('weekday, start_time, end_time').eq('staff_id', staffId),
    db
      .from('time_off')
      .select('starts_at, ends_at')
      .eq('staff_id', staffId)
      .lt('starts_at', to)
      .gt('ends_at', from),
    db
      .from('bookings')
      .select('starts_at, ends_at, status')
      .eq('staff_id', staffId)
      .eq('status', 'confirmed')
      .lt('starts_at', to)
      .gt('ends_at', from),
  ]);
  if (hours.error) throw hours.error;
  if (timeOff.error) throw timeOff.error;
  if (bookings.error) throw bookings.error;

  return {
    settings: slotSettings(settings),
    durationMin: service.duration_min,
    date,
    workingHours: hours.data.map((row) => ({
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
    })),
    timeOff: timeOff.data.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at })),
    bookings: bookings.data.map((row) => ({
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
    })),
    now,
  };
}

export async function freeSlots(
  db: SupabaseClient,
  settings: Settings,
  service: Service,
  staffId: string,
  date: string,
  now: Date,
): Promise<string[]> {
  return computeSlots(await loadDayInput(db, settings, service, staffId, date, now));
}

export async function slotIsFree(
  db: SupabaseClient,
  settings: Settings,
  service: Service,
  staffId: string,
  startsAt: Date,
  now: Date,
  localDate: string,
): Promise<boolean> {
  const input = await loadDayInput(db, settings, service, staffId, localDate, now);
  return isSlotAvailable(input, startsAt);
}

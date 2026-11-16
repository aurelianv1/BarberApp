-- Admin-created bookings (walk-ins, phone calls) may have no phone number.
alter table public.bookings
  drop constraint bookings_check1,
  add constraint bookings_phone_required check (
    customer_phone is not null or anonymized_at is not null or source = 'admin'
  );

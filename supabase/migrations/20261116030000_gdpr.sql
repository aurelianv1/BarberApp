-- GDPR: customer data is removed automatically after the retention period, and the barber
-- can remove a customer on request.

-- Replaces personal data on a set of bookings. The rows themselves stay, so the agenda and
-- any future statistics remain consistent; the link token is replaced so old links stop working.
create function public.anonymize_bookings(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.push_subscriptions where booking_id = any (p_ids);

  update public.bookings
  set customer_name = 'Client șters',
      customer_phone = null,
      notes = null,
      anonymized_at = now(),
      cancel_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      -- A removed customer cannot keep a future appointment.
      status = case when status = 'confirmed' and starts_at > now() then 'cancelled' else status end
  where id = any (p_ids)
    and anonymized_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Daily job: anonymize bookings older than settings.data_retention_months.
create function public.anonymize_old_bookings()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.anonymize_bookings(
    coalesce(
      array(
        select b.id
        from public.bookings b
        cross join (select data_retention_months from public.settings limit 1) s
        where b.anonymized_at is null
          and b.ends_at < now() - make_interval(months => s.data_retention_months)
      ),
      '{}'
    )
  );
$$;

-- Called from the admin panel: removes the customer of one booking everywhere, i.e. every
-- booking made with the same phone number (or just this booking when it has no phone).
create function public.delete_customer(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select customer_phone into v_phone from public.bookings where id = p_booking_id;
  if not found then
    return 0;
  end if;

  if v_phone is null then
    v_ids := array[p_booking_id];
  else
    select array_agg(id) into v_ids from public.bookings where customer_phone = v_phone;
  end if;

  return public.anonymize_bookings(v_ids);
end;
$$;

revoke all on function public.anonymize_bookings(uuid[]) from public, anon, authenticated;
revoke all on function public.anonymize_old_bookings() from public, anon, authenticated;
revoke all on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated;
grant execute on function public.anonymize_bookings(uuid[]) to service_role;
grant execute on function public.anonymize_old_bookings() to service_role;

select cron.schedule('anonymize-old-bookings', '43 3 * * *', $$select public.anonymize_old_bookings()$$);

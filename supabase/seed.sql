-- Local development data. TODO: replace with the real shop details (PLAN.md section 12).

update public.settings
set shop_name = 'Frizeria Test',
    address = 'Str. Exemplu nr. 1, București',
    phone = '+40700000000';

insert into public.services (name, duration_min, price_ron, sort_order) values
  ('Tuns', 30, 50, 1),
  ('Tuns + barbă', 45, 70, 2),
  ('Aranjat barbă', 20, 30, 3),
  ('Tuns copii', 20, 35, 4);

-- Monday-Friday 09:00-13:00 and 14:00-18:00, Saturday 09:00-14:00, Sunday closed.
insert into public.working_hours (staff_id, weekday, start_time, end_time)
select s.id, d.weekday, h.start_time, h.end_time
from public.staff s
cross join generate_series(1, 5) as d (weekday)
cross join (values ('09:00'::time, '13:00'::time), ('14:00'::time, '18:00'::time))
  as h (start_time, end_time);

insert into public.working_hours (staff_id, weekday, start_time, end_time)
select s.id, 6, '09:00', '14:00' from public.staff s;

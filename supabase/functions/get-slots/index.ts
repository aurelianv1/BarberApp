import {
  freeSlots,
  loadActiveService,
  loadDefaultStaffId,
  loadSettings,
} from '../_shared/availability.ts';
import { z } from '../_shared/deps.ts';
import { parse, serve } from '../_shared/http.ts';

const Query = z.object({
  service_id: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const time = Date.parse(`${value}T00:00:00Z`);
      return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
    }, 'Invalid date'),
});

// GET /get-slots?service_id=&date=YYYY-MM-DD -> free start times (ISO, UTC) for that day.
serve(
  { method: 'GET', rateLimit: { name: 'read', max: 120, windowSeconds: 60 } },
  async ({ url, db }) => {
    const query = parse(Query, Object.fromEntries(url.searchParams));

    const [settings, service, staffId] = await Promise.all([
      loadSettings(db),
      loadActiveService(db, query.service_id),
      loadDefaultStaffId(db),
    ]);

    const slots = await freeSlots(db, settings, service, staffId, query.date, new Date());

    return { date: query.date, timezone: settings.timezone, slots };
  },
);

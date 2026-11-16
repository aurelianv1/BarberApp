import { loadSettings } from '../_shared/availability.ts';
import { serve } from '../_shared/http.ts';

// GET /get-services -> active services plus the public shop details.
serve(
  { method: 'GET', rateLimit: { name: 'read', max: 120, windowSeconds: 60 } },
  async ({ db }) => {
    const [settings, services] = await Promise.all([
      loadSettings(db),
      db
        .from('services')
        .select('id, name, duration_min, price_ron')
        .eq('active', true)
        .order('sort_order')
        .order('name'),
    ]);
    if (services.error) throw services.error;

    return {
      shop: {
        name: settings.shop_name,
        address: settings.address,
        phone: settings.phone,
        timezone: settings.timezone,
        max_advance_days: settings.max_advance_days,
        min_notice_min: settings.min_notice_min,
        cancel_deadline_min: settings.cancel_deadline_min,
      },
      services: services.data,
    };
  },
);

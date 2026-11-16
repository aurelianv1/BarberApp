/**
 * Business rules shared with the Edge Functions. The server stays the authority; the client
 * uses the same code only to give immediate feedback.
 */
export {
  NAME_MAX_LENGTH,
  normalizeCustomerName,
  normalizeRoPhone,
} from '../../supabase/functions/_shared/booking-rules';
export { localDateOf } from '../../supabase/functions/_shared/slots';

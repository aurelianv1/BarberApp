import { z, type SupabaseClient } from './deps.ts';
import { adminClient } from './db.ts';

/**
 * Error codes are the API contract: the client maps them to Romanian texts.
 * `message` is English and meant for developers only.
 */
export type ErrorCode =
  | 'method_not_allowed'
  | 'invalid_input'
  | 'rate_limited'
  | 'not_found'
  | 'service_unavailable'
  | 'slot_taken'
  | 'too_many_bookings'
  | 'not_cancellable'
  | 'cancel_too_late'
  | 'internal_error';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const CORS_BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  Vary: 'Origin',
};

/**
 * CORS headers for a request. With the ALLOWED_ORIGINS secret set (comma-separated, e.g.
 * "https://example.ro,https://www.example.ro") only those sites may call the API from a
 * browser. Without it (local development) every origin is allowed.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowed.length === 0) return { ...CORS_BASE, 'Access-Control-Allow-Origin': '*' };

  const origin = req.headers.get('origin') ?? '';
  return {
    ...CORS_BASE,
    // A site that is not on the list gets the first allowed origin back, which its browser
    // will refuse.
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0]!,
  };
}

export function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      // Availability and booking data must never be cached.
      'Cache-Control': 'no-store',
    },
  });
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return (
    req.headers.get('cf-connecting-ip') ??
    forwarded?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export interface RateLimit {
  /** Bucket name; requests are counted per bucket and client IP. */
  name: string;
  max: number;
  windowSeconds: number;
}

export async function enforceRateLimit(
  db: SupabaseClient,
  req: Request,
  limit: RateLimit,
): Promise<void> {
  const { data, error } = await db.rpc('check_rate_limit', {
    p_key: `${limit.name}:${clientIp(req)}`,
    p_max: limit.max,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) throw error;
  if (data !== true) {
    throw new ApiError(429, 'rate_limited', 'Too many requests, try again later');
  }
}

/** Validates `value` against a Zod schema, turning failures into a 400. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_input',
      'Invalid input',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, 'invalid_input', 'Request body must be JSON');
  }
}

interface HandlerOptions {
  method: 'GET' | 'POST';
  rateLimit: RateLimit;
}

type Handler = (ctx: { req: Request; url: URL; db: SupabaseClient }) => Promise<unknown>;

/** Wraps a function with CORS, method check, rate limiting and uniform error responses. */
export function serve(options: HandlerOptions, handler: Handler): void {
  Deno.serve(async (req) => {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method !== options.method) {
        throw new ApiError(405, 'method_not_allowed', `Use ${options.method}`);
      }
      const db = adminClient();
      await enforceRateLimit(db, req, options.rateLimit);
      return json(await handler({ req, url: new URL(req.url), db }), 200, cors);
    } catch (error) {
      if (error instanceof ApiError) {
        return json(
          { error: { code: error.code, message: error.message, details: error.details } },
          error.status,
          cors,
        );
      }
      console.error('Unhandled error', error);
      return json({ error: { code: 'internal_error', message: 'Internal error' } }, 500, cors);
    }
  });
}

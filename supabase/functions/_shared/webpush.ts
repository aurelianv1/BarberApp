/**
 * Web Push sender: message encryption (RFC 8291, aes128gcm) and VAPID authentication
 * (RFC 8292), built on the standard Web Crypto API only. No Deno, Supabase or npm
 * dependencies, so the same code runs in Edge Functions and under Vitest.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** Client public key, base64url (65 bytes, uncompressed P-256 point). */
  p256dh: string;
  /** Client auth secret, base64url (16 bytes). */
  auth: string;
}

export interface VapidConfig {
  /** base64url, 65 bytes. */
  publicKey: string;
  /** base64url, 32 bytes. */
  privateKey: string;
  /** "mailto:..." or an https URL identifying the sender. */
  subject: string;
}

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export type PushResult =
  | { ok: true; status: number }
  /** `gone` means the subscription no longer exists and should be deleted. */
  | { ok: false; status: number; gone: boolean; error: string };

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
/** Largest plaintext that fits one record: size - 16 (GCM tag) - 1 (padding delimiter). */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 86 - 16 - 1;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Encrypts `payload` for one subscription. Returns the full aes128gcm request body. */
export async function encryptPayload(
  payload: Uint8Array,
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error('Push payload too large');

  const clientPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error('Invalid p256dh key');
  if (authSecret.length !== 16) throw new Error('Invalid auth secret');

  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // A fresh key pair per message, as the RFC requires.
  const serverKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256),
  );

  const keyInfo = concat(encoder.encode('WebPush: info\0'), clientPublic, serverPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentKey as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  );
  // 0x02 marks the last (here: only) record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      aesKey,
      concat(payload, new Uint8Array([2])) as BufferSource,
    ),
  );

  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, ciphertext);
}

/** Signed VAPID token (JWT, ES256) for the push service that owns `endpoint`. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidConfig,
  now: Date,
): Promise<string> {
  const publicKey = base64UrlDecode(vapid.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('Invalid VAPID public key');

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: base64UrlEncode(publicKey.slice(1, 33)),
      y: base64UrlEncode(publicKey.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const segment = (value: object) => base64UrlEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(unsigned) as BufferSource,
    ),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

export async function buildPushRequest(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidConfig,
  options: { ttlSeconds?: number; now?: Date } = {},
): Promise<PushRequest> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), subscription);
  return {
    endpoint: subscription.endpoint,
    headers: {
      Authorization: await vapidAuthorization(
        subscription.endpoint,
        vapid,
        options.now ?? new Date(),
      ),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttlSeconds ?? 12 * 60 * 60),
      Urgency: 'normal',
    },
    body,
  };
}

export async function sendPush(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidConfig,
  options: { ttlSeconds?: number; timeoutMs?: number } = {},
): Promise<PushResult> {
  try {
    const request = await buildPushRequest(subscription, payload, vapid, options);
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body as BodyInit,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
    if (response.ok) return { ok: true, status: response.status };
    return {
      ok: false,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
      error: (await response.text()).slice(0, 200),
    };
  } catch (error) {
    return { ok: false, status: 0, gone: false, error: String(error) };
  }
}

/**
 * Push endpoints come from the browser, so the server would otherwise POST to any URL a
 * visitor supplies. Only the real push services are accepted.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
  '.notify.windows.com',
];

export function isAllowedPushEndpoint(endpoint: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (extraHosts.includes(url.host)) return true; // test endpoints only, set via env
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  return PUSH_SERVICE_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

/** New VAPID key pair, both base64url. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return { publicKey: base64UrlEncode(publicKey), privateKey: jwk.d as string };
}

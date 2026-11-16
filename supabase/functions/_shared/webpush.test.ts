import crypto from 'node:crypto';

// Independent implementation of RFC 8188/8291, used here only to decrypt what we produce.
// @ts-expect-error the package ships no types
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  buildPushRequest,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  MAX_PAYLOAD_BYTES,
  vapidAuthorization,
} from './webpush.ts';

/** A browser-side subscription: key pair plus auth secret. */
function fakeSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    keys: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
}

const decrypt = (body: Uint8Array, sub: ReturnType<typeof fakeSubscription>): string =>
  ece
    .decrypt(Buffer.from(body), {
      version: 'aes128gcm',
      privateKey: sub.ecdh,
      authSecret: sub.keys.auth,
    })
    .toString('utf8');

describe('encryptPayload', () => {
  it('produces a message the subscriber can decrypt', async () => {
    const sub = fakeSubscription();
    const message = JSON.stringify({
      title: 'Programare confirmată',
      body: 'marți, ora 09:45 șțăîâ',
    });
    const body = await encryptPayload(new TextEncoder().encode(message), sub.keys);

    expect(decrypt(body, sub)).toBe(message);
  });

  it('writes the aes128gcm header: salt, record size, sender key', async () => {
    const sub = fakeSubscription();
    const body = await encryptPayload(new TextEncoder().encode('x'), sub.keys);
    const view = new DataView(body.buffer, body.byteOffset);

    expect(view.getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4); // uncompressed point
    expect(body.length).toBe(86 + 1 + 1 + 16); // header + byte + delimiter + GCM tag
  });

  it('uses a fresh salt and sender key for every message', async () => {
    const sub = fakeSubscription();
    const payload = new TextEncoder().encode('same');
    const [a, b] = await Promise.all([
      encryptPayload(payload, sub.keys),
      encryptPayload(payload, sub.keys),
    ]);
    expect(Buffer.from(a.slice(0, 16))).not.toEqual(Buffer.from(b.slice(0, 16)));
    expect(Buffer.from(a.slice(21, 86))).not.toEqual(Buffer.from(b.slice(21, 86)));
  });

  it('cannot be decrypted with another subscription', async () => {
    const sub = fakeSubscription();
    const other = fakeSubscription();
    const body = await encryptPayload(new TextEncoder().encode('secret'), sub.keys);
    expect(() => decrypt(body, other)).toThrow();
  });

  it('rejects malformed keys and oversized payloads', async () => {
    const sub = fakeSubscription();
    const data = new TextEncoder().encode('x');
    await expect(encryptPayload(data, { ...sub.keys, p256dh: 'AAAA' })).rejects.toThrow();
    await expect(encryptPayload(data, { ...sub.keys, auth: 'AAAA' })).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array(MAX_PAYLOAD_BYTES + 1), sub.keys)).rejects.toThrow();
    await expect(
      encryptPayload(new Uint8Array(MAX_PAYLOAD_BYTES), sub.keys),
    ).resolves.toBeDefined();
  });
});

describe('VAPID', () => {
  it('signs a JWT that verifies against the public key', async () => {
    const vapid = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' };
    const now = new Date('2027-01-13T10:00:00Z');
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now);

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(vapid.publicKey);
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now.getTime() / 1000) + 43200,
      sub: 'mailto:test@example.com',
    });

    const publicKey = base64UrlDecode(vapid.publicKey);
    const key = crypto.createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: base64UrlEncode(publicKey.slice(1, 33)),
        y: base64UrlEncode(publicKey.slice(33)),
      },
    });
    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    );
    expect(verified).toBe(true);
  });

  it('generates keys in the standard web-push format', async () => {
    const keys = await generateVapidKeys();
    expect(base64UrlDecode(keys.publicKey)).toHaveLength(65);
    expect(base64UrlDecode(keys.privateKey)).toHaveLength(32);
  });
});

describe('buildPushRequest', () => {
  it('sets the headers push services require', async () => {
    const sub = fakeSubscription();
    const vapid = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' };
    const request = await buildPushRequest(sub.keys, { title: 'Salut' }, vapid, { ttlSeconds: 60 });

    expect(request.endpoint).toBe(sub.keys.endpoint);
    expect(request.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '60',
    });
    expect(request.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(decrypt(request.body, sub))).toEqual({ title: 'Salut' });
  });
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://127.0.0.1/admin',
    'https://169.254.169.254/latest/meta-data',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pass@fcm.googleapis.com/x',
    'not a url',
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('accepts an extra host only when explicitly configured', () => {
    expect(isAllowedPushEndpoint('http://localhost:9999/push')).toBe(false);
    expect(isAllowedPushEndpoint('http://localhost:9999/push', ['localhost:9999'])).toBe(true);
  });
});

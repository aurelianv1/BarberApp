/** Browser side of web push: permission, service worker and subscription. */

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushSupport =
  /** Can ask for permission and subscribe. */
  | 'available'
  /** The visitor already refused; only they can undo it in browser settings. */
  | 'blocked'
  /** iPhone/iPad in Safari: push works only after "Add to Home Screen". */
  | 'needs-install'
  | 'unsupported';

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac with a touch screen.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const capable =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!capable) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return 'available';
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js');
}

/** The existing subscription of this browser, if it has one. Never prompts. */
export async function currentSubscription(): Promise<BrowserSubscription | null> {
  if (pushSupport() !== 'available' || Notification.permission !== 'granted') return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? toPlain(subscription) : null;
}

/**
 * Asks for permission (must be called from a tap) and subscribes.
 * Returns null when the visitor declines.
 */
export async function subscribeToPush(): Promise<BrowserSubscription | null> {
  if ((await Notification.requestPermission()) !== 'granted') return null;
  await registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
    }));
  return toPlain(subscription);
}

function toPlain(subscription: PushSubscription): BrowserSubscription | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

// Prints a new VAPID key pair for web push. Run with: npm run vapid:generate
import { generateVapidKeys } from '../supabase/functions/_shared/webpush.ts';

const keys = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nThe public key also goes in the client as EXPO_PUBLIC_VAPID_PUBLIC_KEY.');

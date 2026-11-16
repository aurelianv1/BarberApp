// Creates (or promotes) the admin account. Public sign-up is disabled, so this is the only
// way to get an admin. Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin:create -- email@example.com 'password'
// The service_role key is read from the environment and never stored.
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password || !url || !key) {
  console.error(
    'Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin:create -- <email> <password>',
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let userId;
const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  // Already registered: look the user up and just make sure they are an admin.
  const list = await db.auth.admin.listUsers({ perPage: 1000 });
  userId = list.data?.users.find((user) => user.email === email)?.id;
  if (!userId) {
    console.error(`Could not create the user: ${created.error.message}`);
    process.exit(1);
  }
  console.log('User already exists; password left unchanged.');
} else {
  userId = created.data.user.id;
}

const { error } = await db.from('admins').upsert({ user_id: userId });
if (error) {
  console.error(`Could not grant admin rights: ${error.message}`);
  process.exit(1);
}
console.log(`Admin ready: ${email}`);

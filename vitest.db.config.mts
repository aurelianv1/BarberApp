import { defineConfig } from 'vitest/config';

// Database tests: need the local Supabase Postgres running (`npx supabase db start`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    fileParallelism: false,
  },
});

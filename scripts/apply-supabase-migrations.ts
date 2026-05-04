// ============================================================
// scripts/apply-supabase-migrations.ts
//
// Applies every .sql file in supabase/migrations to the database
// pointed to by SUPABASE_DB_URL. Idempotent — uses CREATE IF NOT
// EXISTS / OR REPLACE in the migration files.
//
// Run:  npx tsx scripts/apply-supabase-migrations.ts
// ============================================================

import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL not set');

  const client = new Client({
    connectionString: url,
    // Supabase requires TLS but their hostnames are sometimes routed
    // through a proxy whose cert isn't in Node's default bundle —
    // skip strict cert verification for this one-shot DDL run.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('[migrate] connected');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] applying ${file} (${sql.length} chars)`);
    try {
      await client.query(sql);
      console.log(`[migrate] ✓ ${file}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[migrate] ✗ ${file}: ${msg}`);
      // Carry on — other migrations may still succeed, and re-runs
      // will re-encounter the same error on already-applied DDL
      // (e.g. "type already exists"), which is expected.
    }
  }

  await client.end();
  console.log('[migrate] done');
})().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[migrate] FAILED:', msg);
  process.exit(1);
});

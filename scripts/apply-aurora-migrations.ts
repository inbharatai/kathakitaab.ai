// ============================================================
// scripts/apply-aurora-migrations.ts
//
// Applies every .sql file in db/aurora/migrations to the Aurora
// PostgreSQL instance pointed to by DATABASE_URL. Idempotent — the
// migration files use CREATE TABLE IF NOT EXISTS etc.
//
// Run:  npm run migrate:aurora   (or)   npx tsx scripts/apply-aurora-migrations.ts
//
// One-shot DDL runner: like the Supabase migration runner it uses a
// loose TLS check because the host may be freshly provisioned and
// routed through a proxy whose cert isn't in Node's bundle yet. The
// runtime pool (lib/db/aurora.ts) keeps strict cert verification on.
// ============================================================

import './_loadEnv';
import { Client } from 'pg';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'aurora', 'migrations');
const CA_BUNDLE = join(process.cwd(), 'db', 'aurora', 'rds-ca-bundle.pem');

// pg v8 maps sslmode=require → verify-full and overrides the ssl
// object, so strip any sslmode= query param from the URL and let the
// explicit ssl option below drive TLS with the RDS CA bundle.
function stripSslMode(url: string): string {
  return url.replace(/[?&]sslmode=[^&]+/i, '').replace(/[?&]$/, '');
}

(async () => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL not set — cannot run Aurora migrations');

  const ssl = existsSync(CA_BUNDLE)
    ? { rejectUnauthorized: true, ca: readFileSync(CA_BUNDLE, 'utf8') }
    : { rejectUnauthorized: false };

  const client = new Client({
    connectionString: stripSslMode(rawUrl),
    ssl,
  });

  await client.connect();
  console.log('[aurora-migrate] connected');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[aurora-migrate] applying ${file} (${sql.length} chars)`);
    try {
      await client.query(sql);
      console.log(`[aurora-migrate] ✓ ${file}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[aurora-migrate] ✗ ${file}: ${msg}`);
    }
  }

  await client.end();
  console.log('[aurora-migrate] done');
})().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[aurora-migrate] FAILED:', msg);
  process.exit(1);
});
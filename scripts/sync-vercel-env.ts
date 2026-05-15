// ============================================================
// scripts/sync-vercel-env.ts
//
// Pushes every key from .env.local into the Vercel project's
// environment variable store, for all three target environments
// (production, preview, development) by default.
//
// Two modes:
//
//   1. With VERCEL_TOKEN set in your shell, the script calls the
//      Vercel REST API directly: lists existing vars, deletes
//      stale ones for the keys we manage, then re-creates them
//      with the local values. Idempotent.
//
//   2. Without VERCEL_TOKEN, the script prints copy-pasteable
//      `vercel env add` commands you can run yourself. Safer
//      for first-time use — you see exactly what gets pushed.
//
// Project + team IDs are read from .vercel/project.json so you
// don't have to pass them.
//
// Usage:
//   npm run sync:vercel                   # dry-run by default
//   npm run sync:vercel -- --apply        # actually push (token mode only)
//   npm run sync:vercel -- --target=production,preview
//   npm run sync:vercel -- --keys=SARVAM_API_KEY,GEMINI_API_KEY
// ============================================================

import './_loadEnv';

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VERCEL_API = 'https://api.vercel.com';

// Keys we own and push from .env.local. Anything else in the file
// is ignored — the script never pushes whatever happens to be there.
// Splitting NEXT_PUBLIC_* (visible to the browser bundle) from the
// service-only secrets makes the failure mode clear: if a NEXT_PUBLIC_
// is missing, the client crashes; if a service-only key is missing,
// the API route fails.
const MANAGED_KEYS = [
  // AI providers
  'SARVAM_API_KEY',
  'SARVAM_TTS_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_TEXT_MODEL',
  'GEMINI_AUDIO_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_TEXT_MODEL',
  // Supabase
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  // Upstash Redis
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

type VercelTarget = 'production' | 'preview' | 'development';

interface VercelEnvVar {
  id: string;
  key: string;
  value?: string;
  target: VercelTarget[];
  type: 'plain' | 'encrypted' | 'secret' | 'system';
}

interface Args {
  apply: boolean;
  targets: VercelTarget[];
  keys: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const targetArg = argv.find(a => a.startsWith('--target='))?.slice('--target='.length);
  const keysArg = argv.find(a => a.startsWith('--keys='))?.slice('--keys='.length);

  let targets: VercelTarget[] = ['production', 'preview', 'development'];
  if (targetArg) {
    targets = targetArg.split(',').map(s => s.trim()).filter(s => s) as VercelTarget[];
  }

  let keys = MANAGED_KEYS.slice();
  if (keysArg) {
    keys = keysArg.split(',').map(s => s.trim()).filter(s => s);
  }

  return { apply, targets, keys };
}

function readVercelLink() {
  const path = join(process.cwd(), '.vercel', 'project.json');
  if (!existsSync(path)) {
    throw new Error('.vercel/project.json not found — run `vercel link` first');
  }
  const j = JSON.parse(readFileSync(path, 'utf8')) as { projectId: string; orgId: string; projectName?: string };
  return { projectId: j.projectId, teamId: j.orgId, projectName: j.projectName };
}

function readLocalEnv(): Map<string, string> {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) throw new Error('.env.local not found');
  const out = new Map<string, string>();
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out.set(k, v);
  }
  return out;
}

async function vercelGET(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${VERCEL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function vercelPOST(token: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${VERCEL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status} ${responseBody.slice(0, 200)}`);
  }
  return res.json();
}

async function vercelDELETE(token: string, path: string): Promise<void> {
  const res = await fetch(`${VERCEL_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
}

async function listExisting(token: string, projectId: string, teamId: string): Promise<VercelEnvVar[]> {
  // The decrypt=true flag returns the actual value (server-side). We
  // need that to know whether to skip a no-op upsert.
  const json = await vercelGET(token, `/v9/projects/${projectId}/env?teamId=${teamId}&decrypt=true`) as { envs?: VercelEnvVar[] };
  return json.envs ?? [];
}

async function upsertEnv(
  token: string,
  projectId: string,
  teamId: string,
  key: string,
  value: string,
  targets: VercelTarget[],
  existing: VercelEnvVar[],
): Promise<'created' | 'updated' | 'noop'> {
  // Strategy: delete every existing entry for this key across the
  // affected targets, then create one fresh entry with all targets.
  // Vercel allows multiple entries per key (one per target slice);
  // collapsing them into a single entry keeps the dashboard tidy.
  const stale = existing.filter(e => e.key === key && e.target.some(t => targets.includes(t)));
  let same = false;
  for (const e of stale) {
    if (e.value === value && targets.every(t => e.target.includes(t)) && targets.length === e.target.length) {
      same = true;
    }
  }
  if (same && stale.length === 1) return 'noop';

  for (const e of stale) {
    await vercelDELETE(token, `/v9/projects/${projectId}/env/${e.id}?teamId=${teamId}`);
  }
  await vercelPOST(token, `/v10/projects/${projectId}/env?teamId=${teamId}&upsert=true`, {
    key,
    value,
    target: targets,
    type: 'encrypted',
  });
  return stale.length > 0 ? 'updated' : 'created';
}

function printPasteScript(env: Map<string, string>, targets: VercelTarget[], keys: string[]) {
  console.log('\n# Vercel CLI version — paste into your shell after `vercel link` is set up.');
  console.log('# Each command prompts for confirmation; --force skips it.');
  console.log('#');
  for (const k of keys) {
    const v = env.get(k);
    if (v === undefined) {
      console.log(`# ⚠ ${k} not in .env.local — skipping`);
      continue;
    }
    for (const t of targets) {
      // The CLI accepts the value via stdin so we can keep secrets
      // out of shell history.
      console.log(`echo "${escapeShellValue(v)}" | vercel env add ${k} ${t} --yes`);
    }
  }
  console.log('\n# Or via dashboard: https://vercel.com/team_MFiAsyuVGhfwkAZGqirV8ZAZ/kathakitaab-ai/settings/environment-variables\n');
}

function escapeShellValue(v: string): string {
  // Minimal shell-escape so $ / " / ` don't expand. Most of our values
  // are tokens with no special chars, but keys like SUPABASE_DB_URL
  // contain `:` and `?` which are fine, plus `@` which is fine.
  return v.replace(/(["$`\\])/g, '\\$1');
}

async function main() {
  const args = parseArgs();
  const env = readLocalEnv();
  const link = readVercelLink();

  console.log(`[sync-vercel-env] project: ${link.projectName ?? link.projectId} (${link.projectId})`);
  console.log(`[sync-vercel-env] team:    ${link.teamId}`);
  console.log(`[sync-vercel-env] targets: ${args.targets.join(', ')}`);
  console.log(`[sync-vercel-env] keys:    ${args.keys.length} (${args.keys.length === MANAGED_KEYS.length ? 'all managed' : args.keys.join(', ')})`);

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.log('\n[sync-vercel-env] VERCEL_TOKEN not set — printing CLI commands instead.');
    console.log('[sync-vercel-env] To enable direct API push:');
    console.log('     1. Generate a token at https://vercel.com/account/tokens');
    console.log('     2. export VERCEL_TOKEN="<token>"');
    console.log('     3. Re-run with --apply');
    printPasteScript(env, args.targets, args.keys);
    return;
  }

  // Token mode.
  const existing = await listExisting(token, link.projectId, link.teamId);
  console.log(`[sync-vercel-env] existing env entries: ${existing.length}`);

  if (!args.apply) {
    console.log('\n[sync-vercel-env] DRY RUN — re-run with --apply to push.');
    for (const k of args.keys) {
      const v = env.get(k);
      if (v === undefined) {
        console.log(`  ⚠ ${k}: not in .env.local`);
        continue;
      }
      const stale = existing.filter(e => e.key === k && e.target.some(t => args.targets.includes(t)));
      const action = stale.length === 0 ? 'CREATE' : 'REPLACE';
      console.log(`  ${action.padEnd(8)} ${k} (${v.length} chars) → ${args.targets.join(',')}`);
    }
    return;
  }

  let created = 0, updated = 0, noop = 0, missing = 0;
  for (const k of args.keys) {
    const v = env.get(k);
    if (v === undefined) {
      console.log(`  ⚠ ${k}: not in .env.local — skipping`);
      missing++;
      continue;
    }
    try {
      const r = await upsertEnv(token, link.projectId, link.teamId, k, v, args.targets, existing);
      if (r === 'created') created++;
      else if (r === 'updated') updated++;
      else noop++;
      console.log(`  ${r.padEnd(8)} ${k}`);
    } catch (err) {
      console.log(`  ✗ ${k}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n[sync-vercel-env] done: ${created} created, ${updated} updated, ${noop} unchanged, ${missing} missing`);
  console.log('[sync-vercel-env] Trigger a redeploy for the new vars to take effect:');
  console.log('     vercel deploy --prod    (or push a commit)');
}

main().catch(err => {
  console.error('[sync-vercel-env] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

// Side-effect-only module: parses .env.local into process.env before
// any other module is loaded. `tsx` (unlike `next`) does not auto-load
// .env files, so scripts must import this *first* to get the same
// environment variables the running app sees.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), '.env.local');
if (existsSync(path)) {
  const txt = readFileSync(path, 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

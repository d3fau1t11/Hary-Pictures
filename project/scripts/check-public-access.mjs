// Read-only probes. Never fetch contact contents, change records, or print keys.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const base = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Supabase public configuration is required.');
const headers = { apikey: key, Authorization: `Bearer ${key}` };
for (const table of ['contact_messages', 'categories', 'pictures', 'profile_settings']) {
  try {
    const response = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, { headers, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    console.log(JSON.stringify({ table, status: response.status, anonymousRowVisible: Array.isArray(body) ? body.length > 0 : null }));
  } catch {
    console.error(`Probe unavailable: ${table}`);
    process.exitCode = 1;
  }
}
try {
  const response = await fetch(`${base}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(15000) });
  const settings = await response.json();
  console.log(JSON.stringify({ authStatus: response.status, signupDisabled: settings.disable_signup ?? null }));
} catch {
  console.error('Auth settings probe unavailable');
  process.exitCode = 1;
}

// Pattern scan only; intentionally emits locations/rule names, never matched values.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
const root = git('rev-parse', '--show-toplevel').trim();
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['telegram-token', /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['supabase-secret', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
];
function scan(text) {
  const hits = rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') hits.push('supabase-service-role'); } catch {}
  }
  return [...new Set(hits)];
}
let checked = 0;
const findings = [];
if (process.argv.includes('--history')) {
  const objects = git('rev-list', '--objects', '--all').trim().split('\n');
  for (const line of objects) {
    const split = line.indexOf(' ');
    if (split < 0) continue;
    const hash = line.slice(0, split), name = line.slice(split + 1);
    if (!/\.(?:[cm]?[jt]sx?|json|md|html|toml|ya?ml|sql|txt|env|example)$|(?:^|\/)\.env(?:\.|$)/i.test(name)) continue;
    if (Number(git('cat-file', '-s', hash)) > 2_000_000) continue;
    const hits = scan(git('cat-file', '-p', hash));
    checked++;
    if (hits.length) findings.push({ object: hash.slice(0, 12), path: name, rules: hits });
  }
} else {
  const files = git('-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  for (const name of new Set(files)) {
    const file = path.join(root, name);
    if (statSync(file).size > 2_000_000) continue;
    const content = readFileSync(file);
    if (content.includes(0)) continue;
    checked++;
    const hits = scan(content.toString('utf8'));
    if (hits.length) findings.push({ path: name, rules: hits });
  }
}
console.log(JSON.stringify({ checked, findings }, null, 2));
if (findings.length) process.exitCode = 1;

# Security review — 2026-11-06

## Changes

- Updated application and build dependencies, including Vite, React Router,
  Puppeteer and Netlify Functions. Node 24 is required locally and on Netlify.
- Pinned a patched minimatch range for typescript-eslint's parser through a
  scoped npm override. Remove the override when its upstream range includes
  minimatch 11.0.1 or later; rerun the lint checks when changing it.
- Replaced the Telegram function with a typed Web Request handler. It accepts
  bounded JSON requests from exact trusted origins, uses an eight-second
  upstream timeout, sends plain text, and returns no recipient IDs, tokens or
  upstream error details. Requests without Origin are rejected.
- Configured Netlify's edge rate limit for the existing notification path:
  five requests per 180 seconds per IP/domain. CORS is not authentication;
  server clients can spoof Origin. The endpoint remains a public notification
  endpoint and the rate limit is abuse mitigation, not proof of a saved inquiry.
- Removed Telegram variables from Netlify's secret-scanning exemptions.
- Centralized response headers in `public/_headers`. All routes receive CSP
  and framing protection; admin routes receive no-store/noindex. Only hashed
  build assets are immutable. Scripts cannot use eval or arbitrary inline code.
  JSON-LD uses an explicit SHA-256 hash; update it if the inline JSON changes.
  Inline styles and HTTPS images/videos remain allowed for the current UI.
- Removed contact form payload logging and raw database errors in user messages.
- Bound the build-only prerender server to loopback and constrained file paths.

## Verification

Run from `project/` using Node 24:

```sh
npm ci
npm audit
npm run check:security
npm run check:admin
node tests/scan-secrets.mjs --history
npm run build
```

For browser tests, run Vite on 127.0.0.1:5173, then `npm run test:admin`.
Set `BROWSER_EXECUTABLE` for an installed Chrome/Edge if autodetection fails.
For prerendering, set `PUPPETEER_EXECUTABLE_PATH` or install Puppeteer's Chrome.
The browser suite intercepts external traffic and uses fake authentication and
in-memory records. The security suite mocks Telegram; it sends no messages.
`test-telegram-function.js` is a manual integration script that sends real messages.

The dependency audit after updates reports zero known vulnerabilities. The
pattern scanner found no matching secrets in current publishable text files or
172 eligible historical Git blobs across 65 commits. This is a bounded pattern
scan, not a guarantee that every secret format or historical artifact is safe.
The local Vite Supabase key was classified as an anonymous client key, not a
service-role key. Local environment files remain ignored.

## Backend checks still required

The read-only public API probes returned no contact-message rows to the anonymous
client. Public pictures and categories were readable, as intended. An empty
result can also mean an empty table, so it does not establish the RLS policy.
Supabase's public auth settings reported **public signup enabled**.

1. Disable public signup for this team-only admin application. Review existing
   Auth users; registration alone must never grant administrative permissions.
2. Run `security/supabase-review.sql` in the Supabase SQL editor. Verify RLS on
   every exposed table and `storage.objects`. Portfolio reads may be public;
   writes must require specific approved admin IDs or a server-controlled role.
   A policy granting writes to every `authenticated` user is insufficient.
   Do not trust user-editable `user_metadata` for authorization.
3. Contact messages must deny anonymous reads, updates and deletes. The current
   form inserts directly using the anonymous key, so it needs an insert-only
   policy with database constraints. Its client-side limiter, honeypot and
   stored random token are not server-enforced rate limiting or CSRF protection.
   Move submission behind a server endpoint with durable abuse controls if
   stronger spam protection is needed; the Telegram limit does not protect
   direct database inserts.
4. Restrict bucket writes to approved admins, with MIME allowlists and file-size
   limits. Client validation is only a usability check.
5. Confirm password recovery redirect allowlists, Auth rate limits and MFA for
   administrators. Never place a service-role key or Telegram token in VITE_*.

Live database policies, storage policies and privileged Auth configuration were
not available to this review. No live data or settings were modified.
The legacy SQL setup files are incomplete examples, not verified production
migrations; do not use them as an authorization policy.

## Deployment verification

Set server-only `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_IDS` in Netlify. Set
`ALLOWED_ORIGINS` only when needed, as comma-separated full HTTPS origins.
`URL` and `DEPLOY_PRIME_URL` are also trusted exactly. Localhost is accepted only
when `NETLIFY_DEV=true`.

After deployment, check admin response headers and confirm the rate-limit rule
appears in Netlify's deploy log. Netlify validates rules after building; a bad
rule does not necessarily fail the deploy, and enforcement can be delayed.
See [Netlify rate limiting documentation](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
This repository review does not certify a successful deployment or live rate-limit
enforcement. Rotate any credentials previously exposed outside this checkout.

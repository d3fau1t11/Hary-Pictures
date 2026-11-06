# Live video uploads with Mux Free

Uploads work from the live admin in a phone browser. Mux processes videos online,
creates covers and delivers adaptive video quality. No desktop preparation is
required. Photos continue to use Supabase, as do your categories and media records.

Mux's Free plan currently includes 10 stored videos and 100,000 delivery minutes
per month, without a credit card. Its free player displays a Mux badge. The
integration uses Mux Player and preserves that badge. Check the current
[pricing](https://www.mux.com/pricing) and [free-plan details](https://www.mux.com/blog/free-plan)
before creating the account; keep the account on Free if you do not want paid usage.

## One-time setup

1. Create a [Mux account](https://dashboard.mux.com/signup) and choose **Free**.
2. Open **Settings → Access Tokens → Generate new token** in Mux. Select the
   **Production** environment, enable **Mux Video Read and Write**, and name it
   `Hary Pictures`. Copy the Token ID and Token Secret into Netlify in step 4.
   Do not send the secret in chat or put it in frontend code.
3. In your Supabase dashboard, open **Authentication → Users**, select the admin
   account you use to sign in, and copy its **User UID**. This is the UUID, not
   the email address or an API key.
4. In Netlify, open the Hary Pictures project, then **Project configuration →
   Environment variables**. Add these variables for **Production**:

   | Variable | Value | Scope if Netlify offers scope selection |
   | --- | --- | --- |
   | `MUX_TOKEN_ID` | Mux Token ID | Functions |
   | `MUX_TOKEN_SECRET` | Mux Token Secret; mark as secret | Functions |
   | `MUX_ADMIN_USER_IDS` | Supabase admin User UID; comma-separated for multiple approved admins | Functions |
   | `VITE_MUX_ENABLED` | `true` | Builds |

   Your existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be available
   to both **Builds and Functions**. They remain public client configuration;
   no Supabase service-role key is needed. If your plan only offers all scopes,
   use that; only variables beginning with `VITE_` enter the browser bundle.
5. Deploy the code containing this integration. If it is already on the connected
   GitHub branch, use **Deploys → Trigger deploy → Deploy project**. Environment
   changes need a new deploy. Keep Mux secrets out of untrusted deploy previews.
6. Sign in on the live `/admin`. **Processing videos** should appear in Library.
   Upload one short video to verify the connection before filling your 10 slots.

The explicit admin UUID list is required because the site's Supabase Auth allows
public signup. A registered account alone must not gain permission to create or
delete Mux assets. Continue to enforce database/storage RLS as described in
`SECURITY_REVIEW.md`.

## Uploading from a phone

1. Use **Upload media**, select your video and category, then upload.
2. Keep the page open while the file transfers. Uploads use chunks and retry
   temporary network failures. Closing the browser during transfer can interrupt it.
3. When it says the upload finished, Mux processes it online. You can close the
   upload window while Mux works.
4. Open **Processing videos → Publish ready videos**. Ready videos are
   added to the portfolio with automatic covers and adaptive playback. If still
   processing, check again shortly.

Pending references are kept in this browser, scoped to your signed-in user. Use
the same browser to finish publishing and avoid clearing its site data first.
This version uses a deliberate publish step rather than a webhook/database queue.
Closing the browser does not stop Mux encoding, but it does not automatically
publish the result to your site either.

## Existing videos

Open a Supabase video's details and choose **Optimize for streaming**. The server
asks Mux to copy the existing video directly from Supabase; your phone does not
download it. Finish with **Processing videos → Publish ready videos**.
The old video remains live until the ready playback URL is saved successfully.
The old Supabase file and its cover are then cleaned up if no other record uses them.
An in-progress replacement uses an additional Mux slot, so keep room below 10.

Before enabling Mux, native video uploads still work with automatic WebP covers
for formats the browser can decode. Existing native videos can use **Change video
cover**, or select several and choose **Generate covers**. Unsupported codecs can
use an uploaded cover image. Mux videos use Mux's generated covers.

## Recovery and limits

- If processing or a database save fails, retry the pending item. A stable record
  ID and replacement checks prevent duplicate records and overwriting newer edits.
- If a transfer expired, inspect/remove the unused upload or asset in Mux before
  dismissing the pending item and uploading again. Dismissing a pending reference
  alone does not delete the remote asset or free a slot.
- If browser storage is cleared, use the Mux dashboard to inspect orphaned assets.
- Deleting a published video removes its Mux asset only after removing its media
  record and checking that no other record references that playback URL. Cleanup
  failures are reported; remove unused assets in Mux when needed to free a slot.
- The player loads only when a visitor opens a video. Gallery tiles download
  thumbnail images. Mux adjusts quality to the connection; no implementation can
  promise uninterrupted playback on every connection.

## One-time migration of the existing library

`scripts/migrate-mux.mjs` is an operator tool for moving existing Supabase videos
without downloading them. Normal future uploads still work entirely from the
live admin on a phone. This tool is never run during a build or sent to visitors.

Credentials are read from the single ignored `project/.env` file (or process
environment variables). Keep this private file out of Git. Copy the six website
settings listed above from it into Netlify's environment settings, including both
public Supabase settings. Do not copy a temporary `SUPABASE_SERVICE_ROLE_KEY`
used for migration into Netlify. Existing unrelated Netlify variables such as
Telegram settings should be preserved. Netlify does not read your local file
automatically; its environment settings must be updated separately.

If original videos display a generic film icon, their `.poster.webp` files may
be missing. Once their Mux imports are ready, an operator can set a temporary
`SUPABASE_SERVICE_ROLE_KEY` and run `node scripts/migrate-mux.mjs --covers`.
This fills only missing original-video covers with real frames from the prepared
Mux videos. It preserves custom covers and video URLs, so the updated local
gallery can show thumbnails before the streaming migration is published.
Refresh the gallery afterward. New Mux videos use their generated Mux thumbnail
directly; they do not need this one-time backfill.

Run from `project/`:

```sh
node scripts/migrate-mux.mjs --prepare
node scripts/migrate-mux.mjs --status
```

Preparation checks the 10-video limit before creating assets, reuses previously
prepared imports, and sends shared source URLs to Mux only once. Status checks
that all four steps are complete: import, encoding, playable HLS and thumbnail
availability. Repeat `--status` while Mux is processing. State is saved in ignored
`test-results/mux-migration.json`; keep it until migration is complete.

When ready, choose either publication method:

**Deploy the latest website code before changing any portfolio URLs.** An old
deployment cannot display Mux HLS URLs. The operator `--publish` command checks
the live site's bundle for the Mux player and refuses to write when it is absent.
For SQL publication, first verify the new site is deployed in Netlify yourself.

- Run the generated `test-results/mux-migration.sql` in Supabase's SQL editor.
  It runs in a transaction and is safe to repeat. If any original record changed,
  the entire transaction stops without applying the migration.
- Set `SUPABASE_SERVICE_ROLE_KEY` in your ignored local `.env`, then run
  `node scripts/migrate-mux.mjs --publish`. This updates records individually,
  verifies the old URL before each write, and can resume after a partial failure.
  This privileged key is only for this operator step; do not add it to Netlify or
  any `VITE_` variable. Remove it locally when finished.

Finally run `node scripts/migrate-mux.mjs --verify`. Titles, categories and record
IDs are preserved. Original Supabase files are retained for this batch migration;
`test-results/mux-rollback.sql` can restore their URLs if needed, provided nobody
has subsequently replaced those records. Review storage cleanup separately after
the new site is confirmed working.

Changing Netlify environment variables requires a new deploy. Set
`VITE_MUX_ENABLED=true` for Builds; make the three `MUX_` variables available to
Functions, and the two `VITE_SUPABASE_` variables to both Builds and Functions.
Only activate the new upload workflow in the Production deploy context.

## Validation

`npm run check:admin`, `npm run check:media`, and `npm run check:security` check the
updated code. `npm run test:media` uses intercepted APIs and synthetic video;
it never uploads to a real Mux account. `npm run test:admin` exercises the existing
admin flows. A live upload/playback check is still necessary after credentials
are configured; automated tests cannot verify your provider account or quotas.
`node --test tests/mux-migration.mjs` checks migration limits, shared sources,
retry planning and guarded SQL generation without contacting either provider.
`node --test tests/video-cover-backfill.mjs` checks that cover backfilling preserves
custom covers and changed records, validates image data, and can be retried.

References: [Mux access tokens](https://www.mux.com/docs/core/stream-video-files),
[direct uploads](https://www.mux.com/docs/guides/upload-files-directly),
[Netlify function environment variables](https://docs.netlify.com/build/functions/environment-variables/).

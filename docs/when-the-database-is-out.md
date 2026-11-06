# When the database is out

Free database tiers stop when an allowance runs out (data transfer, compute hours), sometimes until the month resets.
The portal is built so that this costs you an afternoon, not your data. Everything here works with **any two free
Postgres hosts** (for example Neon and Supabase) and any S3-compatible file store.

## Keep a standby

A second free Postgres host, refreshed every night with a checked copy:

```sh
pg_dump "$PRIMARY_URL" --schema=public --schema=drizzle --no-owner --no-privileges --no-comments -f portal.sql
psql "$STANDBY_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -c "ALTER SCHEMA public RENAME TO standby_prev; ALTER SCHEMA drizzle RENAME TO drizzle_prev; CREATE SCHEMA public;" \
  -f portal.sql
```

Compare each table's row count with the dump's before you drop `standby_prev` and `drizzle_prev`. In one transaction,
a failed copy leaves yesterday's standby as it was. Keep the dump too: it is your last resort.

Two things to know about the free tiers:
- the nightly dump is itself data transfer out of the primary: check its size;
- a free project can pause after a week without use; the nightly copy keeps the standby awake.

## Fail over

1. Run the migrations against the standby (`DATABASE_URL_UNPOOLED=<standby> node scripts/migrate.mjs`); with the copied
   `drizzle` schema it reports "up to date".
2. Point the deployment's `DATABASE_URL` (the pooled address) and `DATABASE_URL_UNPOOLED` (the direct or session
   address) at the standby, and redeploy.
3. **Sign-in.** If your sign-in runs on the host that is out (Neon Auth runs on Neon), turn on the sign-in codes:
   `PEEK_OUTAGE_SIGNIN=1`. The owner's first code comes from
   `DATABASE_URL=<standby> node scripts/local-code.mjs <owner's email> --remote`; everyone else gets one from
   **Settings → People → Local sign-in code**. Codes are shown once, kept hashed, last 14 days, and five wrong tries lock
   an email for 15 minutes.
4. Better still, before you need it: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth client
   with the redirect URI `<your address>/api/google-signin/callback`). Then the portal signs people in with Google by
   itself, with its own sessions, and does not depend on any hosted auth.

Anything written to the old primary after the last copy is not on the standby.

## Lost the data? Rebuild it

If there is no usable copy, rebuild from what your agents kept (their traces, caches and logs) with
`scripts/rebuild-load.mjs`. The dataset format is in the script's header, and `examples/rebuild/` has a tiny set:

```sh
node scripts/rebuild-load.mjs --database-url "$NEW_URL" --dir examples/rebuild --stamp example --owner-email you@example.com --dry-run
```

It keeps the leads' ids, restores the agents' API keys from their key files (only hashes are stored), and a second run
changes nothing. Statuses only people set (sent, replied, the result) come back only if your dataset has them.

## Files

Each file records the store that holds it (`files.store`). When you move to a new store, set the new `AWS_*` values,
`FILES_BUCKET` and `FILES_STORE` (for example `supabase`): new uploads go there, and older files show "stored on
<old store>, copy pending" instead of a broken link. Once the old store answers, copy them:

```sh
node scripts/files-copy.mjs --from old.env --to new.env --dry-run
node scripts/files-copy.mjs --from old.env --to new.env
```

Each env file holds `DATABASE_URL`, the four `AWS_*` values and `FILES_BUCKET`. Every object is read back and compared
(size and SHA-256) before its row is written; run it again any time, copied files are skipped.

Test one upload after a store change: some S3-compatible stores do not accept a browser's presigned upload (a CORS
error). Then use the store's own signed upload links.

## Read less

Agents that read the whole board every few minutes use up a free tier's data transfer. Read with `since=<rev>` and
`fields=` (a list of cells, or `slim`), send back the `ETag` as `If-None-Match` (a 304 carries nothing), and watch each
key's day under **Settings → API keys**. Setting `PEEK_SLIM_DEFAULT=1` makes `slim` the default once your readers ask
for the long cells by name.

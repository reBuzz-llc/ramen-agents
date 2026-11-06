# The portal's database: a standby, local mode, and what to do in an outage

The team portal (the `portal` branch) keeps its data in one Postgres database. Once `common.toml` names the portal
(`[leads] portal_url`, setup-queue step 9), the agents read and write their leads there, so that database is the
family's Leads board. Free database plans have quotas, and
when one runs out the portal stops answering until the quota resets. Three tools in this folder keep that from costing
you the data or the week:

- **A nightly standby copy** to a second free database on another provider.
- **Local mode:** the portal on this Mac, against Postgres on this Mac, reached by the team through a free tunnel.
- **An "Other free tiers" table** on the dashboard that warns before a quota runs out.

All three need Homebrew's Postgres tools: `brew install postgresql@17` (local mode also needs
`brew install cloudflared`).

## The addresses

Each address is one line, the `postgres://` connection string, in a file only you can read:

```sh
printf '%s\n' 'postgresql://...' > ~/bots/common-data/keys/portal-primary.key   # the database the portal uses
printf '%s\n' 'postgresql://...' > ~/bots/common-data/keys/portal-standby.key   # a second free database elsewhere
chmod 600 ~/bots/common-data/keys/portal-*.key
```

Use the **direct** (or "session") address, not a transaction pooler: a dump needs a session. On Neon that is the
address without `-pooler` in the host; on Supabase it is the session pooler on port 5432.

## 1. The nightly standby

```sh
sh ~/bots/scripts/db-standby.sh --dry-run      # checks the tools and both addresses, connects to nothing
sh ~/bots/scripts/db-standby.sh                # one copy now
sh ~/bots/scripts/install-launchd.sh db-standby   # every night at 02:30
```

Each copy dumps the primary's tables and restores them into the standby **in one transaction**, then compares every
table's row count with the dump. If anything differs or fails, the transaction rolls back and the standby stays as it
was. The result is one line in `common-data/shared-state/db-standby.json`, including the primary's size (`db_mb`),
which the dashboard can show against your plan's limit. The newest dump is also kept at
`common-data/backups/portal-latest.sql` (git-ignored, mode 600) as a last resort.

**Failing over:** point the portal's hosting at the standby's addresses (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`),
redeploy, and swap the two key files so the nightly copy runs from the new primary. If the hosted sign-in lived with
the old database, turn on sign-in codes on the hosting (`PEEK_OUTAGE_SIGNIN=1`) and give yourself the first one with
`DATABASE_URL=<standby> node scripts/local-code.mjs <your email> --remote` in the portal's checkout. When the old
provider is back and you want to move home: `sh ~/bots/scripts/db-standby.sh --reverse --yes-overwrite-primary`.

## 2. Local mode

When neither database answers, or you would rather not wait, the portal can run on this Mac:

```sh
cd ~/Projects/portal && npm run build                      # the portal's checkout (PORTAL_DIR to change it)
sh ~/bots/scripts/portal-local-setup.sh                    # once: Postgres on 127.0.0.1, a database, the settings
sh ~/bots/scripts/db-standby.sh --to-local                 # the newest copy: the primary, else the standby, else the saved dump
sh ~/bots/scripts/install-launchd.sh portal-local portal-tunnel
cat ~/bots/common-data/shared-state/portal-local.json      # the tunnel's https address: pass it to the team
```

The portal listens on `127.0.0.1:3100` only; the tunnel exposes that port and nothing else, never the database. Local
mode signs people in with codes (Settings → People → sign-in code). The tunnel's address changes on every restart;
a free Cloudflare account and a named tunnel keep one fixed address.

`--to-local` refuses to copy fewer leads over more (an empty database copied over a full one is the classic mistake);
add `--yes-shrink` if that is really what you want.

**Leaving local mode:** stop the two jobs (`launchctl bootout gui/$(id -u)/com.ramen-agents.portal-local`, the same for
`portal-tunnel`), then copy this Mac's data back:
`sh ~/bots/scripts/db-standby.sh --from-local --yes-overwrite-primary` (or `--from-local --to-standby` to fill the
standby first).

## 3. Other free tiers on the dashboard

`scripts/free-tiers.py` runs hourly (`com.ramen-agents.free-tiers`, installed with the rest) and writes
`common-data/shared-state/free-tiers.json`; the dashboard's Allowance view shows it as **Other free tiers**, and a row
at 80 % or more joins the warnings. List your services in `common-data/configs/free-tiers.toml`, starting from
`free-tiers.example.toml` next to it: the database size from the nightly copy, a file bucket over S3, a Neon project's
monthly numbers, or a plain "not measurable, look here" row for a host with no usage API. The dashboard never holds a
key; only this job reads them.

## What is installed when

`sh scripts/install-launchd.sh` installs everything except `db-standby`, `portal-local` and `portal-tunnel`, which are
installed only when you name them: the copy needs its two keys first, and local mode is for an outage.

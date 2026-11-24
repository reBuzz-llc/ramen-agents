# A hosted portal's database: a nightly standby and what to do in an outage

By default Peek, the team's board, runs on this computer with its own local database ([peek.md](peek.md)), and nothing
on this page applies. This page is for a portal you host yourself on a Postgres database (a `DATABASE_URL` in the
portal's `.env.local`). Free database plans have quotas, and when one runs out the portal stops answering until the
quota resets. Two tools keep that from costing you the data or the week:

- **A nightly standby copy** to a second free database on another provider.
- **An "Other free tiers" table** on the dashboard that warns before a quota runs out.

The copy needs Homebrew's Postgres tools: `brew install postgresql@17`.

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
`common-data/backups/portal-latest.sql` (git-ignored, mode 600).

**Failing over:** point the portal's hosting at the standby's address (`DATABASE_URL`), restart it, and swap the two
key files so the nightly copy runs from the new primary. When the old provider is back and you want to move home:
`sh ~/bots/scripts/db-standby.sh --reverse --yes-overwrite-primary`. A copy by hand refuses to put fewer leads over more
(an empty database copied over a full one is the classic mistake); add `--yes-shrink` if that is really what you want.

**Moving to Peek on this computer instead** ends the quota worry: `sh scripts/peek.sh setup` ([peek.md](peek.md)).

## 2. Other free tiers on the dashboard

`scripts/free-tiers.py` runs hourly (`com.ramen-agents.free-tiers`, installed with the rest) and writes
`common-data/shared-state/free-tiers.json`; the dashboard's Allowance view shows it as **Other free tiers**, and a row
at 80 % or more joins the warnings. List your services in `common-data/configs/free-tiers.toml`, starting from
`free-tiers.example.toml` next to it: the database size from the nightly copy, a file bucket over S3, a Neon project's
monthly numbers, or a plain "not measurable, look here" row for a host with no usage API. The dashboard never holds a
key; only this job reads them.

## What is installed when

`sh scripts/install-launchd.sh` installs everything except `db-standby`, which is installed only when you name it: the
copy needs its two keys first.

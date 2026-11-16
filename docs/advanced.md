# Advanced

Nothing on this page is needed to run the family. Each part costs you an account somewhere, and some of it puts
things on the internet, so each one says what it takes.

## A hosted team portal instead of the local board

By default the Leads, Tasks and Packages boards live on this Mac (`common-data/local-board.sqlite3`, served by the
dashboard). If your team works from several places and you want a web app where people take leads and tasks and
record what they sent, the `portal` branch of the starter is that app. It speaks the same board API, so the agents
and the Validator work with either one.

What it takes: a Postgres database (a free Neon or Supabase project works) and somewhere to host a Next.js app. Both
are accounts of yours, made by you; no agent signs up for anything.

1. Clone the `portal` branch and follow its own `README.md` and `SETUP.md`.
2. Mint three keys in the portal's checkout (each script writes its file in `common-data/keys/`, mode 600, replacing
   the local board's key of the same name):
   - `node --env-file=.env.local scripts/api-key.mjs engine board:read board:write` (`portal-engine.key`)
   - `node --env-file=.env.local scripts/api-key.mjs validator` (`portal-validator.key`)
   - `node --env-file=.env.local scripts/api-key.mjs dashboard` (`portal-dashboard.key`, read only)
3. Point the family at it in `common-data/configs/local.toml` (git-ignored):

   ```toml
   [leads]
   portal_url = "https://your-portal.example.com"
   ```

   From then on the agents, the Validator and the dashboard read and write the boards in the portal. The dashboard's
   Boards pages say so and link there. `python3 scripts/setup-check.py --probe` tests each key.
4. Move what is already on the local board: export each board as CSV from its page and import it in the portal.
5. The database's safety net (a nightly standby copy to a second free database, local mode for an outage, and the
   dashboard's warnings before a quota runs out): [portal-database.md](portal-database.md).

To go back, remove `portal_url` from `local.toml` and restart the dashboard; the local board is where you left it.

## Tailscale Funnel (publishing to the internet)

[remote-access.md](remote-access.md) uses `tailscale serve`, which reaches only your own devices. Tailscale Funnel is
different: it publishes a port of this Mac to the whole internet, to anyone with the address.

**Never point Funnel at the dashboard (port 3000) or at the board API.** The dashboard holds the boards, your answers
and the controls that stop and start members; on the internet, anyone could read and change them. Nothing in this
starter turns Funnel on or needs it. If you publish something of your own with it, make it a separate server that
serves only what you mean to be public, and check what Tailscale's plan allows for your use (Funnel and business use
are both in Tailscale's own terms).

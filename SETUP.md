# Setting up the portal

This takes about an hour, start to finish. Everything here uses free tiers, and no step asks for a card. Run the
commands in this folder.

## 1. A Neon project of your own

1. Sign up at <https://neon.com> with your own account and stay on the **Free** plan.
2. Create a project. For the **Files** page, pick one of the regions where Neon Object Storage runs: AWS us-east-2,
   us-east-1, eu-central-1 or ap-southeast-1. In any other region the app still works, but Files says it is not set up.
3. Install the Neon CLI (`npm i -g neonctl`, which also gives the `neon` command) and sign in with `neon auth`.
4. Link this folder to the project and create what `neon.ts` declares: Postgres, Neon Auth (the sign-in) and the
   private `files` bucket.
   ```sh
   neon link        # pick your project and its main branch
   neon deploy      # creates Auth and the bucket, and writes their variables to .env.local
   neon env pull    # writes the connection strings to .env.local
   ```
   If you would rather not use the CLI, copy the two connection strings from the Neon console (Connect: the
   **pooled** one into `DATABASE_URL`, the **direct** one into `DATABASE_URL_UNPOOLED`). Then turn on Auth in the
   console and copy its base URL and JWKS URL into `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL`.

## 2. The env file

```sh
cp .env.example .env.local     # if `neon env pull` has not made it already; then keep only one copy of each line
openssl rand -base64 32        # paste into NEON_AUTH_COOKIE_SECRET
openssl rand -base64 32        # a second one, into TEAMS_ENCRYPTION_KEY (keep it: it unlocks the stored Notion token)
```

Set `NEXT_PUBLIC_APP_URL` to the address you will deploy to. You can fill it in after step 6.
`NEXT_PUBLIC_HOME_STATES` is optional: it sets which states a Google Maps lead import keeps by default.

`.env.local` is ignored by git. Never commit it, and never paste its values into an issue or a chat.

## 3. The tables

```sh
npm install
npm run migrate     # creates every table on DATABASE_URL_UNPOOLED; safe to run again
```

## 4. Your first sign-in creates your company

```sh
npm run dev         # http://localhost:3100
```

Sign in. On an empty database, the first person to sign in becomes the **owner** of a company called "My team". Read
and acknowledge the notice (it says what the app records about people). After that, nobody else gets in unless you
add them.

Before your team uses it, read `docs/notice-template.md`. Adapt the notice to where your people work, and confirm it
with a lawyer where the template says so.

## 5. Your team

Go to **Settings → People → Add member by Google email**. Enter each person's Google address, name and role (members;
the owner adds managers). Their row says "invited, not signed in yet" until they first sign in with exactly that
address. **Copy invite** gives you a message to paste on Slack or WhatsApp.

## 6. Deploy

Any Next.js host works. On Vercel:

1. Import the repository. The build command is in `vercel.json` (`npm run migrate && npm run build`); set its region
   next to your database.
2. Add the variables. `npm run env:vercel` copies them from `.env.local` to the clipboard (macOS) as `NAME=value`
   lines; it prints only their names. Paste them into Vercel → Settings → Environment Variables.
   Never set these in production: `TEAMS_DEV_LOGIN`, `NOTION_TOKEN_FILE`, `NOTION_LEADS_DATA_SOURCE`,
   `NOTION_TASKS_DATA_SOURCE`, `PGLITE_DIR`.
3. Add your deployed address to Neon Auth's trusted domains (Neon console → Auth → Domains), so sign-in comes back to
   it.
4. If you use Files, let browsers upload to the bucket from your address:
   `node --env-file=.env.local scripts/bucket-cors.mjs`.

Vercel's Hobby plan is for personal, non-commercial use. A team selling its work should check the host's terms and
pick one whose free tier allows that.

Before real customers, set your own Google OAuth client and email sender in Neon Auth, because the shared ones are
for development: <https://neon.com/docs/auth/production-checklist.md>.

## 7. Keys for the agents

Each reader in the agent family gets its own key, named after it. The key names its company and what it may do. Only
its SHA-256 is kept, so the key is shown once, when you make it.

| Name | Scopes | Who uses it | File in the fleet |
|---|---|---|---|
| `engine` | board:read board:write | the agents, to read and write leads | `common-data/keys/portal-engine.key` |
| `validator` | board:read board:write board:validate | the Validator, to check and fill leads | `common-data/keys/portal-validator.key` |
| `dashboard` | board:read | the fleet's dashboard, to read the board | `common-data/keys/portal-dashboard.key` |

- From this folder (the script writes the file itself, mode 600, and never prints the key):
  ```sh
  node --env-file=.env.local scripts/api-key.mjs engine board:read board:write
  node --env-file=.env.local scripts/api-key.mjs validator
  node --env-file=.env.local scripts/api-key.mjs dashboard
  ```
  They write to `~/bots/common-data/keys/` (`PORTAL_KEYS_DIR` to change it). Making a key for a name again revokes its
  old one. Run the script as shown; do not redirect its output into the key file.
- Or in the app: **Settings → API keys → Make a key** with the same name (the right scopes are ticked for you), and
  paste the key into its file, one line, `chmod 600`.

## 8. Pointing the fleet at the portal

One setting moves the Leads board from Notion to the portal, in the fleet's `common-data/configs/common.toml`:

```toml
[leads]
portal_url = "https://your-portal.example.com"
```

From then on the agents, the Validator and the dashboard read and write leads here with the keys from step 7. The
dashboard keeps the board in `common-data/shared-state/portal-leads-cache.json` and asks only for what changed since its
last read, so a free database's transfer allowance lasts. Check it from the fleet folder with
`python3 scripts/setup-check.py --probe`: each portal key is tested with one read-only request. Without `portal_url`,
the board stays on Notion; connect that Notion board in **Settings → Board** so the portal reads it meanwhile.

If the portal's database ever runs out of its free quota, the fleet's `docs/portal-database.md` has the nightly standby
copy and local mode.

## Check it

```sh
sh scripts/smoke.sh
```

The script checks the env file, runs the migrations, starts the app and asks it for `/api/health` and the sign-in page.

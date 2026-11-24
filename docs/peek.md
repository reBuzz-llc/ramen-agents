# Peek, your team's board

Peek is the team's board: Leads, Tasks (the queue), Packages, Samples and Follow up, with each row's history. It runs on
this Mac at http://127.0.0.1:3100 with sign-in off, so only this Mac can open it. Its checkout is `~/Projects/portal`
(the starter's `portal` branch); its database and files are in that checkout's `.data/`.

## Set it up, or move to it

- A new install: `sh scripts/setup.sh` sets Peek up for you.
- An install that used the dashboard's board (http://127.0.0.1:3000/boards): `sh scripts/peek.sh setup`. It builds
  Peek, shows how many leads, tasks, rates and packages it would move, and moves them only when you type `yes`. Then it
  reads every row back from Peek and prints both counts; only when they match do the agents switch to Peek. A cell a
  person wrote stays a person's on Peek, so the agents still leave it alone. The dashboard's board file is not changed.
- Going back: `sh scripts/peek.sh back`. The agents use the dashboard's board again, as you left it; Peek's two launch
  agents are removed and its data is kept. What was written on Peek after the move is on Peek, not on the dashboard's
  board.

## Keeping it current

`sh scripts/update.sh` updates Peek with everything else. Before each Peek update its database and files are copied to
`common-data/peek/backups/` (the newest three are kept); if the new version does not build or start, the previous
version and its data are put back and the line says why. `sh scripts/peek.sh update --check` says what an update would
bring.

Two jobs run once a day (the `com.ramen-agents.peek-jobs` launch agent): tasks left too long are moved along, and old
sample copies and unused photos are removed. They use a secret made at install in `~/Projects/portal/.env.local`; it is
never printed.

## Later: sign-in and other devices

With sign-in off, Peek answers only on this Mac. To open it from a phone or another computer:

1. Turn on Google sign-in, as in "Sign in with Google (optional)" in `~/Projects/portal/SETUP.md`: make the OAuth
   client, give your owner account your Google address once (`PEEK_OWNER_EMAIL=you@example.com npm run local` in
   `~/Projects/portal`, then stop it), and put the client's two values in `~/Projects/portal/.env.local` as
   `GOOGLE_CLIENT_ID=...` and `GOOGLE_CLIENT_SECRET=...` (mode 600).
2. Restart Peek: `launchctl kickstart -k gui/$(id -u)/com.ramen-agents.portal-local`. With both values there, Peek starts
   with sign-in on, and every page asks for Google sign-in; only the people you add in **Settings → People** get in.
3. Reach it through the tunnel: `sh scripts/install-launchd.sh portal-tunnel`. With sign-in off, Peek refuses anything
   that comes through the tunnel, so this step works only after the first two.

To turn sign-in off again, remove the two lines from `.env.local` and restart Peek.

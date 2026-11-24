# Setting up the portal

You need Node.js 22 or newer. Run every command in this folder.

## 1. Install and start

```sh
npm ci
npm run build
npm run local
```

Open http://127.0.0.1:3100. The first visit shows a short notice about what the app records: read it and continue.
You are the owner of a company called "My team". Rename it in **Settings → Company**.

Sign-in is off, so the portal answers only on this computer. Stop it any time with Ctrl+C.

## 2. Give your agents their keys

Each agent gets its own key. Stop the portal first, because the local database opens in one program at a time. Then run:

```sh
node scripts/api-key.mjs engine --pglite .data/pglite
node scripts/api-key.mjs validator --pglite .data/pglite
node scripts/api-key.mjs dashboard --pglite .data/pglite
```

Each key is written to `~/bots/common-data/keys/peek-<name>.key` and never shown (set `PEEK_KEYS_DIR` to put them
elsewhere). Making a key again replaces the old one. Start the portal again with `npm run local`.

The agents find the portal at http://127.0.0.1:3100. The ramen-agents setup points them there for you.

## 3. Keep your data safe

Everything is in `.data/`. To back it up, stop the portal and copy that folder.

## Sign in with Google (optional)

Turn this on before anyone opens the portal from another device. Without it, only this computer can open it.

1. In Google Cloud, create an OAuth client of the type **Web application**. Add your address followed by
   `/api/google-signin/callback` as an authorized redirect URI, for example
   `http://127.0.0.1:3100/api/google-signin/callback`.
2. Give your owner account your Google address. Start once with sign-in still off, then stop:

   ```sh
   PEEK_OWNER_EMAIL=you@example.com npm run local
   ```

3. Start with sign-in on, using the client's two values:

   ```sh
   FILES_LOCAL=1 GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm start
   ```

   Every page now asks for Google sign-in, and only the people you add in **Settings → People** get in.

Only then put the portal behind a tunnel or on your network.

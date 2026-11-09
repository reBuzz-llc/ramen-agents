# The office, live (read-only, for your team)

The agents' world from the dashboard's home, read-only, for your team on the portal. It runs on the machine
that runs the agents and is reached through a tunnel of your choice. The dashboard itself (127.0.0.1:3000) stays
private: only this small server is exposed.

## What runs

| Piece | Where | What it does |
|---|---|---|
| `webapp/scripts/world-public.ts` | 127.0.0.1:3200 (`launchd/com.ramen-agents.world-public.plist.template`) | Three routes: `GET /` (the office page), `GET /state` (the masked state), everything else 404 |
| `webapp/app/api/world-public` | the dashboard, loopback only | Builds the state from the Board and each agent's Feed, masked by `webapp/lib/world-public.ts` |
| `webapp/scripts/world-public-build.mjs` | run after a change to the world | Builds `webapp/dist/world-public/index.html` (the world bundled read-only, CSS and JS inlined) |
| `common-data/keys/world-share.key` | mode 600 | The shared secret; the portal has the same value as `WORLD_SHARE_SECRET` |

**Access.**
- The portal signs a link for the signed-in person, valid for two hours:
  `?t=<base64url(exp.person)>.<HMAC-SHA256>`.
- A bad or expired link gets 403: "open the office again from the team portal".
- At most 60 requests a minute per address.
- Each request is logged in `common-data/logs/world-public.log`: time, address, path, status and first name, never the
  token.

**What never leaves the machine.**
- Email addresses, phone numbers and web addresses, anywhere.
- Your decisions, the CEO's proposals, the chat with the agents.
- The controls (Stop, Start, Pause), the Screen tab (a lead's own web page), and screenshots.

A lead's business is shortened to its first word and the next word's initial ("Cobot P."); a contact or a teammate is
shortened to a first name. If a state still holds an address or a long number after masking, it is not sent at all.

**Framing.** The page may be shown only inside the pages you list in `WORLD_FRAME_ANCESTORS` (default `'self'`). Set it
to your portal's address, for example `https://portal.example.com`.

## Your two steps (once)

1. Make the secret and load the server.
   - Run `sh ~/bots/webapp/scripts/world-share-key.sh` and give the portal the same value as `WORLD_SHARE_SECRET`.
   - Fill the plist template the way `launchd/README.md` describes, then load it with
     `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ramen-agents.world-public.plist`.
2. Expose port 3200 through a tunnel. Any tunnel that forwards HTTPS to `http://127.0.0.1:3200` works:
   - Tailscale Funnel: `tailscale funnel --bg 3200`
   - Cloudflare Tunnel: `cloudflared tunnel --url http://127.0.0.1:3200`

   Paste the public address it prints in the portal: Settings → Company → **Live world address**.

## The off switch

- Stop the tunnel and the office is off the internet at once. With Tailscale: `tailscale funnel off`. With Cloudflare:
  stop `cloudflared`. The portal then shows "The live world is off right now".
- `launchctl bootout gui/$(id -u)/com.ramen-agents.world-public` stops the server.
- `sh webapp/scripts/world-share-key.sh --rotate` ends every open link. The portal then needs the new value.

## After a change to the world

Run `node webapp/scripts/world-public-build.mjs`. The server reads the page on each request, so it needs no restart.

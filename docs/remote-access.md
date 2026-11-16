# Reach it from your phone or another computer (optional)

The dashboard listens on this Mac only (http://127.0.0.1:3000). To open it from your phone or a laptop, the
recommended way is [Tailscale](https://tailscale.com): a private network between your own devices. The dashboard
stays off the internet; only devices signed in to your Tailscale account reach it, over an encrypted connection.

`sh scripts/install.sh` does not install Tailscale and nothing here signs you up for anything. It is your account and
your choice.

## What Tailscale's free plan allows

As Tailscale states it on its pricing page (https://tailscale.com/pricing, read 2026-11-16; check it again before you
rely on it):

- The **Personal** plan is free, for up to 6 users, with unlimited devices of those users.
- Tailscale says the Personal plan is **"only suitable for non-commercial use"**.
- A tailnet on a custom (work) domain counts as business use: it starts a 14-day trial, after which you need to choose
  a plan.

The agents run a business, so read Tailscale's terms and decide which plan fits you. If none does, skip this page: the
family runs the same without it, and you watch it on the Mac itself.

## Set it up

1. Install Tailscale on this Mac (https://tailscale.com/download/mac) and on your phone or laptop, and sign in on both
   with the same account.
2. On this Mac:

   ```sh
   sh ~/bots/webapp/scripts/remote-access.sh
   ```

   It checks that Tailscale is signed in and that the dashboard answers, then runs `tailscale serve` so the dashboard
   is at `https://<this Mac's Tailscale name>/` for your devices only, and prints that address. If HTTPS certificates
   are off for your tailnet, Tailscale prints a link to switch them on; open it and run the script again.
3. Open the printed address on your phone. Settings › Remote access on the dashboard shows the same status.

Undo it with `tailscale serve reset`.

## Teammates

Only the Tailscale login this Mac is signed in with may open the dashboard; anyone else on the tailnet gets "Not
allowed". To let a teammate in:

1. Invite them to your tailnet in Tailscale's admin console (each invited person is a user on your plan).
2. Add their login to the dashboard's allow list: in `~/Library/LaunchAgents/com.ramen-agents.bot-dashboard.plist`,
   under `EnvironmentVariables`, set `DASHBOARD_ALLOWED_USERS` to the logins, comma-separated
   (`you@example.com,teammate@example.com`), then reload it:

   ```sh
   launchctl bootout gui/$(id -u)/com.ramen-agents.bot-dashboard
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ramen-agents.bot-dashboard.plist
   ```

A teammate who can open the dashboard can edit the boards and stop or start members, so add only people you would
hand this Mac to.

## Not this way

- **Never open the dashboard to the internet** (a port forward, a public tunnel, Tailscale Funnel). It holds the
  boards, your answers and the controls, and it has no log-in of its own beyond the checks above. Tailscale Funnel,
  which does publish to the internet, is on the [Advanced](advanced.md) page with a warning, and it is never for the
  dashboard or the local board.

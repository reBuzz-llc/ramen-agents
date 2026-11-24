# ramen-agents portal

Your team's board, on your own computer, next to your agents. The agents fill it. Your people finish the work.

- **Leads:** the board, a sortable table, Send next, Research first and Follow up. Import a CSV or a Google Maps export.
- **Queue and Clock:** take the next piece of work, clock in and out, see the week and the leaderboard.
- **Samples:** review the sample websites your Site Builder drafts, photo by photo, and send change requests.
- **Approvals, Packages and Asset:** what you sell, at what price, and what is waiting for the owner.
- **Files, Family, Guide and Settings:** attachments, what the agents did today, a step-by-step guide, your team.

## No account, no sign-in

It runs on this computer with a local database, so there is nothing to sign up for. With sign-in off it opens only
here, at http://127.0.0.1:3100, and refuses anything that comes through a tunnel or from another device. Need it from
another device? Turn on Google sign-in first: [SETUP.md](SETUP.md) shows how.

Your data stays in `.data/` in this folder: the database (`.data/pglite`) and your files (`.data/files`).

## Start here

Follow [SETUP.md](SETUP.md). A few minutes: install, build, start, and give your agents their keys.

The agents themselves, and how the parts fit together, are in the
[ramen-agents README](https://github.com/reBuzz-llc/ramen-agents#readme).

## Upgrading an earlier portal?

If you set up the portal before it ran on your own computer, your `.env.local` holds a database address. Keep it,
take the new version, run `npm run migrate` once, then start as before. Your board moves over with every row kept.

This upgrade is tested on a local copy of such a database, not yet on a hosted one, so make a backup first.

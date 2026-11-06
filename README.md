# ramen-agents portal

The web app your team works in, beside the agent family. The agents fill the boards, and people finish the work:

- **Clock** (home): people clock in to a project and out, and post short "now doing" notes.
- **Our queue:** drafts to review, emails to send and team tasks, best first, read from the portal's own Leads board.
  A person accepts an item, works it and marks it done; "Copy draft" names the attached files. Nothing is ever sent
  from here; people send from their own mailbox.
- **Leads:** the Leads board in your own Postgres. Each lead has its history and flags and the next step, and a
  CSV or Google Maps export can be imported. The **Table** tab shows every cell as a grid you can sort, rearrange
  and hide columns in. Phone numbers are kept in the international format (+17185550100).
- **Files:** PDFs and logos to attach to emails, stored in any S3-compatible bucket (Neon's object storage, R2, S3):
  set the four `AWS_*` variables in `.env.local`. With none set, uploads stay closed and the page says so.
- **Asset:** what you sell. The rate card, one line per offer ("Starter site: $500 one-time"), and your packages
  (price and timeline, the offer, who buys it, what they get, the ready-to-send email). The owner and managers
  edit; everyone reads; the bots read through `GET /v1/assets/rates` and `/v1/assets/packages`. A bot can hand a
  package over as a draft (`POST /v1/assets/packages/drafts`); only a person publishes, with **Publish** or the
  owner's **Publish all drafts**, and a key's PUT that would publish is refused (405). Start from the example:
  `node --env-file=.env.local scripts/seed-assets.mjs` reads `examples/assets.json`.
- **Guide:** the team's step-by-step guide to what they change here and what the agents see from it, open to anyone
  (the sign-in page links it).
- **This week**, **Leaderboard** and **statements**: hours and outcomes against the week's key results, plus pay
  statements a manager approves.
- **Settings:** company, people, board, rates, API keys and appearance.

This is the `portal` branch of ramen-agents. The `engine` branch is the bot program, and the `fleet` branch is the
family it runs. This branch is where people work, and the board API the bots read and write. Like the other branches,
it starts with no history and no data.

It runs on free tiers only: Neon's free plan (Postgres, sign-in and file storage) and any Next.js host. Nothing here
calls a language model.

## Start here

Follow [SETUP.md](SETUP.md) from top to bottom. It takes about an hour: a free Neon project, the env file, the
migrations, your first sign-in, your team and the agents' keys. To check a setup, run `sh scripts/smoke.sh`.

## Run it on your machine

```sh
cp .env.example .env.local     # empty DATABASE_URL: a local Postgres (PGlite) in .data/, for trying it out
npm install
npm run dev                    # http://localhost:3100
npm test                       # the rules: queue, roles, leads, tasks, timesheet, tenant isolation
```

With `TEAMS_DEV_LOGIN=1` in `.env.local`, the sign-in page also offers a development sign-in that needs no Neon Auth.
It works only on your machine and is ignored in production builds.

## Rules this code keeps

- **It never sends anything.** People send, then mark it sent.
- **A person's edit wins.** A bot's write to a cell a person changed is refused and recorded, never applied.
- **Nothing on the person's computer.** No screenshots and no keystrokes; only the times, the project and the notes.
  See `/privacy` and `docs/notice-template.md`.
- **One company per tenant.** Every table carries `tenant_id`, and every query filters by it.
- **Secrets stay out of the repo.** They live only in the environment. Notion tokens are encrypted at rest
  (`TEAMS_ENCRYPTION_KEY`). API keys are stored as SHA-256 only and shown once when made.

## Layout

| Path | What |
|---|---|
| `app/` | The pages and the API routes; `app/v1/` is the board API the agents use with their keys |
| `lib/db/schema.ts`, `drizzle/` | The tables and migrations |
| `lib/leads.ts`, `lib/tasks.ts` | The boards' write rules (a person's edit wins, history, flags) |
| `lib/queue.ts` | The queue's rules, pure and tested |
| `lib/roles.ts` | Owner, manager and member: who may do what |
| `docs/design/` | The board API and the board schema the agents rely on |
| `scripts/` | Migrations, API keys, the files bucket's CORS, the env copy for the host, the smoke check |

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

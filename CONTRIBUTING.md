# Contributing to ramen-agents

Thank you for helping. ramen-agents exists so that a founder with no budget can run a small team of agents on free
tiers, safely. Every contribution is judged against that.

## Before you start

- **The fence comes first.** Read [FENCE.md](FENCE.md). A change that lets an agent sign up, log in, spend, request a key,
  collect personal data or follow instructions found on a web page will not be merged, however useful it looks.
- **Free tiers only by default.** A new model or search provider is welcome when it has a free tier with no card. A paid
  provider can be supported, but never added to the default chain.
- **Open an issue first for anything big** (a new agent, a new action type, a change to the policy), so we can agree on
  the shape before you write it.

## Where things live

| Branch | What to change there |
|---|---|
| `engine` | The `bot` program (`src/explorer/`), its policy and its tests (`tests/`) |
| `fleet` | The agents' instruction files, shared settings, the Validator (`validator/`), the dashboard (`webapp/`) |
| `main` | This guide, the README, the fence, the docs site (`docs/`) |

Open your pull request against the branch you changed.

## Running the tests

```sh
# engine branch
pip install -e '.[dev]'
python -m pytest -q

# fleet branch: the Validator
cd validator && python -m pytest -q tests

# fleet branch: the dashboard
cd webapp && npm ci && npx tsc --noEmit -p . && npx eslint app lib
```

CI runs the same commands on every pull request.

## Style

- Write code that reads like the code around it. Comments say *why*, with the date and the reason when a rule came from
  an observed failure ("a bot opened 69 pages for 3 drafts").
- Agent instructions (`persona.md`) are plain English, short, and concrete: a file name or a number beats an adjective.
- No real people, businesses or IDs in tests or examples: use the made-up ones already there (Acme Bakery, Sweet Corner,
  Alex Stone).
- Never commit a key. The repository refuses anything shaped like one, and `common-data/keys/` is ignored.

## Reporting a security problem

If you find a way past the fence, please don't open a public issue. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability"), and we will answer there.

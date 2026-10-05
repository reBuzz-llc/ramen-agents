# Starter Setup

A blank starting point for a small family of autonomous web bots on one Mac. It has two parts, kept on two branches
of this repository because each is cloned to its own folder:

| Branch | Clone to | What it is |
|---|---|---|
| `engine` | `~/Projects/bot` | The `bot` program: the loop, the rules it enforces, its tests |
| `fleet` | `~/bots` | What the engine runs: five bots with blank cards and configs, shared settings, the Validator, the dashboard, scripts |

Both start with no history and no data: no leads, notes, packages, memories or logs, and no keys.

## Get started

```sh
git clone -b engine -o starter https://github.com/reBuzz-llc/Starter-Setup ~/Projects/bot
git clone -b fleet  -o starter https://github.com/reBuzz-llc/Starter-Setup ~/bots
```

Then follow `~/bots/SETUP.md` from the top. `-o starter` names this repository `starter` instead of `origin` in your
clones, so your own cards, configs and ids are never pushed back here; the guide's last step gives each folder its own
private repository.

Runs on macOS only.

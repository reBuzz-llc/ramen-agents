# Keeping a small family healthy on free tiers

What changed in October 2026, for someone running one or two agents. Every new setting below is off in the starter
until you turn it on, because a fresh setup has nothing to protect yet. Each section gives the setting, why you would
turn it on, and the problem that made us build it.

Settings live in a bot's `config.toml` (or in `common-data/configs/web-bots.toml` for every web bot at once). Restart
the bot after a change: `sh scripts/restart-bot.sh <slug>`.

## Rest when there is nothing to do

```toml
[agent]
idle_when_empty = true   # default false
idle_minutes = 30        # default 30
```

With this on, a bot that has nothing to do skips the model call, writes a `resting` line to its log with the reason,
and looks again `idle_minutes` later. An inbox message or a message from you wakes it straight away. A bot with a work
list rests when the list is empty or its daily update cap is reached. Any other bot rests when every daily cap it has
(tasks, messages) is reached.

Turn it on when your free model quota runs out before the day does.

The problem: a bot with an empty work list kept asking the model what to do next, all day, and spent the free quota
the busy bots needed.

## Stop after three day-blocked refusals

```toml
[agent]
day_block_rest = true    # default false
```

Some refusals hold for the rest of the day, for example "you have reached today's limit for this". With this on, the
third such refusal in one episode ends the episode (the bot writes its summary as usual), logs `day_block_rest`, and the
bot rests `idle_minutes` before trying again. A message wakes it.

Turn it on when a bot's log shows the same refused action over and over.

The problem: after a daily limit, bots kept retrying the same blocked search or page instead of moving on.

## Limit how often a package goes up again

```toml
[notion]
republish_days = 7       # default 0 (off)
```

A package whose name has gone up on the Packages page in the last `republish_days` days is refused. Names are
compared loosely: "24/7" is dropped, along with a price or setup suffix after a spaced dash and punctuation. So
"Website Care" and "Website Care – $99/month" count as one package.

To let one through on purpose, add it to `common-data/shared-state/republish-requests.json`:

```json
[{"name": "Website Care", "reason": "new price"}]
```

A request lets that package up once. It is removed when the package goes up, whatever spelling the request used.

Turn it on when your packages page fills with the same offer.

The problem: one package went up many times in a week, each time under a slightly different name.

## Spot the same offer under a new name

There is no setting: this check is always on.

When the Package Designer hands over a package, or The CEO publishes one, the name is compared with the packages
already on the page. If it shares most of its distinguishing words (60% or more, and at least two) with one of them,
it is refused: "that is '<existing name>' in other words; improve it under that exact name, or make a different
offer". Republishing a package under its exact existing name still works, as an improvement.

The problem: the page ended up with one offer under four names, and a reader could not tell which one was current.

## One task a day, added to rather than repeated

```toml
[notion]
max_tasks_per_day = 1    # default 8
```

Once the day's cap is reached, `task` disappears from the bot's menu, and an attempt is refused for the rest of the
day with "today's task exists; add to it with update_task". A cap of 1 gives your team one full task a day instead of
several thin ones.

Turn it down when the people doing the tasks are drowning in them.

The problem: with a cap of one, the bot kept trying to add a second task and was refused, instead of adding to the
first.

## Know when a model provider stops answering

There is no setting: every model call records how it went, per provider, in the shared call ledger
`~/.config/explorer/model_calls.json` under `"health"`:

```json
"health": {"api.z.ai": {"last_ok": "2026-10-29T22:45:01", "last_fail": "2026-10-29T22:44:25",
                        "last_reason": "rate limit (429)", "first_fail": "2026-10-29T22:44:25"}}
```

`first_fail` is when the current run of failures began. The next success removes it. A provider that times out is
benched for 15 minutes instead of 2, so a host that accepts a call and then hangs no longer costs a long wait every
couple of minutes.

For the dashboard to see it, link the ledger into shared state once:

```sh
ln -s ~/.config/explorer/model_calls.json common-data/shared-state/model_calls.json
```

The problem: the first provider in the chain failed for hours, and nothing said so.

## Turn down hidden reasoning

Some free models think before they answer, and that thinking counts against the reply's token cap. A short cap can
then return an empty or half-written reply.

In a provider table:

```toml
[model.providers.groq]
reasoning_effort = "low"   # default: not sent
max_tokens = 1200          # default: not set; a floor for this provider's output cap
```

`reasoning_effort` is sent only where the API accepts it (gpt-oss models on Groq, Speka and Ollama Cloud take "low").
For Z.ai's glm-4.5-flash, thinking is always turned off; there is nothing to set.

For Gemini, in `[model]`:

```toml
[model]
gemini_thinking_level = "low"     # default "" (the model's own choice); gemini-3 models only
gemini_max_output_tokens = 2000   # default 0 (no floor)
```

Turn these on when drafts come back cut off or empty. The model log then shows the reply stopped at its token cap.

The problem: emails stopped right after "Hi …" because the model had spent the whole cap thinking.

## The dashboard: health banner, the world and Reports

There is no setting: both are part of the dashboard.

**Health banner:** a red line at the top of the home page when something needs a person, and nothing when all is
well. It appears when:

- the Validator has not run for 8 hours, or has not done a full sweep for 30 hours;
- the Mac went off without a clean shutdown in the last 24 hours;
- a running bot has had no accepted action for 2 hours of time it was awake (resting, quiet pauses and Mac-off time
  do not count);
- the main model provider (the one with the most calls today) has been failing for over an hour.

**The world** (the home page) shows each running bot at its desk, resting on the sofa, or asleep in the corner when
it is stopped, with a line over the room for how long the Mac was off and the bots were quiet in the last 24 hours, so a
slow day is not mistaken for bad bots. Click a bot for its panel: what it is doing, its last 7 days (actions, the
share refused, outputs by type), the page it has open, its recent work, and Pause, Stop and Start. A World / List
switch shows the same board as cards.

**Settings › Reports** has your team's sending numbers, the week's key results if you keep
`common-data/botBox/routed/the-ceo/okr-week.md`, today's model providers (each with a green or red dot), and the
Validator's reports.

The problem: a check-in meant opening every bot's log by hand, and a low day looked the same as a broken one.

## Stopping a bot for good

```sh
sh scripts/disable-bot.sh <slug>   # only for a bot with a STOP file
sh scripts/enable-bot.sh <slug>    # undoes it; the STOP file stays
```

A STOP file stops a bot, but launchd still relaunches it every 30 seconds just to read "STOP file present" and exit.
`disable-bot.sh` unloads the bot's launchd jobs (run loop, data server, app) and marks them disabled, so a login or
reboot does not load them again. It refuses a bot without a STOP file. `enable-bot.sh` loads them again, but
`restart-bot.sh` is still what runs the bot.

The problem: a stopped bot's error log grew to megabytes of the same line in a few weeks.

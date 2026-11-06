# The dashboard: what you see and what you can do

The dashboard runs at http://127.0.0.1:3000 on your Mac. It shows the family as an office: each agent at its desk, a
big screen behind it, and a sleeping corner for the ones you stopped. A **World / List** switch at the top changes the
view.

## Each desk's screen

Every working agent has a screen with its name on a tab above it. If it is not working (resting, stuck, stopped), an
orange badge on the tab says so; working is the normal state and has no badge. The screen shows four lines:

| Line | Example | What it means |
|---|---|---|
| 1 | `11/12 updates` | its own outputs today, against its daily goal (`11 updates today` when it has no goal) |
| 2 | `Sunrise Bakery · Draft email` | what it is on right now: a lead and the cell it filled, a provider, a package, a message or a question; with an orange square, the web page or search it has open; while resting, `until 14:40` and why |
| 3 | `z.ai · 4m` | which model provider answered its last call, and how long ago |
| 4 | `9/13 ok · 30m` | of its actions in the last 30 minutes, how many the rules allowed |

Under them: the share of today's actions the rules refused, with a thin bar. A rising bar means the agent keeps trying
things its rules do not allow; read its refusals on the Work plan page.

Point at a screen to scroll a long line. Click an agent for its full card: the same four lines, what it is thinking,
its last action, and the Pause, Stop and Start buttons.

### Daily goals

The goals on line 1 come from `common-data/daily-goals.json`, one number per agent:

```json
{ "lead-gen": 10, "research-analyst": 3, "scout": 1, "package-designer": 1, "the-ceo": 3 }
```

Change a number and the screen shows it on the next refresh. Leave an agent out and it shows no goal. Keys that start
with `_` are notes and are ignored.

## Allowance: use every free tier

The family runs on free tiers. A free tier you do not use today is gone tomorrow, so the goal is to **drain** them:
use every free allowance, and spread the work by how much each one has left. The **Allowance** panel in the List view
shows it. You can also open it at http://127.0.0.1:3000/#allowance.

For each provider in the chain:
- calls today out of its daily cap;
- tokens today, where the free tier counts tokens;
- what is left today;
- a thin bar;
- when it last answered and when it last failed.

A provider that has stopped answering says so in words ("not answering since 11-03 15:56"). So does one above 90% of
today's allowance.

The numbers come from three keys in each provider's table in `common-data/configs/web-bots.toml`:

| Key | What it is | Example |
|---|---|---|
| `calls_per_day` | the most calls a day the family makes to it; also enforced by the engine | `calls_per_day = 900` |
| `tokens_per_day` | a free tier counted in tokens a day (the dashboard reads it) | `tokens_per_day = 200000` |
| `tokens_per_month` | a free tier counted in tokens a month; the dashboard shows today's fair share: what is left this month divided by the days left | `tokens_per_month = 1000000` |

Set the token keys from the provider's own pricing page. A tier with no published number gets no token key: the panel
then counts its calls only.

A second table, **Keyed, not in the chain**, lists the other keys in `common-data/keys/` with their last use: the
search backups, the email checkers, and model providers you keep but do not use. Only the key files' names are shown,
never a key. "—" means no use recorded today, or no allowance on file.

## Stopping and starting an agent

Click an agent, then **Stop**. You can type a reason; it is optional. The agent's `workspace/STOP` file then starts with
a line such as `Owner: too many repeats today`, or `Owner: stopped from the dashboard 12:32` without a reason. The
dashboard's log (`common-data/shared-state/owner-controls.jsonl`) records the same line, and the agent's mat in the
sleeping corner shows `owner 12:32: too many repeats today`.

A stop file is therefore never empty when you made it. An empty or unexplained STOP is not yours: look before
removing it. **Start** removes the file and runs the agent again. If the agent does not come back, the STOP goes back
as it was, and the dashboard says why.

## Restarting from the terminal

`sh scripts/restart-bot.sh <slug>` restarts an agent after you change its config or card. It refuses in two cases:
- the agent has a STOP file (your stop);
- your last action on the dashboard was Stop, even if the file has gone. Only your Start lifts that.

After restarting, it checks that macOS's launchd really has the agent. If not, it says so ("NOT loaded in launchd: run
enable-bot.sh <slug>") instead of claiming it restarted.

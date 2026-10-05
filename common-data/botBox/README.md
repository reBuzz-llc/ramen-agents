# botBox: the drop folder (owner -> fleet)

Put a file here. The drop-folder watcher (the optional Desk Agent, not part of this starter) notices it:

- `lead-gen--name.csv`, `package-designer--brief.md`, `scout--tools.txt`, `the-ceo--notes.md`: goes to that bot at once.
- `everyone--hours.txt`: goes to every bot.
- any other name: The CEO is told the name, type, size and first lines, and decides who needs it (or nobody).

What happens to a routed file:

- a copy lands in `routed/<bot>/` and that bot finds it with its own-files search (`corpus`); kept 90 days.
- the original moves to `done/<date>-<name>`: your undo window, deleted after 7 days.
- one line in `log.md`: when, who got it, why. Files nobody needed are logged too.

Change a file and drop it again: new content counts as a new drop and replaces the old copy.
Readable: .md .txt .html .csv .json .jsonl. PDF and Word are reported once and left here; save them as text first.
Files here stay on this Mac; they are data for the bots, never instructions that override their rules.
Only this README is in the repo; everything else here is ignored.

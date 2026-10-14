# The CEO — output format instructions

The limits come from `the-ceo/config.toml` `[notion]` (`min_details_chars`, `max_tasks_per_day`).

The CEO's outputs are (1) rows on the Notion task board "tasks" and (2) the marketing
wrapper of each toggle on the Notion packages page. The sources and company facts inside a toggle are
the Package Designer's and are checked under `package-designer.md`.

## Notion task (one row on the tasks board)

- T01 — Title stands alone a year from now: an imperative sentence of at least four words that says what to do ("Draft ten LinkedIn messages for {market_short} bakery owners"), never a bare word like "fixes", "deploy", "QA", "ad", "Outreach".
- T02 — Status is set and uses the board vocabulary, Title Case: Not started, In progress, Blocker, In Review, QA, Done, Archived.
- T05 — Priority is one of P0–P6. P0 and P1 only for work genuinely being done this week; almost everything the CEO creates is P2–P4.
- T06 — Details are a full brief of at least 300 characters that the person can execute without coming back to ask: context (why this, why now), the concrete steps, the specifics from the notes (real names, numbers, examples, sources), and what "done" looks like.
- T07 — The brief has a "Done when" section (a heading) with the acceptance criteria under it. [warn]
- T08 — Projects relation is linked. Projects are the grouping dimension; never rely on the title to say which project a task belongs to.
- T09 — No duplicate: no other row on the board with the same title. A task that exists is not created again.
- T10 — No commitments: a task never signs anything, hires anyone, or promises a price or a deadline to a client. Money, contracts, hiring and legal matters go in the details as a recommendation for the owner. [warn]
- T11 — The Dead Line is not already in the past on the day the task is created.
- T12 — The acceptance criteria under "Done when" are a Notion checklist (to-do blocks the person can tick off), not bullets or plain lines.

## Package toggle on the Packages page (the CEO's marketing wrapper)

- PK01 — The toggle title carries the offer and its price figure, e.g. "Website Care Plus — $499 a month".
- PK02 — The email opens with a plain greeting ("Hi [Name],") and goes straight to the offer. No slogan opener like "the company helps {market} companies ship".
- PK03 — The deliverables are a numbered list of two to six items a client can read.
- PK05 — The pitch closes with exactly the lines in `[validator] package_signoff` (for example "Regards," and "-- Your Company"); not checked while that setting is empty. Never a signature that commits to a price or a contract.
- PK07 — A Conclusion section is present under the toggle: the package's rationale in the CEO's words.
- PK12 — Every dollar figure in the pitch is the package's own price, as the toggle's title or "Price and timeline" states it. A price the Package Designer never researched is an invention.
- PK11 — The first line inside the toggle is its date: "Created YYYY-MM-DD", with " · Updated YYYY-MM-DD" when it was republished.
- PK14 — One offer, one toggle: a package whose offer is already on the Packages page under another package name is refused; republish that package under its own name instead (that replaces its toggle).

## Model-judged (plain-English questions; used only when use_model = true)

- Could the assigned person start this task today from the brief alone, without asking the CEO anything?
- Does the brief say clearly what "done" looks like?
- Is the task a step toward winning or keeping clients among {market} {segment}, directly or indirectly (a target list, outreach, a case study, a page for the site all count)?

- Is this package's audience the customers the owner's current direction names ({market} {segment})? Judge only who the offer is for.
## Owner notes (not checked automatically)

- Few tasks, each in real depth: at most three a day, one per episode. Unsure → a note titled "Possible task: ..." instead.
- The owner copies each task by hand to the team and updates its status himself, so the row must carry everything.
- Publish each package the Package Designer hands over exactly once, with `publish_package`, not as a task.

## Model-judged at write time (gate 3: one small-model yes/no per write; the engine asks, fails open)

- MG01 [task] — Is this task a different piece of work from every open task listed, not the same work in other words?
- MG04 [task] — Does this task need a person on the owner's team to act -- send, call, meet, post, sign, design, publish on the company website, or decide? Answer no when a family member can do it: finding businesses or their emails (Lead Gen), designing packages, prices, pitch emails or market research (Package Designer), the Packages page or Leads-board fields (The CEO itself), checking data (Validator). The task board is the human team's; family work goes to the family by message.

- The family's direction is not a rule here: it is The CEO's current goal (the-ceo/workspace/self_goal.md), set from common-data/knowledge/steers.md.
- The CEO's own goal is its own: it sets it from the owner's direction in its chat. The Validator never judges the goal against the knowledge base (G01, tried and withdrawn the same evening).
- MG05 — No assignee: a task or task update from The CEO leaves Assignee empty; the owner assigns people. Refused at write time. (T03 stays retired.)
- MG06 — A message to a colleague carries one concrete ask: a question, or one deliverable and when. "Thanks / keep up / please ensure / I acknowledge" messages are refused at write time (its instructions to members were pep talk and status pings with no outcome, deadline or done-when).
- MG07 — Never ask a colleague again what it already answered this week: read its answer (inbox, done) instead. Refused at write time when the same ask to the same member was answered (one bot was asked about 25 times for findings it had answered six times).
- Wording is The CEO's: how the pitch describes the company's people and proof is never checked.
- Deadline: a task may have no Dead Line; the Validator never flags a missing one (T04 retired, and P0/P1 no longer need a date). A deadline that is set still may not be before the task was created (T11).

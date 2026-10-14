# What does the Validator check?

The Validator checks what the agent family writes -- rows on the Notion task board and the Leads board, the
packages page, the bots' messages to one another and their notes -- against the owner's rules. A rule bites at one of
two moments. Some are **refused at write time** by the gate: the write never lands and the bot is told why, so it can
try again. Everything else is **flagged in the sweep**: the write goes through, and the Validator reports the problem
afterwards and asks the responsible bot to fix it (rules marked `[warn]` in the rule files are reported to the owner
but not sent to a bot as a defect). Model-judged questions (MJ) are asked only when the model judge is enabled.

## The Leads board

Lead Gen's rows: one per business, with a way to reach it, evidence, and the package that fits.

| Rule | What it checks | When |
|---|---|---|
| LD01 | Refuses a row with no Business name or no way to reach it (an email or a WhatsApp link), or an email that is guessed or reads as a person's private mailbox. | Refused at write time |
| LD02 | Refuses a row with no Evidence URL, or evidence that is not on the business's own site, a job board it uses, or (no website) its public listing page. | Refused at write time |
| LD03 | Refuses a "How can I help" value that is not exactly one of the package names on the Packages page. | Refused at write time |
| LD04 | Flags a second row for the same business (same website domain, or same name and city when there is no website). | Flagged in the sweep |
| LD05 | Flags a phone number or a second email address in Pain point, Location, Industry or Company size. | Flagged in the sweep |
| LD07 | Flags a Location that does not read City, State, Country (a bare country, a single value or a street address). | Flagged in the sweep |
| LD08 | Flags a Company size that is a description of the business instead of a size (locations, staff, or both). | Flagged in the sweep |
| LD09 | Flags a Business email the Validator cannot find printed on any of the business's pages it could read. | Flagged in the sweep |
| LD10 | Flags a row with no Evidence URL showing the pain point is real (common on imported rows). | Flagged in the sweep |
| LD11 | Flags an empty Contact person: the founder outreach opens with is work still to do. | Flagged in the sweep |
| LD12 | Flags a Source pages cell that holds prose instead of page URLs, one per line. | Flagged in the sweep |
| LD13 | Flags a Business email that is not a buying desk (press@, media@, careers@, legal@ and the like). | Flagged in the sweep |
| LD14 | Refuses a Website that is a directory, association or social page rather than the business's own site. | Refused at write time |
| LD15 | Refuses a Contact person that is not a person's name (a phrase, a company, a role, "N/A"). | Refused at write time |
| LD16 | Flags a "done" report naming a business with no matching accepted write in Lead Gen's own log. | Flagged in the sweep |
| LD18 | Refuses an email the verification service reports as not deliverable. | Refused at write time |
| LD19 | Flags, as a reminder to the owner, a row still marked "Emailed" ten or more days later with no outcome recorded. | Flagged in the sweep |
| LD20 | Refuses a misshapen WhatsApp link (not `https://wa.me/<digits>`) or a number the team ruled out; flags one that none of the row's pages prints. | Refused at write time (shape, ruled-out number); flagged in the sweep (no page proof) |
| LD21 | Checks the Pain point has three lines (the gap seen, a fix they can try, what the team proposes) and is not vague or a guess; refuses a weak rewrite, flags a weak new lead. | Refused at write time (rewrite); flagged in the sweep (new lead) |
| LD22 | Flags a "google map location" that is not a Google Maps link to the business. | Flagged in the sweep |
| LD23 | Refuses a Founder LinkedIn that is not a profile or company-page link, or that lacks "LinkedIn found via" saying where it was found. | Refused at write time |
| LD24 | Refuses a Contact role that is not one of the board's options; flags a role with no Contact person. | Refused at write time (bad option); flagged in the sweep (no contact) |
| MG03 | Refuses a lead or lead update whose founder, location or size the cited page text does not state (one small-model yes/no per write). | Refused at write time |

## The Lead Enricher

The Lead Enricher fills empty cells on rows already on the Leads board; it never lists a lead. The Lead Gen shape
rules (LD07, LD08, LD15, LD20-LD24) and MG03 apply to its writes too.

| Rule | What it checks | When |
|---|---|---|
| EN01 | Refuses any action but a lead update, or any field outside its own (contact person and role, LinkedIn, pain point, WhatsApp, location, map link, size, industry, sources). | Refused at write time |
| EN02 | Flags a fill that replaces a value already on the row, or writes back a value the team deleted. | Flagged in the sweep |
| EN03 | Flags a value that no page the bot opened states, or that breaks the Lead Gen shape rules. | Flagged in the sweep |
| EN04 | Flags a guess, an unconfirmed public-record owner name, or a person's home address; an empty cell is an acceptable answer. | Flagged in the sweep |
| EN05 | Flags, after a fact-check of the cited pages, a founder, city or size figure that no page prints (reported to the Enricher and the owner). | Flagged in the sweep |

## Outreach drafts

The Outreach Writer drafts a first email (and a WhatsApp message where there is a number) into the Leads board. A
person on the team reads, edits and sends it; the bot never contacts a business.

| Rule | What it checks | When |
|---|---|---|
| OW01 | Refuses an email draft that does not end with the configured sign-off lines, exactly. | Refused at write time |
| OW02 | Refuses a price that is not one of the owner's published rates (otherwise "priced after a short call"). | Refused at write time |
| OW03 | Flags a greeting that names someone other than the row's Contact person or "the business's team". | Flagged in the sweep |
| OW04 | Refuses an email address, phone number or wa.me link in the email draft (the team's own WhatsApp link excepted). | Refused at write time |
| OW05 | Flags links other than the business's own site, the team's WhatsApp link and the row's own wa.me link. | Flagged in the sweep |
| OW06 | Flags an email draft of 300 words or more. | Flagged in the sweep |
| OW07 | Refuses any write other than the Draft email and Draft WhatsApp message cells. | Refused at write time |
| OW09 | Flags a draft not built on the package's ready-to-send email (its numbered points and fixed phrases kept, one opening line about what was seen). | Flagged in the sweep |
| OW10 | Flags a WhatsApp draft on a row with no WhatsApp link, or one the team marked as a false number. | Flagged in the sweep |
| OW11 | Refuses a WhatsApp draft whose last line is not the configured WhatsApp sign-off. | Refused at write time |
| OW12 | Refuses a WhatsApp draft with an unpublished price, an email address, a phone number or a wa.me link. | Refused at write time |
| OW13 | Flags links in a WhatsApp draft other than the business's own site. | Flagged in the sweep |
| OW14 | Flags a WhatsApp draft of 90 words or more. | Flagged in the sweep |

## The task board

Rows The CEO writes on the Notion task board, which belongs to the human team.

| Rule | What it checks | When |
|---|---|---|
| T01 | Flags a title that is not an imperative sentence of at least four words (a bare "fixes", "QA", "Outreach"). | Flagged in the sweep |
| T02 | Flags a Status that is empty or outside the board's vocabulary (Not started, In progress, Blocker, In Review, QA, Done, Archived). | Flagged in the sweep |
| T05 | Flags a Priority outside P0-P6. | Flagged in the sweep |
| T06 | Flags a brief under 300 characters or missing context, steps, specifics or what "done" looks like. | Flagged in the sweep |
| T07 | Flags a brief with no "Done when" heading. | Flagged in the sweep |
| T08 | Flags a task with no linked project. | Flagged in the sweep |
| T09 | Flags a second row with the same title. | Flagged in the sweep |
| T10 | Flags a task that signs, hires, or promises a price or deadline to a client. | Flagged in the sweep |
| T11 | Flags a Dead Line already in the past on the day the task is created. | Flagged in the sweep |
| T12 | Flags acceptance criteria that are not a Notion checklist of to-do blocks. | Flagged in the sweep |
| MG01 | Refuses a task that is the same work as an open task in other words (small-model yes/no). | Refused at write time |
| MG04 | Refuses a task that a family member could do instead of a person on the team (small-model yes/no). | Refused at write time |
| MG05 | Refuses a task or task update from The CEO that sets an Assignee; the owner assigns people. | Refused at write time |

## Packages

The CEO's marketing wrapper on each packages-page toggle (PK), the Package Designer's sources and company facts in it
(PS), and the package files the Package Designer hands to The CEO (PD).

| Rule | What it checks | When |
|---|---|---|
| PK01 | Flags a toggle title without the offer and its price figure. | Flagged in the sweep |
| PK02 | Flags an email that opens with a slogan instead of a plain greeting and the offer. | Flagged in the sweep |
| PK03 | Flags deliverables that are not a numbered list of two to six items. | Flagged in the sweep |
| PK05 | Flags a pitch that does not close with the configured sign-off lines exactly. | Flagged in the sweep |
| PK07 | Flags a toggle with no Conclusion section giving the package's rationale. | Flagged in the sweep |
| PK11 | Flags a toggle whose first line is not its "Created" (and "Updated") date. | Flagged in the sweep |
| PK12 | Flags a dollar figure in the pitch that is not the package's own stated price. | Flagged in the sweep |
| PK14 | Refuses a package whose offer is already on the page under another name. | Refused at write time |
| PS01 | Flags a toggle with no source page actually opened. | Flagged in the sweep |
| PS02 | Flags a search-results page used as a source. | Flagged in the sweep |
| PS03 | Flags the seller's own site used as a source. | Flagged in the sweep |
| PS04 | Flags a toggle without the reference company's name and website. | Flagged in the sweep |
| PS05 | Flags a recorded website that is not the site of one of the sources. | Flagged in the sweep |
| PS06 | Flags a version tag ("v2", "version 2") in the package name. | Flagged in the sweep |
| PD01 | Flags a package file without a crisp name, with a version tag, or repeating a service already sent. | Flagged in the sweep |
| PD02 | Flags a package file whose price has no figure. | Flagged in the sweep |
| PD03 | Flags a package file without two to six concrete deliverables. | Flagged in the sweep |
| PD04 | Flags a package file with no opened source, or with a search-results URL as a source. | Flagged in the sweep |
| PD05 | Flags the seller's own site among a package file's sources. | Flagged in the sweep |
| PD06 | Flags a package file without the source company's name and website, or with company facts its pages do not state. | Flagged in the sweep |
| PD07 | Flags a source company website that is not one of the sources. | Flagged in the sweep |

## Providers and the Scout

The Scout records free model providers for the owner to review; only durable, card-free free tiers count.

| Rule | What it checks | When |
|---|---|---|
| SC01 | Flags an Endpoint that is not the provider's https:// API base URL. | Flagged in the sweep |
| SC02 | Flags free terms that are missing or do not say no card is required. | Flagged in the sweep |
| SC03 | Flags a provider the family already has or knows. | Flagged in the sweep |
| SC04 | Flags a niche provider the family cannot use (roleplay-only, image-only, speech-only, embeddings-only). | Flagged in the sweep |
| SC05 | Flags a record with no source page the bot actually read. | Flagged in the sweep |
| SC06 | Flags a record with no source on the provider's own site. | Flagged in the sweep |
| SC07 | Flags a one-off trial credit, pay-as-you-go with no free tier, or a free tier that needs a card. | Flagged in the sweep |

## The family's messages

Rules for every bot, read from the record of direct messages and each bot's own log, plus The CEO's message rules and
the bots' own work checklists.

| Rule | What it checks | When |
|---|---|---|
| FM01 | Flags an ask from a family member still unanswered after 6 hours (status notes are never chased). | Flagged in the sweep |
| FM02 | Flags a recipient that read The CEO's ask two hours ago and has since done more of its own work than allowed. | Flagged in the sweep |
| FM03 | Flags messages that address bots by dashboard handle instead of full name. | Flagged in the sweep |
| FM04 | Flags an ask nobody answered in two days, so the owner sees the pattern. | Flagged in the sweep |
| FM05 | Flags a message addressed to a name that is not in the family. | Flagged in the sweep |
| FM06 | Flags the same ask sent three or more times to the same member while the first is still open. | Flagged in the sweep |
| FM07 | Flags output that repeats or acts on an instruction lifted from a web page. | Flagged in the sweep |
| MG06 | Refuses a message from The CEO with no concrete ask (a question, or one deliverable and when). | Refused at write time |
| MG07 | Refuses The CEO asking a colleague again what it already answered this week. | Refused at write time |
| PL01 | Flags a checklist step ticked done with no accepted write behind it. | Flagged in the sweep |
| PL02 | Flags a task marked done while some of its steps are not. | Flagged in the sweep |

## The Research Analyst

An optional member that answers The CEO's research questions with sourced notes and one findings post per question.

| Rule | What it checks | When |
|---|---|---|
| RA01 | Flags a note that does not record the page it came from, or cites a search-results page. | Flagged in the sweep |
| RA02 | Flags a figure, name or date in a note that the cited page does not contain. | Flagged in the sweep |
| RA03 | Flags a person's phone number or email address in a note (a business's role address is fine). | Flagged in the sweep |
| RA04 | Flags a note that repeats or acts on an instruction from a web page. | Flagged in the sweep |
| RA05 | Refuses any task-board or Notion write from the Research Analyst. | Refused at write time |

## Model-judged questions

Plain-English yes/no questions in the rule files, put to the Validator's own judge for items that passed the built-in
checks and are new or changed, only when the model judge is enabled. A "no" is reported to the owner as `MJ01`,
`MJ02`, ... by question number within the file; it is never sent to a bot. The CEO's questions are asked of task
rows, the Package Designer's of packages-page toggles.

| Rule | What it checks | When |
|---|---|---|
| MJ01 (task board) | Could the assigned person start this task today from the brief alone? | Flagged in the sweep |
| MJ02 (task board) | Does the brief say clearly what "done" looks like? | Flagged in the sweep |
| MJ03 (task board) | Is the task a step toward winning or keeping clients in the target market? | Flagged in the sweep |
| MJ04 (task board) | Is the package's audience the customers the owner's current direction names? | Flagged in the sweep |
| MJ01 (packages) | Is the audience a specific buyer rather than "businesses"? | Flagged in the sweep |
| MJ02 (packages) | Does the rationale rest on the cited pages rather than general claims? | Flagged in the sweep |

The Outreach Writer, Research Analyst and Scout files also hold model-judged questions (is the opening line an observed
gap, does the note say only what its page says, are the free terms an ongoing allowance), but today the judge is put
only to task rows and packages-page toggles, so those questions are not yet asked.

## Retired

Not enforced, listed so the ids are not reused by accident: **T03** (assignee check; replaced by MG05, the owner
assigns people), **T04** (Dead Line required; a task may now have no deadline, T11 still applies to one that is set),
and **G01** (judging The CEO's own goal; tried and withdrawn).

## Changing the rules

The rules are plain Markdown in `validator/instructions/`, one file per bot, each line a rule id followed by the
instruction the bot is told and the reason the rule exists. Edit a line to change the wording, delete it to stop
enforcing it, or add `[warn]` to make it a report-only warning. Any change to these files makes the Validator's next
run a full re-check of everything already written, not just new items. Which rules are refused before the write
(rather than flagged afterwards) is the `GATE_REFUSES` set in `validator/gate.py`.

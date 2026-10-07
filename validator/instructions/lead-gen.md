# Lead Gen — output format instructions

The bot's own policy (`policy._check_lead`) enforces LD01–LD04 before it writes, so a flag here means drift, a
hand edit, or a rule that changed after the row was written.

Lead Gen's output is rows on the Leads board: Business (title), Website, Business email, Location,
Industry, Company size, Pain point, How we can help (one of the packages), Evidence (URL), Stage,
Found on, Source pages, Found by. A defect is a message to Lead Gen naming the row and the fields to fix
with its `update_lead` action; Stage stays the owner's to move.

## Lead row

- LD01 — Business, Website and Business email are all present; the email is on the business's own domain, or printed on a page of its own site, never a personal mailbox provider (gmail, yahoo, hotmail, outlook, icloud, proton, ...).
- LD02 — Pain point and an Evidence URL are present, and the evidence is on the business's own site or a job board it uses (Greenhouse, Lever, Workable, Ashby, LinkedIn jobs).
- LD03 — How we can help is exactly one of the package names on the owner's Packages page.
- LD04 — One row per website domain: a second row for the same business is a duplicate.
- LD09 — The Business email is really published by that business: the Validator fetches the row's own website, evidence and source pages plus the usual contact and franchise paths, and looks for the exact address. An address it cannot find on any page it could read is not one to email. Blank it, or put the contact form's page there instead. Rows Lead Gen listed itself are not re-checked: its policy already read the address off a rendered page of the site. A site that cannot be fetched at all counts as unverifiable, not as fake.
- LD08 — Company size is a size, or blank: locations, employees, or both — "~400 locations", "40 staff", "~11 locations, 120 staff". Not a description of the business: what they do belongs in Industry, what is wrong with their site in Pain point.
- LD11 — Founded by holds the founder's name, the person outreach opens with. Once the website is known the rest can be looked up, so a blank here is work still to do, not a dead end. [warn]
- LD07 — Location, when filled, reads City, State, Country: "Springfield, IL, USA", "Manchester, England, UK". A bare country ("USA", "UK"), a single value, or a street address is not enough; where a country has no states, City, Country will do. Blank is fine and is better than a city nobody read off their pages.
- LD10 — There is an Evidence URL: a page showing the pain point is real. An imported row usually has none, which is worth knowing before anyone writes to them. [warn]
- LD12 — Source pages holds page URLs, one per line, never prose.
- LD13 — The Business email is a desk that buys: not press@, media@, marketing@, careers@, jobs@, legal@ or the like. [warn]
- LD14 — Website is the business's own site, never a directory, association or social page (thebfa.org, franchiseoverview.com, LinkedIn, Yelp...). A row whose site is a directory has a directory's email and evidence too, and is not a lead.
- LD15 — A filled-in Founded by is a person's name (First Last), never a phrase, a company, a role or "N/A": a founder nobody read off a page is an invention. Refused at write time.
- LD16 — A report of finished work matches the record: every business a 'done' names has an accepted update_lead (or lead) in Lead Gen's own episode log since the work list went out. A 'done' without a write is an invented output. Write first, watch the verdict, then report.
- LD18 — The Business email is deliverable: a row whose "Email check" (the engine's verification service) starts "NOT deliverable" needs a working address from the business's own site, or the row comes off the board. "Email check" is deliverability; LD09 stays the proof the address is the business's own.
- LD19 — A reminder for the owner, not a bot defect: a row whose Result (set by the team; bots never write it) is still "Emailed" 10 or more days after its Result date has had no reply, meeting or other outcome recorded. Follow up or set the Result. With no Result date, the row's last edit counts, and the flag says so. [warn]
- LD20 — The Whatsapp cell, when filled, is https://wa.me/<digits> for a number an opened page prints: the business's own site or a business listing, as a wa.me link, a number labelled WhatsApp, or a plain phone number (a national number gets [leads] whatsapp_country_code). Never a number from nowhere, from a checker or from a guess. Refused at write time when misshapen; flagged in the sweep when none of the row's pages prints it. A row whose Status is "WhatsApp Verified" or "False Whatsapp Number" was settled by a person in WhatsApp Web and needs no page proof; a False number is cleared by the Validator, ruled out at the gate, and Lead Gen is asked for another.
- LD05 — No personal data: Pain point, Location, Industry and Company size carry no phone number and no second email address. [warn]

## Owner notes (not checked automatically)

- Stage is Lead Gen's to set at creation (New); the owner moves it afterwards.

- Deleted cells: a cell the marketing team emptied held a wrong value. The Validator reports it to The CEO, who assigns a family member to find the correct value; Lead Gen fills it only when assigned. (Until this evening a deletion meant "useless, never refill".)


## Model-judged at write time (gate 3: one small-model yes/no per write; the engine asks, fails open)

- MG03 [lead] — For each field listed under "The write" (founded_by, location, size -- only the ones present), does the cited page text state it? A field not listed is allowed to be empty: never answer no because a founder, size or anything else is missing. A value counts as stated when the page gives the same fact in another form: a street address or a list of addresses states the City, State, Country ("123 Main St, Greenville, SC 29601" states "Greenville, SC, USA"); a list of 46 locations states "46 locations"; "founded in 2012 by Jane Ross" states the founder. Answer no only when a listed value is absent from the page, belongs to another business on it, or is a guess.
- MG03 [update_lead] — For each field listed under "The write" (founded_by, location, size -- only the ones present), does the cited page text state it? A field not listed is allowed to be empty: never answer no because a founder, size or anything else is missing. A value counts as stated when the page gives the same fact in another form: a street address or a list of addresses states the City, State, Country ("123 Main St, Greenville, SC 29601" states "Greenville, SC, USA"); a list of 46 locations states "46 locations"; "founded in 2012 by Jane Ross" states the founder. Answer no only when a listed value is absent from the page, belongs to another business on it, or is a guess.
- Empty cells on old rows: on a row made before `lead_message_only_since` (validator/config.toml) an empty cell is never flagged; a wrong value on it still is.
- Email domain: the Business email may be on another domain than the Website when that exact address is printed on a page of the business's own site (LD09 checks it); gmail, yahoo and other personal mailboxes stay refused (LD01).

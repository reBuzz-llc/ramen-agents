# The Leads board

One board holds every lead: one row per business. The bots fill it, and the people on your team work it. It lives on
this Mac, in `common-data/local-board.sqlite3`, and the dashboard shows it at http://127.0.0.1:3000/boards/leads:
sort and filter by any column, edit a cell in place, add a row, import a CSV (columns matched by name; an import never
overwrites a filled cell) and export the board as CSV. Nothing needs creating: the board is there after
`sh scripts/install.sh`. To run it on a hosted team portal instead, see [advanced.md](advanced.md).

## Who writes what

The starter ships no Lead Enricher and no Outreach Writer: the cells marked "your team" are yours to fill, and a
member you add later fills only the empty ones. Bots only ever fill an empty cell or their own column. The Validator checks every write before it lands and reports
anything off afterwards. The people on the team own Status, Result, Result date, Reviewed by and Sent by; no bot writes those.

| Column | What it holds | Written by |
|---|---|---|
| Business | the business's name, as its own site writes it | Lead Gen |
| Website | the business's own site; left empty for a business with no website | Lead Gen |
| Business email | an address the business publishes (its own domain, or a free-mail address it shows as its contact) | Lead Gen |
| Whatsapp | `https://wa.me/<digits>` for a number a page the bot opened prints | Lead Gen |
| Status | where outreach stands: Ready to Send Email, Email Sent, WhatsApp Verified, Waiting response for WhatsApp verification, False Whatsapp Number | your team (the Validator clears a number your team marks False and asks for another) |
| How can I help | the one package that fits, by its exact name | The CEO |
| Draft email | a first email for the team to read, edit and send, built on the package email | your team (an Outreach Writer fills it if you add one; the starter does not ship one) |
| Draft Whatsapp msg | a short first WhatsApp message (under 90 words), only for rows with a working Whatsapp | your team (an Outreach Writer fills it if you add one; the starter does not ship one) |
| Evidence | the page that shows the business and its gap (for a business with no site, its public listing) | Lead Gen |
| Contact person | the person to talk to: the highest person the business's own pages name (founder, owner, practice manager ...); a first name alone is fine | Lead Gen |
| Contact role | that person's role, one of eleven options | Lead Gen |
| Email check | the email verification service's verdict (deliverable or not) | the engine, when the lead is written |
| Industry | what the business does | Lead Gen |
| Pain point | three lines: `Pain point:` one gap someone saw and where, `They can try:` a fix they can do themselves, `We propose:` what your team does | Lead Gen, or your team where it is empty |
| Location | City, State, Country | Lead Gen |
| google map location | a Google Maps link to the business | your team |
| Result | the outcome: Not contacted, Emailed, Replied, Meeting, Client, Not interested, Bounced | your team |
| Result date | when the Result was set | your team |
| Reviewed by | who on the team reviewed the row | your team |
| Sent by | the person who sent the email; never a bot | your team |
| Source pages | the pages the facts came from, one URL per line | Lead Gen (appended) |
| Company size | locations, staff or both, as the business publishes it | Lead Gen |
| Founder LinkedIn | the contact's LinkedIn profile, or the business's company page | your team |
| LinkedIn found via | where that link came from: 1 Own site, 2 Business listing, 3 Press article, 4 Search result | your team |
| Tools on site | the tools the business's homepage runs on (site builder, ordering, booking, ad pixels) | the Validator |
| Site health | https, set up for phones, copyright year, PDF menu, load time, date checked | the Validator |
| Lead score | 0-100: fit, ability to pay, reach and readiness; your team works the highest first | the Validator |
| ID | the row's id | the board |
| Created time | when the row was made | the board |

## The rules behind it

The Validator's rules for this board are in `validator/instructions/lead-gen.md` (the LD rules), `lead-enricher.md` (EN)
and `outreach-writer.md` (OW); the EN and OW rules are for a Lead Enricher or an Outreach Writer if you add one. Each one carries the reason it exists. The ones the gate enforces before a write
are marked "refused at write time"; the rest are flagged in the Validator's report.

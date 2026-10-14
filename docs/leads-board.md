# The Leads board

One Notion database holds every lead: one row per business. The bots fill it, and the people on your team work it. Create
it with:

```
python3 scripts/create_leads_board.py --parent <your Notion page id or URL>
```

Share that page with your Notion integration first. The script prints the board's data source id; paste it into
`lead-gen/config.toml` (`[leads] database_id`, then `enabled = true`) and `validator/config.toml`
(`[validator] leads_data_source_id`). Run it again and it refuses, because the board already exists.

## Who writes what

Bots only ever fill an empty cell or their own column. The Validator checks every write before it lands and reports
anything off afterwards. The people on the team own Status, Result, Result date and Reviewed by; no bot writes those. "Sent by" records which person sent the email; the Validator copies it from Notion's last editor when Status becomes Email Sent.

| Column | What it holds | Written by |
|---|---|---|
| Business | the business's name, as its own site writes it | Lead Gen |
| Website | the business's own site; left empty for a business with no website | Lead Gen |
| Business email | an address the business publishes (its own domain, or a free-mail address it shows as its contact) | Lead Gen |
| Whatsapp | `https://wa.me/<digits>` for a number a page the bot opened prints | Lead Gen, Lead Enricher |
| Status | where outreach stands: Ready to Send Email, Email Sent, WhatsApp Verified, Waiting response for WhatsApp verification, False Whatsapp Number | your team (the Validator clears a number your team marks False and asks for another) |
| How can I help | the one package that fits, by its exact name | The CEO |
| Draft email | a first email for the team to read, edit and send, built on the package email | Outreach Writer |
| Draft Whatsapp msg | a short first WhatsApp message (under 90 words), only for rows with a working Whatsapp | Outreach Writer |
| Evidence | the page that shows the business and its gap (for a business with no site, its public listing) | Lead Gen |
| Contact person | the person to talk to: the highest person the business's own pages name (founder, owner, practice manager ...); a first name alone is fine | Lead Gen, Lead Enricher |
| Contact role | that person's role, one of eleven options | Lead Gen, Lead Enricher |
| Email check | the email verification service's verdict (deliverable or not) | the engine, when the lead is written |
| Industry | what the business does | Lead Gen, Lead Enricher |
| Pain point | three lines: `Pain point:` one gap someone saw and where, `They can try:` a fix they can do themselves, `We propose:` what your team does | Lead Enricher (Lead Gen may leave it empty) |
| Location | City, State, Country | Lead Gen, Lead Enricher |
| google map location | a Google Maps link to the business | Lead Enricher |
| Result | the outcome: Not contacted, Emailed, Replied, Meeting, Client, Not interested, Bounced | your team |
| Result date | when the Result was set | your team |
| Reviewed by | who on the team reviewed the row | your team |
| Sent by | the person who set Status to Email Sent, taken from Notion's last editor; never a bot, never over a filled cell | the Validator |
| Source pages | the pages the facts came from, one URL per line | Lead Gen, Lead Enricher (appended) |
| Company size | locations, staff or both, as the business publishes it | Lead Gen, Lead Enricher |
| Founder LinkedIn | the contact's LinkedIn profile, or the business's company page | Lead Enricher |
| LinkedIn found via | where that link came from: 1 Own site, 2 Business listing, 3 Press article, 4 Search result | Lead Enricher |
| Tools on site | the tools the business's homepage runs on (site builder, ordering, booking, ad pixels) | the Validator |
| Site health | https, set up for phones, copyright year, PDF menu, load time, date checked | the Validator |
| Lead score | 0-100: fit, ability to pay, reach and readiness; your team works the highest first | the Validator |
| ID | a row number (LEAD-n) | Notion |
| Created time | when the row was made | Notion |

## The rules behind it

The Validator's rules for this board are in `validator/instructions/lead-gen.md` (the LD rules), `lead-enricher.md` (EN)
and `outreach-writer.md` (OW). Each one carries the reason it exists. The ones the gate enforces before a write
are marked "refused at write time"; the rest are flagged in the Validator's report.

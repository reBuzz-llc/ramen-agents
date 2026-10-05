# Package Designer — output format instructions

The code fence is `policy.py` `_check_package`; your own domains come from `[handoff] own_domains`.

The Package Designer's outputs are the package files it hands to The CEO
(`the-ceo/raw/packages/*.md`), and, through the CEO's `publish_package`, the "Sources & company"
section of each toggle on the Notion packages page. Both are checked.

## Packages-page toggle: sources and company facts (the "Sources & company" section)

- PS01 — At least one source: the competitor or agency pages that were actually opened and show these services and prices.
- PS02 — No search-results page as a source. An HN Algolia or SearXNG results URL is where the bot looked, not what it read; cite the agency pages opened from it.
- PS03 — Never our own site as a source (the domains in own_domains). We are the seller, not the evidence.
- PS04 — The reference company's name and website are recorded (Company: ..., Website: ...): the agency whose pricing page was opened.
- PS05 — The recorded website is the site of one of the sources, not another company the bot knows of.
- PS06 — No version tag in the package name ("v2", "v3", "version 2"): the same offer is never re-sent; a reshaped offer gets a name that says what changed.

## Package file handed to The CEO (the-ceo/raw/packages/)

- PD01 — A crisp name without version tags. One distinct service per package; a different service from any package already sent.
- PD02 — A price with a figure in it: a fixed price, a range, or a monthly retainer ("$4,000–6,000 fixed", "$3,200/month").
- PD03 — Two to six concrete deliverables a client would recognise.
- PD04 — At least one source, and every source is a page the bot opened: the agency's pricing page and its about/team page. No search-results URLs.
- PD05 — Never our own site among the sources.
- PD06 — Source company facts: at least the company's name and website, taken from its pages. Founded, team size, location and valuation only when the pages state them; blank is correct, a guess is not.
- PD07 — The source company's website is one of the sources.

## Model-judged (plain-English questions; used only when use_model = true)

- Is the audience a specific buyer ("pre-seed founder with a validated idea"), not "businesses"?
- Does the rationale rest on the cited pages rather than on general claims?

## Owner notes (not checked automatically)

- Research first; hand over only when the notes support it (two sources actually opened, a figure, recognisable deliverables). At most one package per episode, four a day.
- Directory sites (Clutch, GoodFirms, Crunchbase) answer 403 from this Mac; the honest source is the agency's own pricing and about pages.
- Prices are proposals backed by evidence; the bot never promises anything to a client and never contacts anyone.

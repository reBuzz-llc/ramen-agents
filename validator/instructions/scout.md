# Scout — output format instructions

The owner's rules: no payment methods; trial credit is not free; only durable, card-free free tiers count.
The code fence is `policy.py` `_check_provider`.

The Scout's output is the provider records in `common-data/providers-found.md`, one `## Name`
section each, which the owner reads before creating a key.

## Provider record

- SC01 — Endpoint is the provider's https:// API base URL (an OpenAI-compatible endpoint), not a marketing page or a console.
- SC02 — Free terms are stated and say the tier needs no card ("no card required"). A card on file means it can bill, so it is not for us.
- SC03 — Not a provider the fleet already has or knows: Groq, Google Gemini, Cerebras, Mistral, SambaNova, OpenRouter, Together, DeepSeek, OpenAI, Moonshot, Replicate. The job is to find ones not on that list.
- SC04 — Not a niche provider the fleet cannot use: skip roleplay- or storytelling-only, image-only, speech-only and embeddings-only services. Record only general assistant, writing or coding models.
- SC05 — At least one source page the bot actually read about this provider.
- SC06 — At least one source is on the provider's own site (its pricing or docs page), not only a listicle or an awesome-list. [warn]
- SC07 — Durable free tier only: no one-off trial credit ("$5 free to start"), no pay-as-you-go with no free tier, no free tier that needs a card.

## Questions for a person reviewing by hand (retired from model judging 2026-10-14: only task rows and package toggles are model-judged; these overlap the exact rules above and would cost a page read per item on the shared free tier)

- Does the free-terms text describe an ongoing monthly or daily allowance rather than a one-time credit?

## Owner notes (not checked automatically)

- Records under the "# Declined by the owner" heading of providers-found.md (or with a **Declined:** line) are the owner's decisions and are not checked; the Scout still sees their names so it never re-records them.
- The Scout never signs up, creates an account, or makes a key; that is the owner's step.
- One real find beats ten re-recordings; a stretch with no find is fine, lowering the bar is not.

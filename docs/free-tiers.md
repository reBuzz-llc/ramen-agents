# Free tiers: the models and search engines the family runs on

The family runs on free tiers only: no trial credit that turns into a bill and no paid plan, even a cheap one. Not every
provider's page says whether a card is needed, so keep a card off these accounts: with one on file, some providers bill
past the free amount. If a provider asks for a payment method before it answers, it is not used. The person running the
family signs up and creates every key by hand; **bots never sign up, log in or create keys**.

## Where keys go

Each key is one file: `common-data/keys/<name>.key` (for example `common-data/keys/groq.key`), holding only the key.
Lock it down with `chmod 600 common-data/keys/*.key`. The folder is in `.gitignore`, so a key is never committed. Each
provider's `api_key_file` in `common-data/configs/web-bots.toml` points at its file.

## How the chain works

Every web bot uses one shared list of providers, `provider_chain` in `web-bots.toml`, tried in order. A provider that
answers "rate limited", "over quota" or "down" is benched for a while (its `cooldown_minutes`), and the next one
answers. A provider with a `calls_per_day` cap is counted for the whole machine, so a stopped bot holds nothing back.
With every provider out, a member rests until one is back. No model runs on your Mac unless you add a local one yourself
(`fallback_provider = "ollama"` in `common-data/configs/local.toml`). Put the most generous
free tier first and the scarce ones last. A bot that needs a different order sets `model.provider_first`; it never gets
its own list.

**Use every free tier.** An allowance you do not use today is gone tomorrow. The dashboard's **Allowance** panel shows each
provider's calls and tokens today against its tier, and what is left, so you can see which free tier sits idle and
move it up the chain (see [dashboard.md](dashboard.md#allowance-use-every-free-tier)).

`bot --config <bot>/config.toml providers` prints the chain with today's calls and tokens per provider. An example
(made-up numbers):

```
1. zai: KEY - glm-4.5-flash - free model ($0 list price); its page does not state whether a card is needed
     today: decide 120 calls/800000 tok; write 40 calls/240000 tok
```

## Model providers

"Measured" means the family hit or observed the number itself. "Our cap" is a limit we set in config, not the
provider's. Everything else is "not measured".

| Provider | Free tier | What we measured | Our cap | Sign up |
|---|---|---|---|---|
| Z.ai (`zai`, glm-4.5-flash) | the flash models are listed at $0; the page does not state whether a card is needed; limits not published | about 1,575 calls and 9.4M tokens in one day (2026-10-14) with no limit hit | 3,000 calls/day | https://z.ai |
| Gemini (`gemini`) | free tier with an AI Studio key; the page does not state whether a card is needed. Its [terms](https://ai.google.dev/gemini-api/terms) say "Do not submit sensitive, confidential, or personal information to the Unpaid Services", so neither the agents nor the Validator's review give it lead data until you say yes in `sh scripts/add-key.sh gemini` | the larger flash model answered 429/503 at busy times; the lite model answered; limits not measured | none | https://aistudio.google.com/apikey |
| Groq (`groq`, gpt-oss-120b) | free tier; the page does not state whether a card is needed | about 8,000 tokens per minute and about 200,000 tokens per day; tokens run out before requests do | 900 calls/day | https://console.groq.com/keys |
| OpenRouter (`openrouter`, a `:free` model) | `:free` models only; the page does not state whether a card is needed | about 50 calls a day without credit; the free model often answers 429 upstream | 50 calls/day | https://openrouter.ai/keys |

**Not in the default chain** (checked 2026-11-21). These can charge, or stop at a credit, so a key file alone never switches
them on and cannot spend money by accident:

- **Mistral:** its docs say Free mode "doesn't include API access" and that "creating API keys and using the API require
  billing activation and pay-as-you-go" ([usage limits](https://docs.mistral.ai/admin/billing-usage/usage-limits)).
- **Ollama Cloud:** its $0 plan is "Pay per token for every cloud model" ([pricing](https://ollama.com/pricing)). A local
  Ollama model is separate, and only runs if you turn it on.
- **Speka:** a "$1 lifetime credit on every account", then pay per token ([speka.me](https://speka.me/)).

If you pay for one and want it, add its name to `provider_chain` in `common-data/configs/local.toml`, with a `calls_per_day`
cap.

## What each provider says about your prompts

Each prompt goes to the provider that answers it. We read these pages on 2026-11-23. Terms change, so read them again
before you add a key.

- **Z.ai:** for API users, its [terms](https://docs.z.ai/legal-agreement/terms-of-use) (updated April 14, 2026) say "we
  will not use your User Content for developing or improving Services unless you explicitly agree to such use." Its
  [privacy page](https://docs.z.ai/legal-agreement/privacy-policy) (updated September 29, 2025) says it does "not store
  any of the content the Customer or its End Users provide or generate". Other customer data is stored temporarily and
  deleted after the terms end, unless the law requires otherwise.
- **Gemini (free tier):** Google's [terms](https://ai.google.dev/gemini-api/terms) say it uses what you submit "to
  provide, improve, and develop Google products and services and machine learning technologies", that "human reviewers
  may read, annotate, and process your API input and output", and "Do not submit sensitive, confidential, or personal
  information to the Unpaid Services."
- **Groq:** its [data page](https://console.groq.com/docs/your-data) (no date shown) says it "does not retain customer
  data for inference requests" by default. It may log inputs and outputs for up to 30 days to troubleshoot reliability
  or investigate abuse, longer if the law requires, and you can opt out in Data Controls. The page does not say whether
  API data trains models.
- **OpenRouter:** its [privacy policy](https://openrouter.ai/privacy) (updated August 31, 2026) says "OpenRouter does not
  use your Inputs or Outputs for model training" and "Some Model Providers may use your Inputs and Outputs for model
  training or improvement." Its [logging guide](https://openrouter.ai/docs/guides/privacy/logging) describes an account
  setting that stops routing to providers that may train, with separate settings for paid and free models. Neither page
  states the rule for `:free` models, so check that setting before you add the key.

## Search engines

| Engine | Free tier | How the family uses it | Sign up |
|---|---|---|---|
| FreeSerp | keyless | a keyless web search | none |
| SearXNG | runs on your own Mac (127.0.0.1:8888); keyless | the main search; settings in `common-data/configs/searxng-settings.yml` | none (self-hosted) |
| DuckDuckGo MCP | keyless | a web search, search only | none |
| LangSearch | free plan; the page does not state whether a card is needed | the first backup, used only when the local search fails or finds nothing; never named by a bot | https://langsearch.com |
| Parallel | $5 of free credit a month with a card on file (its page); past that it bills per use, so leave it out to stay card-free | not in the default search path: add `parallel` to a member's `search_engines` by hand to use it, after LangSearch | https://parallel.ai |
| Tavily | 1,000 credits a month; its pricing page: "No credit card required" | The CEO only, for special searches; never automatic | https://tavily.com |

Our daily caps for the keyed backups are set in `web-bots.toml`: `langsearch_per_day` (100) and `parallel_per_day`
(30). A search engine that rate-limits or bot-checks one bot is paused for every bot (`search_pause_file`).

## Adding a provider

1. Check that its free tier needs no card and is not a time-limited trial.
2. Create the key yourself and save it as `common-data/keys/<name>.key` (`chmod 600`).
3. Add a `[model.providers.<name>]` table to `web-bots.toml` with `base_url`, `model`, `api_key_file` and a
   conservative `calls_per_day`, then add `<name>` to `provider_chain` in the place its free tier deserves. If the free
   tier is counted in tokens, add `tokens_per_day` or `tokens_per_month` from its pricing page; the Allowance panel
   then shows tokens left too (a monthly tier as today's fair share).
4. Run `bot --config <bot>/config.toml providers` to confirm it answers, and watch its line for a day before trusting it.

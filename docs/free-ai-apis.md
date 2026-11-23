---
title: "Free AI APIs that actually work, tested this week"
description: "Six AI model APIs with a free tier that answered our own check this week: what each gives for free, in the provider's own words, and the catch."
permalink: /free-ai-apis.html
---

**Last checked: 21 November 2026.** Every provider below answered our own check this week, and every allowance
is quoted from the provider's own pages, linked under each entry. Where a provider prints no number, we say "not
published"; we do not repeat numbers from lists or forums.

"Answered our agents' calls" means our agents got real replies from it on that day. "The API answered" means its
API address replied to our check; we have not yet sent it real work.

## Groq

Fast hosted open models, such as gpt-oss-120b and Qwen, behind an OpenAI-compatible API.

- **Free:** a Free plan with limits set per model. For gpt-oss-120b: 30 requests a minute, 1,000 requests a day,
  8,000 tokens a minute and 200,000 tokens a day.
- **Card:** not stated for the Free plan. Groq asks for a payment method to upgrade from it.
- **Last tested:** 21 November 2026, answered our agents' calls.
- **The catch:** on a busy day you hit the token limits long before the request limits. Groq calls its table a
  summary; your own limits are on the console's Limits page.
- Sources: [rate limits](https://console.groq.com/docs/rate-limits),
  [billing FAQ](https://console.groq.com/docs/billing-faqs)

## Google AI Studio (Gemini API)

Google's Gemini models: the Flash and Flash-Lite models are free of charge on the Free tier.

- **Free:** "Free of charge" on the Free tier for the Flash and Flash-Lite models. Their per-model limits: not
  published; Google shows them only inside AI Studio.
- **Card:** not stated for the Free tier, which needs a Google account and a project; some projects need
  verification. A billing account is for the paid tiers.
- **Last tested:** 20 November 2026, answered our agents' calls until the free daily quota ran out.
- **The catch:** on the Free tier, Google says content is "used to improve our products", so keep private data out.
  Limits "are not guaranteed".
- Sources: [pricing](https://aistudio.google.com/docs/pricing),
  [rate limits](https://aistudio.google.com/docs/rate-limits)

## Z.ai (GLM Flash models)

GLM models from Z.ai behind an OpenAI-compatible API.

- **Free:** GLM-4.7-Flash, GLM-4.5-Flash and GLM-4.6V-Flash are listed as Free for input, cached input and output.
  Rate limits: not published; Z.ai says quotas differ by account.
- **Card:** not published.
- **Last tested:** 21 November 2026, answered our agents' calls.
- **The catch:** with no published limit, you learn yours by using it. Older Flash models can be retired, so check
  the pricing page for the current list.
- Sources: [pricing](https://docs.z.ai/guides/overview/pricing), [FAQ](https://docs.z.ai/help/faq)

## OpenRouter (the ":free" models)

One API in front of many providers. Models whose name ends in `:free` cost nothing.

- **Free:** 20 requests a minute. 50 requests a day across the free models, or 1,000 a day once you have bought at
  least 10 credits in total.
- **Card:** not published.
- **Last tested:** 21 November 2026, answered our agents' calls.
- **The catch:** the free pool is shared and busy, and OpenRouter says free models "are usually not suitable for
  production use". Logging and training follow each upstream provider's policy, with a separate setting for free
  models.
- Sources: [limits](https://openrouter.ai/docs/api-reference/limits), [pricing](https://openrouter.ai/pricing),
  [FAQ](https://openrouter.ai/docs/faq),
  [logging](https://openrouter.ai/docs/guides/privacy/provider-logging)

## NVIDIA API Catalog

Hosted open models (Llama, Nemotron and more) from build.nvidia.com, behind an OpenAI-compatible API.

- **Free:** "a free trial tier with no credit card required", and free API access for prototyping while you are a
  member of the NVIDIA Developer Program (free to join). Request limits: not published.
- **Card:** not needed.
- **Last tested:** 20 November 2026, the API answered.
- **The catch:** NVIDIA allows it for prototyping, research, development and testing only; production use needs a
  paid licence.
- Sources: [API catalog FAQ](https://build.nvidia.com/llms.txt), [NIM API docs](https://docs.api.nvidia.com/nim/docs/product),
  [NIM](https://developer.nvidia.com/nim)

## Bytez

Open models through one API, plus access to closed models.

- **Free:** $1 of credit that refreshes every four weeks, open models up to 7B parameters, one request at a time.
- **Card:** not published.
- **Last tested:** 20 November 2026, the API answered.
- **The catch:** the free credit covers small open models only. For closed models, you pay their provider directly.
- Sources: [billing](https://docs.bytez.com/model-api/docs/billing), [pricing](https://bytez.com/api/pricing)

## Left off this week

- **Mistral:** its docs now say the Free mode "doesn't include API access"; using the API needs billing
  activation. ([usage limits](https://docs.mistral.ai/admin/billing-usage/usage-limits))
- **IBM watsonx.ai Lite:** a real monthly allowance, but IBM asks for payment details up front.
  ([free tier](https://www.ibm.com/cloud/free), [plans](https://dataplatform.cloud.ibm.com/docs/content/wsj/getting-started/wml-plans.html?context=wx))
- **Ollama Cloud:** its pricing page says "Pay per token for every cloud model". Running Ollama on your own machine
  stays free. ([pricing](https://ollama.com/pricing))
- **Speka:** its page says "$1 lifetime credit on every account. No credit card required." That is a one-off credit,
  not a free tier. ([speka.me](https://speka.me/))

A provider that asks for a card, gives only a one-off trial credit or needs a paid plan before its API answers
stays off this page.

## A whole team on these tiers

ramen-agents is a free, open-source team of five AI agents that looks for your next client, and it runs on free
tiers like these. Its chain tries one provider after another, so when one runs out for the day, the next one
answers.

[What ramen-agents does](index.html) · [We set it up for you](set-up-for-you.html) ·
[Which free tiers it uses](free-tiers.html)

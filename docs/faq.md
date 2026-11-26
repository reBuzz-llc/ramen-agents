---
eyebrow: "Questions"
title: "ramen-agents: questions people ask"
description: "Cost, models, safety, data, platforms and adding an agent: short answers about ramen-agents."
permalink: /faq.html
---

## Does it cost anything?

The software is free, and you pay $0 in model fees on the default free tiers, with keyless search. Free tiers can
change, and if you link billing on a provider's own account, it can charge you. The providers' own pages do not say
whether their free tier needs a card, so read the sign-up page before you add one. When a provider says it is out for
now, the next one answers. If every provider is out, the agent rests until one is back. You need one free model key
to start and a Mac that stays on.

## Which models does it use?

ramen-agents uses a chain of free model tiers, tried in order: Z.ai, Gemini, Groq and OpenRouter's free models. One
key is enough to start, from Z.ai, Groq or OpenRouter, and a provider without a key is skipped. With no key at all, a
member rests and names the command that adds one. The ten-minute demo needs no key.

Three providers left the default chain in November 2026, and you can still add any of them by hand. Mistral says
"Creating API keys and using the API require billing activation and pay-as-you-go." Ollama Cloud is pay per token.
[Speka](https://speka.me/) says "$1 lifetime credit on every account. No credit card required." After that it is pay per
token. A local Ollama model is not installed or used unless you add it yourself.

## Can an agent spend money or sign up for something?

No: a ramen-agents agent cannot spend money, sign up or log in, because it has no action for it, sign-in and sign-up
pages are blocked, and goals about paying or acquiring credentials are refused in code. The Validator also refuses
writes that break the owner's rules. See [FENCE.md](fence.html).

## Can I use my own OpenAI or Anthropic key?

Yes, if you add it yourself: the provider chain is a list in a config file and takes any provider with an
OpenAI-compatible API. The default chain is free tiers only, on purpose, and nothing in this repository asks you to add
a paid key.

## Does my data leave my machine?

Yes, your prompts do. Your boards, keys and the agents' memories stay in files on your Mac, but the default setup has no
local model, so every prompt, including the page text an agent read, goes to a provider you chose. A lead's email,
phone and known contact name are masked by default. The mask does not hide a person's name that is on no row yet, an
address spelled out in words, text inside an image, a phone number outside the usual US forms unless a row holds it,
or business names, which stay readable on purpose. Lead Gen's decision calls read pages to find new contacts, so they
run unmasked, only on Z.ai, Groq or OpenRouter. The Validator's reviews of tasks and packages use the same mask, leave
out the names of a task's assignees, and send nothing if the mask cannot run or the board copy that holds the contact
names cannot be read. Before you add a key, read [what each provider says about your prompts](free-tiers.html#what-each-provider-says-about-your-prompts). Google's
[terms](https://ai.google.dev/gemini-api/terms) for the free Gemini tier say "human reviewers may read, annotate, and
process your API input and output" and "Do not submit sensitive, confidential, or personal information to the Unpaid
Services", so no Gemini key is saved until you say yes.

## Does it need a Mac?

Yes: the full ramen-agents family runs on macOS only for now, because its installer and always-on setup (launch agents,
the dashboard as a service) are built for macOS. The engine and the ten-minute demo need only Python 3.11 or newer.

## How do I set it up?

Three commands on a Mac: `git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots`, then in
`~/bots` `sh scripts/install.sh` and `sh scripts/setup.sh`. The installer checks and installs what the family needs; the
setup asks who you are and who you sell to, helps you add one free model key and starts the family. An AI coding agent
can do it with you: point it at `AGENTS.md` on the `fleet` branch.

## Can someone set it up for me?

Yes: ReBuzz LLC, the company that built ramen-agents and runs it every day, sets it up for you. We install it on your
Mac, set the agents up for your business and start the first run with you. The software stays free and open source;
the setup is a paid service. [Message us on WhatsApp](https://wa.me/15163518016) and ask for a quote. More:
[We set it up for you](set-up-for-you.html).

## How do I update it?

To update ramen-agents, run `sh scripts/update.sh` in `~/bots`. Your own values live in git-ignored files, so the
update never meets an edit of yours; anything it has to move, it names. See [Updating](https://github.com/reBuzz-llc/ramen-agents#updating).

## How do I add an agent?

To add an agent, run `bot new "Name" --persona explorer --dir ~/bots`, which makes a folder with a config and a
persona; edit the persona in plain English, then `bot --config ~/bots/name/config.toml install` keeps it running.

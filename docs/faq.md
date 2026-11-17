---
title: "ramen-agents: questions people ask"
description: "Cost, models, safety, data, platforms and adding an agent: short answers about ramen-agents."
permalink: /faq.html
---

## Does it cost anything?

No: ramen-agents costs nothing to run, because every model and search service in its default chain has a free tier
with no card, and the engine counts each provider's daily limits so it never goes past them. You only need a Mac that
stays on.

## Which models does it use?

ramen-agents uses a chain of free model tiers, tried in order: Z.ai, Gemini, Groq, Speka, Mistral, OpenRouter's free
models, Ollama Cloud, then a local Ollama model. You add a key for each one you want; the rest are skipped. The
quickstart uses none of them.

## Can an agent spend money or sign up for something?

No: a ramen-agents agent cannot spend money, sign up or log in, because it has no action for it, sign-in and sign-up
pages are blocked, and goals about paying or acquiring credentials are refused in code. The Validator also refuses
writes that break the owner's rules. See [FENCE.md](fence.html).

## Can I use my own OpenAI or Anthropic key?

Yes, if you add it yourself: the provider chain is a list in a config file and takes any provider with an
OpenAI-compatible API. The default chain is free tiers only, on purpose, and nothing in this repository asks you to add
a paid key.

## Does my data leave my machine?

Your boards, keys and the agents' memories stay in files on your Mac, but each prompt, including the page text an agent
read, goes to the model provider that answers it. Choose providers you are comfortable with, or run everything on the
local model.

## Does it need a Mac?

Yes: the full ramen-agents family runs on macOS only for now, because its installer and always-on setup (launch agents,
the dashboard as a service) are built for macOS. The engine and the ten-minute demo need only Python 3.11 or newer.

## How do I set it up?

Three commands on a Mac: `git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots`, then in
`~/bots` `sh scripts/install.sh` and `sh scripts/setup.sh`. The installer checks and installs what the family needs; the
setup asks who you are and who you sell to, helps you add one free model key and starts the family. An AI coding agent
can do it with you: point it at `AGENTS.md` on the `fleet` branch.

## How do I update it?

To update ramen-agents, run `sh scripts/update.sh` in `~/bots`. Your own values live in git-ignored files, so the
update never meets an edit of yours; anything it has to move, it names. See [Updating](https://github.com/reBuzz-llc/ramen-agents#updating).

## How do I add an agent?

To add an agent, run `bot new "Name" --persona explorer --dir ~/bots`, which makes a folder with a config and a
persona; edit the persona in plain English, then `bot --config ~/bots/name/config.toml install` keeps it running.

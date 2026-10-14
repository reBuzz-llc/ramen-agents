---
title: "ramen-agents: questions people ask"
description: "Cost, models, safety, data, platforms and adding an agent: short answers about ramen-agents."
permalink: /faq.html
---

## Does it cost anything?

No. Every model and search service in the default chain has a free tier with no card, and the engine counts each
provider's daily limits so it never goes past them. You only need a computer that stays on.

## Which models does it use?

A chain of free tiers in order: Z.ai, Gemini, Groq, Speka, Mistral, OpenRouter (free models), Ollama Cloud, then a
local Ollama model. You add a key for each one you want; the rest are skipped. The quickstart uses none of them.

## Can an agent spend money or sign up for something?

No. There is no action for it, sign-in and sign-up pages are blocked, goals about paying or acquiring credentials are
refused, and the Validator refuses writes that break the owner's rules. See [FENCE.md](fence.html).

## Can I use my own OpenAI or Anthropic key?

The default chain is free tiers only, on purpose. The provider chain is a list in a config file, so you can add any
provider with an OpenAI-compatible API, but nothing in this repository asks you to.

## Does my data leave my machine?

Your boards live in your own Notion workspace, your keys stay in files on your machine, and the agents' memories are
local SQLite files. Page text goes to whichever model provider answers the call: choose providers you are comfortable
with, or run everything on the local model.

## Does it need a Mac?

The engine and the demo run anywhere Python 3.11 runs. The always-on setup (launch agents, the dashboard as a
service) is written for macOS.

## How do I add an agent?

`bot new "Name" --persona explorer --dir ~/bots` makes a folder with a config and a persona. Edit the persona in plain
English, then `bot --config ~/bots/name/config.toml install` keeps it running.

<script type="application/ld+json">
{
 "@context": "https://schema.org",
 "@type": "FAQPage",
 "mainEntity": [
  {
   "@type": "Question",
   "name": "Does it cost anything?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "No. Every model and search service in the default chain has a free tier with no card, and the engine counts each\nprovider's daily limits so it never goes past them. You only need a computer that stays on."
   }
  },
  {
   "@type": "Question",
   "name": "Which models does it use?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "A chain of free tiers in order: Z.ai, Gemini, Groq, Speka, Mistral, OpenRouter (free models), Ollama Cloud, then a\nlocal Ollama model. You add a key for each one you want; the rest are skipped. The quickstart uses none of them."
   }
  },
  {
   "@type": "Question",
   "name": "Can an agent spend money or sign up for something?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "No. There is no action for it, sign-in and sign-up pages are blocked, goals about paying or acquiring credentials are\nrefused, and the Validator refuses writes that break the owner's rules. See FENCE.md."
   }
  },
  {
   "@type": "Question",
   "name": "Can I use my own OpenAI or Anthropic key?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "The default chain is free tiers only, on purpose. The provider chain is a list in a config file, so you can add any\nprovider with an OpenAI-compatible API, but nothing in this repository asks you to."
   }
  },
  {
   "@type": "Question",
   "name": "Does my data leave my machine?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "Your boards live in your own Notion workspace, your keys stay in files on your machine, and the agents' memories are\nlocal SQLite files. Page text goes to whichever model provider answers the call: choose providers you are comfortable\nwith, or run everything on the local model."
   }
  },
  {
   "@type": "Question",
   "name": "Does it need a Mac?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "The engine and the demo run anywhere Python 3.11 runs. The always-on setup (launch agents, the dashboard as a\nservice) is written for macOS."
   }
  },
  {
   "@type": "Question",
   "name": "How do I add an agent?",
   "acceptedAnswer": {
    "@type": "Answer",
    "text": "bot new \"Name\" --persona explorer --dir ~/bots makes a folder with a config and a persona. Edit the persona in plain\nEnglish, then bot --config ~/bots/name/config.toml install keeps it running."
   }
  }
 ]
}
</script>

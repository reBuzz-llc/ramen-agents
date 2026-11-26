---
eyebrow: "Claude Code"
title: "How do I run ramen-agents with a team of Claude Code sessions?"
description: "One session plans and reviews, builder sessions build from its numbered specs, and a few rules keep them from stepping on each other or on the agents."
permalink: /claude-code-team.html
---

You can look after ramen-agents with one Claude Code session. Once you change it every week, a small team of
sessions, each with one job, does more and breaks less. This page is how we run ours.

It is written for someone who uses Claude Code and has just installed ramen-agents. Nothing here is required: the
agents run without any Claude Code session at all.

## The roles

- **The lead.** Plans, writes the specs, reviews every commit, deploys, and restarts the agents. It does not build,
  not even a small fix. When something breaks, it diagnoses it and hands the fix to a builder in the same message.
- **Builders, one or two.** Each takes a spec from the lead, builds it, runs the tests, commits, and reports back
  with the commit. One can own the dashboard, another the engine and the Validator.
- **Marketing**, if you want one. Writes words and plans: posts, pages, the weekly numbers. It never writes code; a
  change it needs goes to the lead as a request.
- **Sites**, if your agents make web pages. Reviews what they make and helps only when a page is too poor.

Write each role into the folder's `CLAUDE.md` in a few lines, so every session reads who does what when it starts.
A ready template is on the `fleet` branch:
[docs/claude-team/CLAUDE.team.md](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/claude-team/CLAUDE.team.md).
Copy it into your folder as `CLAUDE.md`, fill in the placeholders and delete the roles you do not use.

## How work moves

1. **You give the lead a goal**, in plain words.
2. **The lead answers with a plan** and, once you agree, numbered specs: what to build, where, and how to check it.
   A spec names its number in every commit, so you can trace any change to the request behind it.
3. **A builder builds it** in its own git worktree, never by switching branches in a folder another session uses.
4. **The builder reports back** with the commit and what it tested.
5. **The lead reviews it**, lands it, restarts what needs restarting (the starter has `scripts/restart-bot.sh` for
   that), and tells you.

When you answer a question, answer in the chat where it was asked. A session that relays your words to another
quotes them exactly, so the other session can check what you said rather than trust a summary.

## The rules that earned their place

Each of these comes from something that went wrong once.

- **One heavy job at a time.** A test run, a build and a browser opening pages on the same Mac at once slow each
  other down and can break each other. Agree which session holds the Mac before a long job.
- **Land, then run.** Bring a change in, check it arrived, and only then start anything that uses it. A chain like
  `update; run` runs on the old code when the update fails.
- **Check before anything goes public.** The lead reads every public piece (the README, the docs, a post) for
  facts, for anything private, and for the commit's author and date, before it is pushed.
- **Your yes for each public piece,** until you say a channel may run by itself.
- **Dry-load a config line before handing it over.** Load the edited config once to see it parse; a broken line
  stops an agent.
- **A session never does what another was refused.** If one session's request was declined, the work comes back to
  you, not to a different session that might be allowed.
- **No session creates accounts, spends money or prints a key.** The same fence the agents have. Accounts and keys
  are yours to make; a session asks for each one.
- **Only you restart an agent you stopped.** A session may restart an agent after a change, but never one you
  stopped yourself.

## Good to know

- Sessions cost tokens from one allowance. A team that messages less and plans more lasts longer; one short daily
  check beats a loop that runs every few minutes.
- The agents' own fence is in the code and applies whoever edits the folder: [what no agent may do](fence.html).
- For one AI coding agent doing the setup, read `AGENTS.md` on the `fleet` branch:
  [how do I set it up?](faq.html#how-do-i-set-it-up)

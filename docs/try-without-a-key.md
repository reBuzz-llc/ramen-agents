---
title: "How do I try ramen-agents without a key?"
description: "Install the engine and run one research session in fake mode: no account, no API key, no network, about a second."
permalink: /try-without-a-key.html
---

You need Python 3.11 or newer, and nothing else: no account, no key, no network. The agent thinks with a built-in
heuristic model and reads a bundled set of eight local pages.

```sh
git clone -b engine https://github.com/reBuzz-llc/ramen-agents ramen-engine
cd ramen-engine
pip install -e .            # or: uv pip install -e .
bot new "My Explorer" --fake --dir ./demo-fleet
bot --config ./demo-fleet/my-explorer/config.toml demo
```

`bot demo` runs one research session in about a second and prints every step, then the journal entry the agent wrote.
Two steps show the fence: at step 6 the agent tries a login page and the policy refuses it, because agents never log
in; at step 15 it tries to save a note it already has.

```text
step 5: follow -> allowed (followed [2] to fake://clocks.html: 'The clock that found lo...)
step 6: open fake://login.html -> refused (URL path segment 'login.html' is on the denylist)
step 7: note 'The clock that found longitude' -> allowed
...
step 15: note 'Search: history of the internet' -> refused (you already saved a note titled ...)
```

**Next:** [the free tiers](free-tiers.html) for real models and search, then [the Leads board](leads-board.html) for
your first real lead.

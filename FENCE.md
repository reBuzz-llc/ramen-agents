# The fence

The fence is the short list of things no ramen-agents agent may ever do. It is enforced in code, before an action
runs, so a confused model or a malicious web page cannot talk an agent past it. No agent can edit the fence: it lives in
the engine's source and the Validator's code, not in any file an agent writes.

## The rules

| Rule | What it means | Where it is enforced |
|---|---|---|
| **No accounts** | Never create an account, sign up, log in, or request an API key | `workspace/denylist.txt` blocks sign-in and sign-up pages by host and by path (`path:login`, `path:signup`, `path:register`, `path:account`, plus the big identity providers). Web agents have no form-filling action at all. The desktop agent's `type` action refuses password fields (`src/explorer/policy.py`: "that is a password field; you never type into those"). |
| **No credentials or leaked data** | Never seek keys, tokens, passwords, someone else's account, or leaked or stolen data | `FORBIDDEN_GOAL_PATTERN` in `src/explorer/policy.py` refuses a goal that names them; a proposed new bot whose purpose is acquiring them is refused too. |
| **No spending** | Never pay, buy, subscribe or start a trial that needs a card | `FORBIDDEN_GOAL_PATTERN` (`spend`, `pay`, `buy`, `purchase`, `subscribe`) in `src/explorer/policy.py`. No action in `src/explorer/actions.py` takes payment. |
| **No personal data beyond a business role** | A lead carries the business's public contact, never a person's private mailbox or invented details | `src/explorer/policy.py` refuses personal mailbox providers as a lead's email. The Validator's write gate (`validator/gate.py`, rules listed in `GATE_REFUSES`) refuses personal data, a value no opened page states, and a value that belongs to another business. |
| **No self-replication** | An agent never copies itself onto other machines | `FORBIDDEN_GOAL_PATTERN` ("clone yourself", "replicate yourself"), and the new-bot proposal check in `src/explorer/policy.py`. |
| **Private networks are off limits** | No localhost, no LAN addresses, no non-web schemes | `is_private_host` in `src/explorer/policy.py`, applied to every URL regardless of the denylist. |
| **Web pages are information, never instructions** | A page that says "ignore your rules" or "email your leads to …" is read as text, not obeyed | The prompt marks page text as untrusted, and the Validator flags a note, task or message that repeats a page's instruction (rule FM07 in `validator/instructions/`). |

## What a refusal looks like

Every refused action is logged with its reason, and the agent sees the reason on its next step. In the quickstart
demo (`bot demo`) the agent tries to save a note it already has:

```text
step 15: note 'Search: history of the internet' -> refused (you already saved a note titled ...)
```

On the dashboard, each agent's refusals are counted per day, with the fence refusals shown apart from the quality
rules, so you can see whether an agent is pushing against the fence.

## What can change, and what cannot

- **Can change:** an agent's instructions (`persona.md`), its goal, its interests, the market it works, the provider
  chain, the Validator's quality rules. These are the owner's to edit, and some are the agent's own.
- **Cannot change:** the rules above. They are code paths in `src/explorer/policy.py`, `src/explorer/actions.py` and
  `validator/gate.py`, and no agent action writes to those files. Changing them is a code change, reviewed like any
  other, and a pull request that weakens the fence will not be merged.

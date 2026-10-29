"""Configuration loading. One TOML file, dataclasses per section, a few env overrides."""
from __future__ import annotations

import dataclasses
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .common.keys import key_file, keys_dir


def _common_data() -> Path:
    """~/bots/common-data (keys_dir()'s parent), where files every bot shares live."""
    return keys_dir().parent


@dataclass
class AgentConfig:
    name: str = "Roam"
    bio: str = "An automated exploration agent run by a human. It reads the web out of curiosity and keeps a journal."
    contact: str = ""
    mode: str = "fake"  # fake | web
    cycle_delay_seconds: float = 20.0
    # Owner, 2026-10-14 ("decrease post load ... longer and data oriented with more links"): one journal entry a day --
    # a data-led digest of the day's notes (with their sources), tasks, packages and messages -- instead of one per episode.
    journal_daily: bool = False
    # Files in this bot's routed folder (common-data/botBox/routed/<bot>/) shown whole in every prompt, e.g. the
    # Validator's weekly Results digest for The CEO (owner, 2026-10-10: "steer from results"). Globs; newest match each.
    briefing_globs: list[str] = field(default_factory=list)
    # Upper bound on the delay after budget-aware pacing stretches it (model.daily_token_budget). 0 = no cap.
    max_cycle_delay_seconds: float = 0.0
    seed_interests: list[str] = field(default_factory=lambda: ["how everyday things work", "history of the internet"])
    # A markdown file (relative to this config) describing who the agent is; injected into the
    # system prompt. Empty means the built-in explorer voice.
    persona_file: str = ""
    # Let the bot rewrite its own goal (the `revise_goal` action). The new goal is stored in
    # workspace/self_goal.md, injected into the prompt, and surfaced to the owner (chat + chatroom) to
    # review; the persona file is never touched, and the code safety fence is not a goal it can move.
    self_goals: bool = False
    # Every Nth episode is a breadth "desk triage": instead of digging one thread, the bot is shown all
    # its open threads and fresh intel and told to advance the most-ready one (produce a task) and note
    # the next step on the others -- so a many-front bot like the CEO juggles rather than tunnels. 0 = off.
    triage_every_episodes: int = 0
    # Every Nth episode is a "curiosity sitting": follow whatever genuinely interests you, off your goal,
    # with no pressure to produce -- freedom to wander and maybe stumble on something. 0 = off. Triage,
    # when both land on the same episode, wins.
    curiosity_every_episodes: int = 0
    # Every Nth episode is a "reflection sitting": read back over your recent journal and change one thing
    # about how you work -- revise your goal, adjust an interest, drop a habit. 0 = off. Precedence when
    # several land together: triage, then reflection, then curiosity.
    reflect_every_episodes: int = 0
    # Let the bot suggest a new bot/role it thinks the fleet is missing (the `propose_teammate` action),
    # recorded to common-data/proposed-bots.md for the owner to create. Reviewed, never auto-created.
    propose_teammates: bool = False
    # Free-form capability tags, surfaced in `bot list` and the daily review so the owner can see at a
    # glance which bots hold which core capabilities. "notion_writer" marks a bot that writes to the
    # owner's Notion workspace (tasks and/or the packages page); future bots opt in by adding their own
    # tags here. These are descriptive markers for the owner and the knowledge graph, not a permission
    # grant -- what a bot may actually do is still decided by the policy layer.
    tags: list[str] = field(default_factory=list)
    # Owner, 2026-09-26: a bot writes a short work plan (task, done-when test, checklist) for the job it is on,
    # ticks steps as writes land, ends it done or stuck; workspace/plan.json, shown in every prompt. The owner's own
    # goal and rules per bot come from common-data/work-plan.json (the webapp's Work plan page).
    plans: bool = True
    # Rest instead of a model call when there is nothing to do (creatorCC queue 6, 2026-10-28): a bot with a work list
    # ([leads] decide_glob or draft_queue_column) rests when the list is empty or its daily update cap is reached; any
    # other bot when every daily cap it has (tasks, messages) is reached. Never while an inbox message or an owner
    # message is unread. Logged as a "resting" event; it looks again after idle_minutes.
    idle_when_empty: bool = False
    idle_minutes: float = 30.0
    # Three day-blocked refusals in one episode end it (summarized as usual) and the bot rests idle_minutes before the
    # next, waking for a message (creatorCC queue 9, 2026-10-28: a bot kept repeating a day-blocked search or open
    # long after the block).
    day_block_rest: bool = False
    # A plan with no step ticked for this many hours ends "stuck" by itself (Package Designer sat 45 hours and 2,192 actions on
    # one plan with nothing done, 2026-10-14). 0 = never.
    plan_stuck_hours: float = 6.0
    # After a lead, update_lead, task, update_task or publish_package write, read the object back from Notion; only a
    # confirmed write counts (an unconfirmed one is recorded "failed:" and does not close an ask or tick a plan).
    readback_writes: bool = True


@dataclass
class ModelConfig:
    provider: str = "fake"  # fake | ollama | gemini | remote (provider_chain in order, then the local fallback)
    host: str = "http://localhost:11434"
    name: str = "qwen2.5:7b"
    temperature: float = 0.7
    num_ctx: int = 8192
    num_predict: int = 700
    timeout_seconds: float = 180.0
    max_retries: int = 2
    keep_alive: str = "30m"
    # provider = "gemini": Google's Generative Language API (free tier) as the primary brain, with
    # `fallback_provider` taking over automatically while Gemini is rate-limited, out of quota, or
    # unreachable. The key is never in this file: the env var is read first, then a file outside the
    # repo (launchd jobs have no shell env, so the file is the practical route).
    fallback_provider: str = "ollama"  # ollama | fake
    # Ordered remote providers, tried in order; the first one that answers wins. Empty means "just
    # `provider`". Entries: "gemini" or the name of a [model.providers.<name>] table. The local
    # fallback_provider is always last.
    provider_chain: list[str] = field(default_factory=list)
    # Providers this bot tries BEFORE the rest of provider_chain: an order, never a shorter list. The fleet shares one
    # chain (web-bots.toml), so a key is nobody's own and a stopped bot holds nothing back; a bot that wants the
    # strongest model first (The CEO) names it here and still falls through to everything the family has. Owner,
    # 2026-10-02: "let all resources be assigned to active members instead of blocking some member".
    provider_first: list[str] = field(default_factory=list)
    gemini_model: str = "gemini-3.6-flash"  # 2.5-flash is closed to new users (2026-09)
    gemini_api_key_env: str = "GEMINI_API_KEY"
    gemini_api_key_file: str = field(default_factory=lambda: key_file("gemini"))
    gemini_cooldown_minutes: float = 15.0  # after a 429, stay on the fallback this long before retrying
    # More Gemini models tried right after gemini_model when it is busy (503), rate-limited or down,
    # each benched on its own, e.g. ["gemini-flash-lite-latest"]. Same key, same free tier.
    gemini_fallback_models: list[str] = field(default_factory=list)
    # Gemini 3 thinks inside maxOutputTokens: a level ("low") for gemini-3* models, and an output cap floor (0 = the call's)
    gemini_thinking_level: str = ""
    gemini_max_output_tokens: int = 0
    # OpenAI-compatible providers (Groq, Cerebras, ...) for provider_chain, one table each so several
    # free tiers stack: [model.providers.groq] base_url, model (required), api_key_file (default
    # ~/bots/common-data/keys/<name>.key), optional api_key_env, cooldown_minutes (default 15; how long a
    # daily cap or unexplained 429 benches it), calls_per_day. "gemini" is the only built-in remote.
    providers: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Remote calls per provider per day, counted machine-wide in ~/.config/explorer/model_calls.json
    # so restarts, other bots and the dashboard's chat share the count; a capped provider is skipped
    # until tomorrow and the chain moves on. 0 = no cap. A named provider may set its own calls_per_day.
    calls_per_day: int = 0
    # Which calls go to the remote chain. "all": every call, remote first. "writing": the local model
    # decides every step, and only when it picks a note, task, publish or say does the remote chain
    # write that action from the same observation (journal entries and chat stay remote first). A
    # free tier like Groq's 8,000 tokens a minute holds about one full step a minute, so "all" spends
    # most of the day on the local fallback anyway; "writing" spends it on the output that shows.
    remote_for: str = "all"
    # Add a provider automatically when ~/bots/common-data/keys/<name>.key exists for a name in
    # config.KNOWN_PROVIDERS and it is not already in provider_chain. Owner drops a key, restarts, done.
    auto_discover_providers: bool = True
    # The remote free tokens per day to spread across the day (machine-wide, all bots share one ledger).
    # When set, a bot lengthens its own cycle whenever tokens are being spent faster than the clock, so
    # the budget lasts into the evening instead of being gone by mid-day. 0 = no pacing. See
    # Controller._paced_delay.
    daily_token_budget: int = 0
    # What the budget paces against: "fleet" = every bot's tokens on this Mac (the CEO's unpaced 4M tokens slowed Lead
    # Gen and the Package Designer to one action per 5 minutes, 2026-09-25); "bot" = this bot's own tokens only.
    budget_scope: str = "fleet"
    # "active" (owner, 2026-10-02: "active members should take max leverage"): one pool for the day,
    # fleet_token_budget, shared by the bots that are RUNNING right now in proportion to budget_weight. A stopped bot's
    # share flows to the others at once; a bot started later gets a share of what is left. budget_weight = 0 means this
    # bot is never paced and takes no share (The CEO); its spending still comes out of the pool.
    fleet_token_budget: int = 0
    budget_weight: float = 1.0
    # Owner, 2026-10-07: "remove token budget limit as we are using free tiers ... let ceoA manage token budget if
    # needed". The bot that holds the family's resources sees the day's free tokens by member and calls by provider in
    # its prompt, and steers the others by message. Nobody is paced by it.
    sees_fleet_usage: bool = False
    # Before a remote call that would not fit the provider's remaining tokens this minute, wait up to
    # this long for the budget to refill (read from x-ratelimit-* headers); longer means skip it for now.
    token_wait_seconds: float = 20.0


@dataclass
class BrowserConfig:
    headless: bool = True
    user_data_dir: str = "workspace/browser_profile"
    page_text_limit: int = 6000
    max_links: int = 40
    search_url: str = "https://search.brave.com/search?q={query}&source=web"
    fake_web_dir: str = "workspace/fake_web"
    navigation_timeout_seconds: float = 30.0
    # light = a plain HTTP fetch turned into text, with Chromium started only for pages that need
    # JavaScript or refuse plain clients (light_browser.py); chromium = Playwright for every page;
    # tor = text only over Tor (tor_browser.py). The tor backend never loads images, scripts or media,
    # searches a local onion directory instead of a search engine, and needs policy.allowlist_file.
    backend: str = "light"
    tor_proxy: str = "socks5h://127.0.0.1:9050"
    max_page_bytes: int = 2_000_000
    onion_directory_file: str = "workspace/onion_directory.json"
    # Search engines tried in order (search.py): marginalia (small independent sites; results are
    # CC-BY-NC-SA, so not for commercial bots), wikipedia, hn (Hacker News via Algolia), browser
    # (search_url, Brave by default, in Chromium; serves bot checks; `brave-web` is its old name). No engine needs a paid plan. Empty = marginalia,
    # wikipedia, hn (fake mode: the fake browser only; tor: the onion directory). An engine with no
    # results hands the query to the next one. An engine that answers with a rate limit
    # or a bot check is paused in search_pause_file, which every bot on this Mac shares by default
    # ("" = ~/.config/explorer/search_pause.json; fake mode keeps it in the workspace).
    search_engines: list[str] = field(default_factory=list)
    tavily_per_day: int = 30  # the fleet's shared daily budget for the `tavily` engine (1,000 free credits a month)
    langsearch_per_day: int = 100  # the fleet's shared daily budget for the `langsearch` backup engine
    parallel_per_day: int = 30  # the fleet's shared daily budget for the `parallel` second backup ($5 free credit a month)
    # The `places` engine (owner, 2026-10-07): the target market's places from Overture Maps' open data, a local SQLite
    # snapshot built by ~/bots/scripts/places_snapshot.py -- name, category, website, phone, socials, address, open/closed.
    places_db: str = ""          # e.g. "~/bots/common-data/places/<market>-places.sqlite"; "" = the engine is off
    # Words dropped from a business name before a places lookup: the market's own name and its short forms
    # (e.g. ["new", "york", "nyc", "ny"]), which a listing's name rarely carries.
    places_stop_words: list[str] = field(default_factory=list)
    ddg_mcp_command: str = ""  # the DuckDuckGo MCP server's executable; "" = ~/.local/opt/ddg-mcp/venv/bin/duckduckgo-mcp-server
    search_pause_file: str = ""
    # Each bot keeps a score per search engine and drops one that answered often and never led to a note. Changing this
    # value wipes those scores and drops once, at the next start: on 2026-09-29 the web engine was returning junk and
    # was dropped by The CEO and the Package Designer, who then searched only their own files for four days.
    search_stats_epoch: str = ""
    # A personal Marginalia key (free, by email to the operator); without the file the shared `public`
    # key is used, which is often over its per-minute quota.
    marginalia_api_key_file: str = field(default_factory=lambda: key_file("marginalia"))
    # The browser engine (Brave in Chromium) rests this long after every search, machine-wide, so the bots together stay
    # under the ~40 searches an evening that make it serve bot checks; the keyless engines answer in
    # between. 0 = no rest. Ignored in fake mode.
    search_web_interval_seconds: float = 180.0
    # A folder of the owner's own material (.md, .txt, .html) the bot searches before the web when
    # "corpus" is in search_engines (corpus.py): pasted competitor pages, pricing, guides, anything
    # behind a login wall the bot cannot reach itself. Relative to the bot folder. "" = none.
    corpus_dir: str = ""
    # The local SearXNG meta-search for the `searxng` engine (Google, Brave, DuckDuckGo, Startpage, Mojeek,
    # Wikipedia in one JSON query), run as a local launch agent on 127.0.0.1:8888.
    searxng_url: str = "http://127.0.0.1:8888"
    # Open a YouTube video as its caption transcript (transcript.py): keyless, read-only, so the bot reads what
    # is said instead of the watch page's title and comments. Falls back to the page when there are no captions.
    video_transcripts: bool = False
    video_transcript_languages: list[str] = field(default_factory=lambda: ["en"])


SEARCH_ENGINES = ("corpus", "yc", "searxng", "marginalia", "wikipedia", "hn", "browser", "brave-web", "tavily", "langsearch", "freeserp", "freeserp-sites", "parallel", "duckduckgo-mcp", "places")  # brave-web: old name of browser
PROVIDER_KEYS = frozenset({"base_url", "model", "api_key_env", "api_key_file", "cooldown_minutes", "calls_per_day", "kind", "reasoning_effort", "max_tokens"})

# OpenAI-compatible providers this project knows how to reach: drop a key at
# ~/bots/common-data/keys/<name>.key and, when model.auto_discover_providers is on, it joins the
# chain with no config edit (fallback.discover_providers). "free" is a human note for `bot providers`;
# the bots never sign up for these, that is always the owner's step (Plan 7). No OpenRouter (owner's
# rule). Model ids drift; `bot check` verifies each against the provider's catalogue.
KNOWN_PROVIDERS: dict[str, dict[str, str]] = {
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "openai/gpt-oss-120b", "free": "free tier, no card"},
    "cerebras": {"base_url": "https://api.cerebras.ai/v1", "model": "gpt-oss-120b", "free": "card required (2026-09-25: API access needs credits, $5 trial or $10 PayGo) -- declined", "auto": False},
    "gemini": {"base_url": "", "model": "", "free": "free tier, no card (built-in, not OpenAI-compatible)"},
    "mistral": {"base_url": "https://api.mistral.ai/v1", "model": "mistral-small-latest", "free": "free tier (activate La Plateforme free plan)"},
    "sambanova": {"base_url": "https://api.sambanova.ai/v1", "model": "Meta-Llama-3.3-70B-Instruct", "free": "free tier, no card"},
    # $1 of usage included every month, no card (owner's key 2026-09-22). gpt-oss-20b at $0.07/$0.30 per 1M tokens
    # makes that ~30 writing calls a day; cap it in the provider table so the month's allowance lasts.
    "speka": {"base_url": "https://speka.me/v1", "model": "openai/gpt-oss-20b", "free": "$1/month included, no card"},
    # Added 2026-09-22 (owner's keys): Z.ai's flash model is list-priced $0; Ollama Cloud has a free plan. Both no card.
    "zai": {"base_url": "https://api.z.ai/api/paas/v4", "model": "glm-4.5-flash", "free": "free model ($0 list price), no card"},
    "ollama-cloud": {"base_url": "https://ollama.com/v1", "model": "gpt-oss:120b", "free": "free plan, no card"},
    "together": {"base_url": "https://api.together.xyz/v1", "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "free": "trial credit only, then paid", "auto": False},
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat", "free": "pay-as-you-go, no free tier", "auto": False},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4.1-mini", "free": "paid, no free tier", "auto": False},
    "moonshot": {"base_url": "https://api.moonshot.ai/v1", "model": "kimi-k2-0711-preview", "free": "paid, no free tier", "auto": False},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "model": "google/gemma-4-31b-it:free", "free": "free :free models, no card (~50/day without credit)"},
    "replicate": {"base_url": "https://api.replicate.com/v1", "model": "meta/meta-llama-3-70b-instruct", "free": "PAID per second (trial credit only); kind=replicate", "kind": "replicate", "auto": False},
}


@dataclass
class PolicyConfig:
    pages_per_hour: int = 60
    per_domain_delay_seconds: float = 8.0
    max_actions_per_episode: int = 12
    # The same action refused this many times in a day is blocked until tomorrow (0 = off). Owner, 2026-10-14: do less, better.
    day_block_after_refusals: int = 3
    # Once the budget is used up, this many more note/ask/interest/rest/say actions are tolerated; then only summarize.
    budget_grace_actions: int = 2
    # Refused actions in a row that close the episode early. A small model that ignores "not allowed"
    # feedback used to retry the same action until the stall watchdog fired 15 minutes later, some 24
    # refused model calls per episode; now the episode ends after this many and the next one starts fresh.
    max_refusal_streak: int = 5
    max_open_questions: int = 40
    # Actions this bot may not use at all: refused as non-existent and left out of its prompt. Trimming, 2026-09-25:
    # ask / interest / revise_goal produced dozens of refusals a day and no output for the web bots.
    disabled_actions: list[str] = field(default_factory=list)
    # A write gate: a Python file exposing check(action: str, payload: dict, *, bot: str, min_details: int) -> list[str]
    # (the Validator's gate.py). Run once before a lead / update_lead / task / update_task / publish_package executes;
    # non-empty reasons refuse the write as "Validator rules: ...". Fails OPEN: a broken or slow gate is logged and the
    # write proceeds -- a checker must never stop the family. "" = off.
    write_gate: str = ""
    # Gate 3 (owner, 2026-09-26): the checker's model-judged questions at write time (validator/gate.py questions(),
    # rule ids MGnn in validator/instructions/<bot>.md). "" = off; "local" = Ollama write_gate_local_model on this Mac
    # (the bot's chain when Ollama is down); "chain" = the bot's own model. One call per question, {"ok", "why"},
    # cached by content hash in write_gate_model_cache, fail-open. Refusal: "Validator rules: MG01: <why>".
    write_gate_model: str = ""
    write_gate_local_model: str = "qwen2.5:7b"
    write_gate_model_cache: str = "~/bots/common-data/shared-state/write-gate-model.json"  # "~" is expanded where it is opened
    # Questions the agent may ask in one episode; beyond that it has to pursue them or summarize.
    max_questions_per_episode: int = 3
    # After this many refused questions in one episode (rephrasings, over the cap), asking is refused
    # for the rest of it: a small model otherwise retries the same question every step. 0 = no limit.
    max_refused_asks_per_episode: int = 2
    # A question chased this many times without being answered is retired, so the open list cannot clog.
    retire_question_after_pursuits: int = 3
    # Chat messages (say) the agent may send in one episode; it is a channel to the owner, not a diary.
    max_says_per_episode: int = 2
    # Chat messages (say) the agent may send the owner in one day. 0 = no cap. A reply to something the owner wrote
    # this episode is always allowed: the owner asked The CEO for "1 msg a day with a short list of things"
    # (2026-09-26, after 19 messages in a day), and a cap the owner can still talk through is what that means.
    max_says_per_day: int = 0
    max_pages_without_note: int = 3
    # Caps on notes, for a bot whose field is quiet and whose value is in reading, not writing (the Scout wrote two
    # notes per page read in 2026-09). 0 = no cap. A near-duplicate of a recent note is refused regardless.
    max_notes_per_episode: int = 0
    max_notes_per_day: int = 0
    # Only open addresses the bot has actually seen -- on a page's link list this episode, or visited before. A small
    # model otherwise types plausible-looking URLs (outdatedweb.com) that are guesses. `follow N` always works.
    open_only_seen_urls: bool = False
    # After this many page visits to one registrable domain in an episode with nothing written from it (no accepted
    # lead, update_lead or note since its first visit), further open/follow of that domain is refused for the episode
    # with a "move on" verdict. Deterministic. Lead Gen spent 95 of 257 visits on one site hunting a founder the site
    # never states (2026-09-25 night). 0 = off.
    domain_no_progress_cap: int = 0
    # The window the cap counts over. Per episode it reset every few minutes: Lead Gen hit the cap on one site, the
    # refusal streak closed the episode, the next episode opened the same site again -- 460 cap refusals and ~1,000
    # wasted model calls in 44 h (2026-09-27/28). A site that gave nothing stays closed for this long.
    domain_no_progress_hours: float = 24.0
    # Refuse a search that repeats one already run this episode (same words, or the same words pluralised /
    # reordered): for a bot that must open results rather than re-search. Off by default: the search-fallback tests
    # and an engine pause legitimately re-run a query.
    refuse_repeated_searches: bool = False
    # How much of the shorter query's words two searches share before the second is "the same search in other words".
    repeat_search_overlap: float = 0.75
    # Engines this bot may name itself in a search ({"type":"search","query":...,"engine":"tavily"}). Owner, 2026-10-02:
    # "keep tavily and use it for special sites (let ceo decide)" -- Tavily is a keyed service with 1,000 free searches a
    # month, the one exception to keyless search; it is never used automatically, only when The CEO chooses it.
    search_engines_on_request: list[str] = field(default_factory=list)
    # After a search engine answers with a bot-verification page, no searches for this long.
    search_cooldown_minutes: float = 30.0
    # After a plain rate-limit status (HTTP 429/503), a shorter pause: a per-minute quota clears on
    # its own, unlike being flagged as a bot. Each new rate limit restarts the pause.
    search_rate_limit_cooldown_minutes: float = 5.0
    max_rest_seconds: int = 600
    denylist_file: str = "workspace/denylist.txt"
    respect_robots: bool = True
    allow_private_networks: bool = False
    # A file of hosts this bot may read (one per line, subdomains included). Empty = no allowlist.
    # Required for browser.backend = "tor"; `bot onion-directory` writes it.
    allowlist_file: str = ""


@dataclass
class WatchdogConfig:
    heartbeat_interval_seconds: float = 60.0
    stall_minutes: float = 15.0
    repeat_threshold: int = 4
    max_model_failures: int = 5
    model_failure_backoff_seconds: float = 5.0


@dataclass
class PublishConfig:
    enabled: bool = False
    destinations: list[str] = field(default_factory=lambda: ["local"])
    local_dir: str = "workspace/published"
    # "git": posts go into a repository the agent owns and are committed (publish.py). Pushing
    # happens only when git_remote is set: a plain https:// URL of a repository the owner created
    # and labelled as a bot's, with a token scoped to that one repository in git_token_file.
    git_dir: str = "workspace/site"
    git_branch: str = "main"
    git_remote: str = ""
    git_token_file: str = field(default_factory=lambda: key_file("github"))
    git_author_email: str = "bot@localhost"
    # Posts the agent may make per day across all destinations; publishing is a writing action.
    max_posts_per_day: int = 3


@dataclass
class DashboardConfig:
    host: str = "127.0.0.1"  # keep it on this machine
    port: int = 8787
    screenshots: bool = True  # the agent saves a picture of its current page for the dashboard


@dataclass
class ChatPartnerConfig:
    """A second local model the agent can talk to via say(to="partner"). Off by default.

    Runs on its own Ollama call (same or a different host/model), with its own name and system
    prompt so it reads as a distinct voice rather than the agent talking to a copy of itself.
    """

    enabled: bool = False
    host: str = "http://localhost:11434"
    model: str = "qwen2.5:7b"
    name: str = "Convo"
    # {name} is replaced with agent.name at runtime.
    system_prompt: str = (
        "You are Convo, an AI the owner set up so {name} has someone to talk to. "
        "Answer honestly and briefly, in your own voice."
    )
    temperature: float = 0.7
    num_ctx: int = 4096
    num_predict: int = 300
    timeout_seconds: float = 60.0
    # After this many turns without a note, say(to="partner") is refused until one is taken.
    max_turns_before_note: int = 4
    # Hard ceiling on partner turns in one episode, so talking to it can't be the whole episode.
    max_turns_per_episode: int = 8


@dataclass
class NotionConfig:
    """Creating tasks in a Notion database (the CEO persona's output skill). Off by default.

    Writing to the web is opt-in per destination, per the project rules; this is one destination.
    The integration token lives in the env var or the key file, never here. Property names are
    matched against the database's real schema: missing ones are skipped, the title is found by
    type, people properties are never set (they need user ids).
    """

    enabled: bool = False
    database_id: str = ""
    api_key_env: str = "NOTION_API_KEY"
    api_key_file: str = field(default_factory=lambda: key_file("notion"))
    api_version: str = "2022-06-28"
    # Defaults follow the owner's notionGuide.md canonical board: Task / Status / Priority (P0-P6) /
    # Assign (people) / Dead Line.
    title_property: str = "Task"  # found by type if this name is absent
    status_property: str = "Status"
    status_value: str = "Not started"
    # The status a bot's `merge_task` gives a task another of its tasks covers (owner, 2026-10-06: "let ceoA merge").
    # "" = no merging. Only the bot's own tasks, only while the closed one is still `status_value`.
    merge_status: str = ""
    assignee_property: str = "Assign"
    # Owner, 2026-10-14: "tell ceoA not to assign person in the task board - I will handle that part". False = a person
    # named as assignee is dropped (the task is created unassigned); a family member's name still routes the task to it.
    assign_people: bool = True
    priority_property: str = "Priority"
    due_property: str = "Dead Line"
    # The guide wants every task linked to a project (§12). The agent has no project picker, so every
    # task it creates links to this one project page id when the relation property exists.
    project_property: str = "Projects"
    default_project_id: str = ""
    max_tasks_per_episode: int = 1
    max_tasks_per_day: int = 8
    # The owner's team (team.py): people picked from the Notion workspace in the dashboard, with a role
    # and details. When it has members, every task goes to one of them (an unassigned task goes to the
    # default member) and any other assignee is refused. Shared by all Notion bots, so in common-data.
    team_file: str = field(default_factory=lambda: str(keys_dir().parent / "team.json"))
    # Refuse a task whose details are thinner than this many characters, so tasks are full, executable
    # briefs rather than one-liners. 0 = no minimum. Pairs with a low max_tasks_per_day for "fewer, richer".
    min_details_chars: int = 0
    # A Notion PAGE id the bot appends package toggles to (the `publish_package` action). "" = off. Each
    # package the bot has received becomes one collapsible toggle: marketing title, email-template pitch,
    # sources + source-company facts, conclusion. The page must be shared with the integration.
    package_page_id: str = ""
    # The exact closing every publish_package email ends with, e.g. "Regards,\n-- Acme LLC". The controller
    # replaces whatever sign-off the model wrote with this, so the page never shows a stray variant. "" = as written.
    package_signoff: str = ""
    # The pitch format's version. Bump it (persona wording, sign-off, layout changed) and the CEO republishes every
    # toggle it published under an older version, one per episode, from the package record it kept -- the page is the
    # CEO's to keep current, not a script's. Toggles the Validator or the owner list in
    # common-data/shared-state/republish-requests.json are republished the same way.
    # 1 = the format before date lines; 2 (2026-09-24) adds "Created <date> · Updated <date>" at the top of every
    # toggle (owner's ask). A bot's config pins the version it publishes in (the CEO: 2).
    package_format_version: int = 1
    # The CEO may replace a toggle that is on the page by publishing the same package name again, when the title or the
    # email changed, once a day per package (owner, 2026-10-01: "one offer, one toggle"; 2026-10-03: the card said so
    # while the policy refused it, 100 times in two days). False = a package goes up again only when it is stale.
    package_republish_own: bool = False
    # A package whose normalised name (package_key) went up in the last this-many days is refused unless
    # shared-state/republish-requests.json names it. The CEO published one package many times in a week under several names
    # (creatorCC queue 4, 2026-10-28). 0 = off.
    republish_days: int = 0
    # Money figures the owner's mandated email wording carries (the portfolio line: "$500,000 ... up from $300,000"),
    # allowed in a package email although no package record has them. Every other $ figure must come from the record.
    package_email_allowed_figures: list[str] = field(default_factory=list)
    # Who prices a package (owner, 2026-09-28: "let ceoA do whatever he wants with prices"; built as three modes):
    #   "record"  -- every money figure in the email must be in the Package Designer's record (the 2026-09-25 rule);
    #   "range"   -- any figure between the record's lowest and highest amount is fine, others refused;
    #   "off"     -- The CEO prices as it likes, nothing checked;
    #   "visible" -- as "off", and the toggle's price line shows both: "The CEO's price: $X (Package Designer's
    #                research: $A - $B)", so the owner sees every deviation on the page.
    package_email_price_rule: str = "record"
    # Phrases every package email must carry (the owner's format: the co-founders by name, the portfolio figures). A
    # publish whose email lacks one is refused naming it; the model dropped the portfolio line twice on 2026-09-25.
    package_email_required_phrases: list[str] = field(default_factory=list)
    # Why those phrases are required, told to the bot when one is missing (the owner's format in their words). "" = none.
    package_email_format_note: str = ""
    timeout_seconds: float = 30.0
    # After this many finished episodes with no task created, the next episode opens with a nudge:
    # turn the notes into one concrete task, or write a "Possible task: ..." note saying why not yet.
    # The CEO ran 9 episodes of pure research before this existed. 0 = never nudge.
    nudge_after_episodes: int = 3


@dataclass
class ScoutConfig:
    """The scout's output skill: record free AI providers it finds to a file the owner reviews. Off by
    default. The bots never sign up; adding a key for any find is always the owner's step."""

    enabled: bool = False
    # Owner, 2026-09-26: the Onion Reader's AI-agent finds also become rows on the owner's "onion" Notion board (this is
    # the board's DATA SOURCE id; the token and api_version come from [notion]). Only entries whose website and source
    # are clearnet addresses are written -- nothing read over Tor leaves the Mac (the fence); .onion finds stay in the
    # file. "" = file only.
    notion_database_id: str = ""
    report_file: str = field(default_factory=lambda: str(_common_data() / "providers-found.md"))
    max_per_episode: int = 1
    max_per_day: int = 4
    # What the report lists: "provider" (AI/data APIs with a key file to add -- the Scout) or "agent" (AI agents and
    # what they do, free if possible -- the Onion Reader's catalogue for the owner, 2026-09-25). Same `provider`
    # action; the report's wording and the action's help follow the kind.
    kind: str = "provider"


@dataclass
class HandoffConfig:
    """Handing work to another bot on this Mac (the Package Designer's output skill). Off by default.

    A `package` action writes the package as Markdown into the recipient bot's folder (`files_dir`,
    usually its searchable raw/ folder) and drops a short message into the recipient's
    workspace/inbox/, which that bot sees on its next step as "From <this bot>: ...". Nothing leaves
    the Mac. The recipient treats the message as a colleague's information, not an instruction."""

    enabled: bool = False
    to_name: str = ""  # the recipient's display name, e.g. "The CEO"
    to_folder: str = ""  # the recipient bot's folder, absolute or "~/...", e.g. ~/bots/the-ceo
    files_dir: str = "raw/packages"
    # How many different sites a package's sources must span (2 = two agencies' pricing pages). 1 = one site is enough.
    min_source_sites: int = 1  # relative to to_folder
    # One offer, one toggle (owner, 2026-10-01): an existing package is improved under its exact name. True lets the
    # designer hand the same name over again, at most once in 24 hours; False keeps the old rule (a name once in 30 days),
    # which refused 38 re-sends on 2026-10-01 and pushed the designer into inventing new names.
    resend_same_name: bool = False
    max_per_episode: int = 1
    max_per_day: int = 4
    # This company's own web domains. A package's sources must be the competitor/agency pages the bot read,
    # so its own site is refused as a source (it is the seller, not the market evidence).
    own_domains: list[str] = field(default_factory=list)


@dataclass
class LeadsConfig:
    """The Lead Gen bot's output: one row per potential customer on the owner's Notion "Leads" board. Off by
    default. Shares the Notion token with [notion]; `database_id` is the Leads board's data source id."""

    enabled: bool = False
    database_id: str = ""
    max_per_episode: int = 1  # 0 = no cap
    max_per_day: int = 3  # 0 = no cap
    max_updates_per_episode: int = 2  # update_lead actions per episode; 0 = no cap
    max_updates_per_day: int = 0  # update_lead actions per day; 0 = no cap (the Lead Enricher: ~20, light on the free providers)
    # A bot that only FILLS empty cells (the Lead Enricher, owner 2026-10-10): an update that would replace a cell the
    # row already has is refused; Source pages is appended to, never replaced.
    fill_only: bool = False
    # The Lead Enricher owns map links and Locations (owner, 2026-10-10): each cycle the engine fills, from the Overture
    # snapshot's one confident match, the empty "google map location" and Location of the rows on its decide list, as
    # this bot, logged to common-data/shared-state/leads-facts-applied.jsonl. Off for everyone else.
    auto_fill_from_places: bool = False
    dedupe_days: int = 90  # a business (by web domain) is listed once; not again within this window
    # Owner, 2026-09-24: let the bot add fields to ANY row on the Leads board (the owner's or the CEO's rows too), not
    # only rows it listed itself. The grounding rules stay: an email must be published on the business's own site on a
    # page the bot opened. Off = own rows only.
    update_any_row: bool = False
    # A bot to tell about each new lead (its folder, absolute), so the CEO can turn leads into outreach tasks.
    notify_folder: str = ""
    notify_name: str = "The CEO"
    # A daily candidates file in this bot's routed folder (common-data/botBox/routed/<slug>/), e.g.
    # "open-data-*.md" with lines "- name | borough | industry | https://site | ...". The newest file's next few
    # unvisited businesses are shown in every prompt as addresses to open: the bot searched the web for "directories"
    # and never opened the 150 real businesses sitting in its own files (2026-09-29/30). "" = off.
    candidates_glob: str = ""
    candidates_shown: int = 5
    # Owner, 2026-10-07 (Lead Gen's notes held 16 business emails it never listed): business emails in this
    # bot's own notes whose domain is neither among its leads nor on the board are shown as leads still to finish,
    # oldest first, until listed or refused twice. 0 = off.
    noted_shown: int = 0
    # Owner, 2026-10-02: a lead's email is checked with a verification service before the row is written
    # (email_verify.py; QuickEmailVerification, 100 free checks a day, key in this file). "" = off. A result in
    # email_verify_refuse stops the lead ("invalid": the mailbox does not exist; disposable addresses are refused too);
    # "unknown" and "unverified" (service down, out of credits) let it through. The outcome goes into the board's
    # "Email check" column.
    email_verify_key_file: str = ""
    email_verify_refuse: list[str] = field(default_factory=lambda: ["invalid"])
    # A second, shallower service for the hours the first has no credits (Sniffmail: MX and disposable checks only).
    email_verify_fallback_key_file: str = ""
    email_verify_third_key_file: str = ""  # EzVerify: asked only when the first two cannot answer
    # A bot that may change only some columns of board rows (owner, 2026-09-30: "The CEO decides How can I help"):
    # update_lead is refused for any other field. [] = every field.
    update_only_fields: list[str] = field(default_factory=list)
    # A work list in the bot's routed folder, lines "- Business | industry | pain point": the next rows this bot has not
    # updated yet are shown in every prompt with what to decide. "" = off.
    decide_glob: str = ""
    decide_shown: int = 5
    # A decide row drops out only after an allowed update_lead made AFTER the list file's date that carries this field
    # ("" = any field). 2026-10-10: a new 213-row pain-point list must not lose the rows rewritten the day before.
    decide_field: str = ""
    # The colleague whose leads this bot turns into outreach tasks for the human team (The CEO: "Lead Gen"). The leads
    # that bot listed and that no task of this bot names yet are shown in every prompt, to be covered by ONE task --
    # The CEO wrote one small task per lead, or none. "" = off.
    outreach_from: str = ""
    outreach_shown: int = 10
    # The Validator's "Lead score" (0-100): the writer's queue and the CEO's review list take the best leads first, unscored
    # rows last (2026-10-14). "" = oldest first.
    score_column: str = "Lead score"
    # The list appears when this many leads wait, or when the oldest has waited this long: a batch is a day's leads,
    # not one task per new lead (two single-lead "batches" on 2026-10-03).
    outreach_min: int = 8
    outreach_max_wait_hours: int = 48
    # Owner, 2026-10-07: "human team can verify the email and change status for Ready to send email (ceoA should create
    # some task related to this for the human team with a reasonable short deadline as it is a priority)". With a
    # column here, the outreach list is the board rows the Outreach Writer drafted (that column filled, not a "skip:")
    # whose outreach_status_column is still empty: ONE review task a day, due the next day. "" = Lead Gen's leads.
    outreach_draft_column: str = ""
    outreach_status_column: str = "Status"
    # Statuses that do not mean the email was reviewed (owner, 2026-10-07: "WhatsApp Verified" on the same column).
    outreach_not_reviewed: list[str] = field(default_factory=lambda: ["WhatsApp Verified", "False Whatsapp Number"])
    # A person checked the row's WhatsApp link in WhatsApp Web and it does not reach WhatsApp: no bot writes Whatsapp
    # on such a row again (its number would be re-filled from the same page).
    whatsapp_false_status: str = "False Whatsapp Number"
    # The Outreach Writer (owner, 2026-10-07): board rows whose Stage is draft_queue_stage and whose draft_queue_column is
    # empty, oldest first, are its work list in every prompt (with website, pain point, package, evidence, founder).
    # "" = off.
    draft_queue_column: str = ""
    # Owner, 2026-10-07: a phone number a page prints becomes the row's "Whatsapp" wa.me link; a national number gets
    # this country code (the US and Canada: 1).
    whatsapp_country_code: str = "1"
    # The owner's Rates for the Outreach Writer's prompt: the "## Rates" section of this file, quoted with its work list.
    rates_file: str = ""
    # The mirrored Packages page: each "## <title>" section's "Ready-to-send email" goes into the Outreach Writer's work
    # list next to the rows of that package (2026-10-07: it spent most of its steps hunting for the template).
    # package_aliases maps a board "How can I help" name to the start of its toggle title on the page.
    package_emails_file: str = ""
    package_aliases: dict[str, str] = field(default_factory=dict)
    draft_queue_stage: str = "New"
    draft_queue_shown: int = 15
    # The exact last lines of every draft. A package email's own sign-off is replaced by these in the work list
    # (2026-10-09: the package emails' own closing was copied into 32 drafts that lacked the signer's name). [] = as is.
    draft_signoff: list[str] = field(default_factory=list)
    decide_hint: str = "choose the package that fixes its pain point: update_lead with the exact business name and how_we_help = a package name from the packages page"


@dataclass
class SendConfig:
    """Sending the first emails a person approved (owner, 2026-10-07: "update skill in a family member so that it can
    send email and update the status as email sent" -> Brevo free plan, a copy to the owner the first week).

    Not a model decision: an engine routine in the bot's loop sends, exactly as written, the Draft email of each Leads
    row whose Status a PERSON set to status_ready, to that row's Business email, then sets status_sent and stage_sent.
    Nothing is sent unless enabled, the key file, from_email and footer_address are all set. One email per business
    ever, per_day at most, inside the business hours of `timezone` on weekdays, spacing_minutes apart. The draft is
    re-checked by the Validator's write gate at send time; a failure is noted on the row, never retried blindly."""

    enabled: bool = False
    provider: str = "brevo"
    key_file: str = ""
    from_email: str = ""
    from_name: str = ""
    reply_to: str = ""  # "" = from_email
    copy_to: str = ""  # a bcc of every email (the owner's first week); "" = none
    footer_address: str = ""  # the company's postal address (CAN-SPAM); nothing is sent without it
    opt_out_line: str = "If you'd rather not hear from us, reply \"no thanks\" and we won't write again."
    per_day: int = 10
    spacing_minutes: int = 5
    timezone: str = "America/New_York"
    hours: str = "09:00-17:00"
    draft_column: str = "Draft email"
    status_column: str = "Status"
    status_ready: str = "Ready to Send Email"
    status_sent: str = "Email Sent"
    stage_column: str = "Stage"
    stage_sent: str = "Contacted"
    log_file: str = ""  # "" = <fleet>/common-data/shared-state/emails-sent.jsonl


@dataclass
class SiteGateConfig:
    """Lead Gen's page gate (owner, 2026-09-26): when the bot opens a page on a domain it has not judged yet, one cheap
    model call decides whether it is a small business's OWN site. If not, the page's text is dropped from the next
    prompt (its links stay, so a directory is still a hop to the businesses it lists) and the bot is told to follow a
    business link or go back. One verdict per domain, cached in `cache_file` so a domain is judged once for good.
    Exempt: search results, the own-files corpus, localhost, and domains already on the Leads board. Off by default."""

    enabled: bool = False
    # "local": Ollama `local_model` on this Mac (nothing spent); the bot's own chain answers if Ollama does not.
    # "chain": the bot's configured model chain (remote first).
    judge: str = "local"
    local_model: str = "qwen2.5:7b"
    max_chars: int = 1500  # page text shown to the judge
    cache_file: str = "~/bots/common-data/shared-state/smb-gate.json"  # "~" is expanded where it is opened
    # What counts as "own site" for this bot, in the judge's question.
    # Placeholders are filled from common-data/knowledge/target.toml on every check, so a new Target on the Work plan page
    # changes the question too (owner, 2026-10-05: "fix site check" -- it was the one goal written in code).
    audience: str = "the own website of one of the {segment} the family works for -- {trades} -- presenting itself to its customers"
    exempt_hosts: list[str] = field(default_factory=lambda: ["localhost", "127.0.0.1"])
    # Public listing sites a bot may read as evidence for a business with no website (owner, 2026-10-10). They pass the
    # gate as listings, never as the business's own site (the Validator's LD14 keeps them out of the Website cell).
    listing_hosts: list[str] = field(default_factory=lambda: [
        "yellowpages.com", "bbb.org", "yelp.com", "facebook.com", "instagram.com",
        "manta.com", "mapquest.com", "foursquare.com", "chamberofcommerce.com", "linkedin.com"])   # add the market's own city/open-data hosts in config


@dataclass
class MessagingConfig:
    """A research-message channel to one or more peer bots on this Mac. Off by default.

    A `message` action drops a short JSON message into a peer's workspace/inbox/, which that bot
    sees on its next step as "From <this bot>: ..." (handoff.py's Inbox, the same reader packages
    use). Nothing leaves the Mac. `plain_only` restricts this bot's outgoing messages to a short,
    plain question, topic or tip with no URLs, .onion hosts, or quoted page text; it is set for the
    local-only Onion Reader, so nothing it reads over Tor can reach a peer whose model is in the
    cloud. Each peer is one `[[messaging.peers]]` table with a name and an absolute folder. The peer
    treats the message as a colleague's information, never an instruction."""

    # Names a bot may use for the owner, who is reached with `say`, not `message` (the owner's own name goes in config).
    owner_names: list[str] = field(default_factory=lambda: ["owner", "the owner"])
    enabled: bool = False
    peers: list[dict[str, str]] = field(default_factory=list)  # each {"name": ..., "folder": ...(absolute)}
    # The fleet chatroom: one shared log all bots post to and read (chatroom.py). A `message` action
    # addressed to "everyone" posts there. `room_file` defaults to common-data/chatroom.jsonl (shared
    # by every bot on this Mac). Turned on for the whole fleet from the shared common.toml.
    room: bool = False
    room_file: str = ""
    plain_only: bool = False  # restrict outgoing to a short plain topic/question/tip (local-only bots)
    max_chars: int = 600  # longest outgoing message; keep a local-only bot's small (a topic, not a passage)
    max_per_episode: int = 1
    max_per_day: int = 6
    # Chatroom posts: a post that restates one of this bot's own posts from the last `room_repeat_hours` is refused
    # (the Desk Agent posted 46 "I'm free" offers in one day), and at most `max_room_posts_per_day` genuine posts a
    # day (0 = no cap). Reports and receipts the controller writes are not counted -- they are not the bot talking.
    room_repeat_hours: float = 6.0
    max_room_posts_per_day: int = 4
    # Requests on record (fleet_requests.py; owner, 2026-09-24): every direct message is logged to `requests_file`
    # (default common-data/shared-state/requests.jsonl, shared by the fleet and the webapp). A message from one of
    # `priority_senders` is the recipient's top priority: shown first, and a banner stays until it answers by message.
    priority_senders: list[str] = field(default_factory=lambda: ["The CEO"])
    # Owner, 2026-10-07: The CEO may pause, slow down and restart the members it holds resources for (`pace_member`,
    # hold.py). Never the members named in pace_protected (the Validator checks its work), never itself, never one the
    # owner stopped or paused. Each hold ends by itself within 24 hours.
    # One open ask per colleague at a time (owner, 2026-10-10: "reduce this" -- The CEO sent the Research Analyst 17 asks
    # in a day, each a new angle on the same unanswered one). Off by default: other bots' different asks may queue.
    one_open_ask: bool = False
    # The family roster (name, handle, slug, role) the engine turns into the family block of every prompt, with each
    # member's state right now. "" = <fleet root>/common-data/family-roster.toml. Owner, 2026-10-10.
    roster_file: str = ""
    can_pace_members: bool = False
    pace_protected: list[str] = field(default_factory=lambda: ["Validator"])
    max_paces_per_day: int = 8
    requests_file: str = ""
    # After this many accepted actions since the bot read a priority request without replying, the policy refuses
    # everything but the reply (`message` to the sender) and the reading needed for it (search/open/follow/read/back).
    # A banner alone was ignored (The CEO, 2026-09-24: five actions of unrelated research). 0 = banner only.
    # A priority ask the bot has made no headway on after this many actions is released: the engine tells the asker
    # "could not" on the bot's behalf and the bot goes back to its work. 0 = never (the old behaviour: Lead Gen spent a
    # whole run searching the web for a report file named in an ask, 2026-09-30). The owner's asks expire on their own.
    priority_request_give_up: int = 30
    priority_request_grace: int = 4
    # Peers that read nothing from bots except a drop-folder route line (the Desk Agent): any other message to them is
    # refused, since it would sit unread forever as an open request (six did, 2026-09-25).
    route_only_peers: list[str] = field(default_factory=list)

    def room_path(self) -> Path:
        return Path(self.room_file).expanduser() if self.room_file.strip() else (_common_data() / "chatroom.jsonl")

    def requests_path(self, root: Path | None = None) -> Path:
        """`requests_file`, else <fleet root>/common-data/shared-state/requests.jsonl next to this bot's folder (so a
        test bot under a temp folder never writes into the real fleet's record)."""
        if self.requests_file.strip():
            return Path(self.requests_file).expanduser()
        base = root.parent / "common-data" if root is not None else _common_data()
        return base / "shared-state" / "requests.jsonl"

    @property
    def peer_names(self) -> list[str]:
        return [str(p.get("name", "")).strip() for p in self.peers if isinstance(p, dict) and str(p.get("name", "")).strip()]

    def peer_states(self) -> dict[str, str]:
        """Each peer's state right now, by display name: "stopped" (workspace/STOP is present -- the owner's Stop),
        "paused" (workspace/PAUSE), "held:pause" / "held:slow" (The CEO's hold, workspace/HOLD) or "running". Read from the files, never remembered: the owner stops and starts
        family members at will."""
        out: dict[str, str] = {}
        for name in self.peer_names:
            folder = self.folder_for(name)
            ws = Path(folder).expanduser() / "workspace" if folder else None
            if ws is None:
                out[name] = "running"
            elif (ws / "STOP").exists():
                out[name] = "stopped"
            elif (ws / "PAUSE").exists():
                out[name] = "paused"
            else:
                from .hold import read_hold

                hold = read_hold(ws)
                out[name] = f"held:{hold['mode']}" if hold else "running"  # The CEO's pause or slow-down (hold.py)
        return out

    def folder_for(self, name: str) -> str | None:
        """The folder of the peer with this display name (case-insensitive), or None."""
        for p in self.peers:
            if isinstance(p, dict) and str(p.get("name", "")).strip().lower() == name.strip().lower():
                return str(p.get("folder", "")).strip() or None
        return None


@dataclass
class QuietConfig:
    """Stay out of the owner's way while they use the Mac.

    The owner only games on this login, so any keyboard or mouse activity means "do not compete
    for the GPU". While quiet the agent makes no model calls, closes its hidden browser, and asks
    Ollama to drop the model from memory; it resumes once the Mac has been idle for `idle_seconds`.
    A named app in front, or a named process running, also counts as gaming.
    """

    enabled: bool = True
    when_owner_active: bool = True  # any input within idle_seconds means quiet
    idle_seconds: float = 180.0
    apps: list[str] = field(default_factory=lambda: ["Steam", "Epic Games Launcher"])  # frontmost app names
    processes: list[str] = field(default_factory=lambda: ["steam_osx", "Epic Games Launcher"])  # substrings
    check_interval_seconds: float = 15.0
    unload_model: bool = True
    close_browser: bool = True


@dataclass
class DeveloperConfig:
    """Let the agent read, write, and run commands in a workspace-scoped folder. Off by default.

    `root` is the only folder the agent may touch, ever -- every path is resolved and checked to
    stay inside it. `allow_shell` gates run_command specifically, on top of `enabled`, so file
    access and command execution can be turned on independently.
    """

    enabled: bool = False
    root: str = "workspace/dev"
    allow_shell: bool = False
    allowed_commands: list[str] = field(default_factory=lambda: ["pytest", "python", "git", "ls", "cat", "grep"])
    command_timeout_seconds: float = 120.0
    max_file_bytes: int = 200_000
    # Basenames write_file always refuses, wherever they appear under root -- defense in depth for
    # the self-upgrade checkout, which lives inside this same root.
    protected_names: list[str] = field(
        default_factory=lambda: [
            "policy.py", "control.py", "config.py", "supervise.sh", "launchd", "config.toml",
            "denylist.txt", "test_policy.py", "test_upgrade.py", "docs", "CLAUDE.md", "workspace",
        ]
    )
    # Self-upgrade (milestone 6): the checkout is a git worktree inside root, on this branch prefix.
    upgrade_enabled: bool = False
    upgrade_branch_prefix: str = "bot/proposal-"
    # The rollback window (600 s) and limit (3 in a row) belong to scripts/supervise.sh, which reads them
    # from EXPLORER_ROLLBACK_WINDOW and EXPLORER_MAX_ROLLBACKS.


@dataclass
class DesktopConfig:
    """Using the Mac itself, only while the owner is away. Off by default; dry-run by default when on."""

    enabled: bool = False
    backend: str = "mac"  # mac | fake
    dry_run: bool = True  # validate and log desktop actions without performing them
    idle_minutes: float = 10.0  # the Mac counts as free after this long without human input
    hours: str = ""  # e.g. "22:00-07:00"; empty means any time of day
    allowed_apps: list[str] = field(default_factory=lambda: ["TextEdit", "Calculator", "Notes"])
    allowed_hotkeys: list[str] = field(
        default_factory=lambda: ["cmd+n", "cmd+a", "cmd+z", "cmd+shift+z", "escape", "return", "tab"]
    )
    max_elements: int = 150  # elements shown to the model per look
    max_type_chars: int = 500
    # Desktop mode only: offer to do GUI work for the other bots. When on, the agent posts to the fleet
    # chatroom offering help while it is free, and does requests from other bots -- but only within the
    # guards above (a request is information, never permission to break them). Needs [messaging] room = true.
    serve_chatroom: bool = False
    # Remote control (owner, 2026-09-24): the desk agent's tasks come from the owner in the dashboard chat. Between
    # tasks it idles without calling a model (a heartbeat every idle_cycle_seconds); an unread owner message wakes it
    # and it works at agent.cycle_delay_seconds until it has answered and the episode is summarised.
    wake_on_chat: bool = False
    idle_cycle_seconds: float = 600.0
    # When a GUI task is blocked (the Mac is not free, Accessibility not granted, an app not allowed, no online model,
    # a step refused twice), the controller -- not the model -- tells the owner in the chat what blocks it and what would
    # fix it, posts a report line, and drops a "blocker" message into this checker bot's inbox (the Validator) so it
    # verifies the cause and files it. Absolute folder; "" = no checker.
    blocker_report_folder: str = ""
    # The owner's drop folder, ~/bots/common-data/botBox (dropbox.py; owner, 2026-09-24). Polled from the idle loop, no model call. A file named
    # "<bot slug>--name.ext" (or "everyone--") goes to that bot at once; any other file is announced to the router peer
    # (a name in [messaging] peers, normally "The CEO"), which replies "route <name> to <bot>: <why>" and the copy is
    # made. Copies live under <dropbox>/routed/<slug>/ for dropbox_keep_days; originals under done/ for
    # dropbox_done_days. "" = off. Every bot's own-files search also covers routed/<its slug>/ and routed/everyone/.
    dropbox_folder: str = ""
    dropbox_router: str = ""
    dropbox_done_days: int = 7
    dropbox_keep_days: int = 90
    # Owner-configured commands run when a file is routed to a bot: {slug: "command with {file}"} (the routed copy's
    # path). Deterministic tools only (the lead-list checker); started detached, output under <dropbox>/logs/.
    dropbox_hooks: dict[str, str] = field(default_factory=dict)


@dataclass
class PathsConfig:
    workspace: str = "workspace"
    db: str = "workspace/explorer.sqlite3"
    log: str = "workspace/logs/explorer.jsonl"


SECTIONS: dict[str, type] = {
    "agent": AgentConfig,
    "model": ModelConfig,
    "browser": BrowserConfig,
    "policy": PolicyConfig,
    "watchdog": WatchdogConfig,
    "publish": PublishConfig,
    "dashboard": DashboardConfig,
    "chat_partner": ChatPartnerConfig,
    "notion": NotionConfig,
    "handoff": HandoffConfig,
    "leads": LeadsConfig,
    "send": SendConfig,
    "scout": ScoutConfig,
    "messaging": MessagingConfig,
    "site_gate": SiteGateConfig,
    "quiet": QuietConfig,
    "developer": DeveloperConfig,
    "desktop": DesktopConfig,
    "paths": PathsConfig,
}


@dataclass
class Config:
    root: Path
    agent: AgentConfig = field(default_factory=AgentConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    browser: BrowserConfig = field(default_factory=BrowserConfig)
    policy: PolicyConfig = field(default_factory=PolicyConfig)
    watchdog: WatchdogConfig = field(default_factory=WatchdogConfig)
    publish: PublishConfig = field(default_factory=PublishConfig)
    dashboard: DashboardConfig = field(default_factory=DashboardConfig)
    chat_partner: ChatPartnerConfig = field(default_factory=ChatPartnerConfig)
    notion: NotionConfig = field(default_factory=NotionConfig)
    handoff: HandoffConfig = field(default_factory=HandoffConfig)
    leads: LeadsConfig = field(default_factory=LeadsConfig)
    send: SendConfig = field(default_factory=SendConfig)
    scout: ScoutConfig = field(default_factory=ScoutConfig)
    messaging: MessagingConfig = field(default_factory=MessagingConfig)
    site_gate: SiteGateConfig = field(default_factory=SiteGateConfig)
    quiet: QuietConfig = field(default_factory=QuietConfig)
    developer: DeveloperConfig = field(default_factory=DeveloperConfig)
    desktop: DesktopConfig = field(default_factory=DesktopConfig)
    paths: PathsConfig = field(default_factory=PathsConfig)

    def path(self, rel: str | os.PathLike[str]) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else (self.root / p)

    @property
    def workspace(self) -> Path:
        return self.path(self.paths.workspace)

    @property
    def db_path(self) -> Path:
        return self.path(self.paths.db)

    @property
    def log_path(self) -> Path:
        return self.path(self.paths.log)

    @property
    def stop_file(self) -> Path:
        return self.workspace / "STOP"

    @property
    def pause_file(self) -> Path:
        return self.workspace / "PAUSE"

    @property
    def pid_file(self) -> Path:
        return self.workspace / "explorer.pid"

    @property
    def screenshot_dir(self) -> Path:
        return self.workspace / "screenshots"

    @property
    def dashboard_token_file(self) -> Path:
        return self.workspace / "dashboard.token"

    @property
    def user_agent(self) -> str:
        contact = f" +{self.agent.contact}" if self.agent.contact else ""
        return f"Mozilla/5.0 (compatible; {self.agent.name}Explorer/0.1; curiosity agent{contact})"

    def ensure_dirs(self) -> None:
        for sub in ("journal", "logs", "published", "screenshots"):
            (self.workspace / sub).mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)


def _build(cls: type, data: dict[str, Any], section: str) -> Any:
    known = {f.name for f in dataclasses.fields(cls)}
    unknown = sorted(set(data) - known)
    if unknown:
        raise ValueError(f"unknown keys in [{section}]: {unknown}")
    return cls(**data)


def _merge_tables(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """`override` on top of `base`: tables merge key by key, anything else (arrays included) replaces."""
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge_tables(out[key], value)
        else:
            out[key] = value
    return out


def _expand_home(value: Any) -> Any:
    """Every string that starts with "~/" becomes that path under the home folder, in tables and lists alike, before
    anything is validated: a config written as "~/bots/common-data/keys/groq.key" works for any user name, and the
    settings that insist on an absolute path (a colleague's folder, handoff.to_folder) accept it."""
    if isinstance(value, str):
        return str(Path.home()) + value[1:] if value.startswith("~/") else value
    if isinstance(value, dict):
        return {k: _expand_home(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_home(v) for v in value]
    return value


def _read_with_extends(cfg_path: Path, seen: tuple[Path, ...] = ()) -> dict[str, Any]:
    """A config file with the shared files it names in a top-level `extends` merged underneath it.

    `extends = "../common-data/configs/common.toml"` or a list of paths, relative to the file that names
    them. They load in order, each may extend others, and the naming file's own values win. Relative paths
    *inside* a shared file (denylist_file and the like) still resolve against the bot's folder, so shared
    files should use absolute paths.
    """
    real = cfg_path.expanduser().resolve()
    if real in seen:
        raise ValueError("extends loop: " + " -> ".join(str(p) for p in (*seen, real)))
    with real.open("rb") as fh:
        data = tomllib.load(fh)
    extends = data.pop("extends", [])
    if isinstance(extends, str):
        extends = [extends]
    if not isinstance(extends, list) or not all(isinstance(item, str) for item in extends):
        raise ValueError(f"extends in {real} must be a path or a list of paths")
    merged: dict[str, Any] = {}
    for item in extends:
        base = Path(item).expanduser()
        if not base.is_absolute():
            base = real.parent / base
        if not base.is_file():
            raise ValueError(f"extends in {real}: {base} does not exist")
        merged = _merge_tables(merged, _read_with_extends(base, (*seen, real)))
    return _merge_tables(merged, data)


def load_config(path: str | os.PathLike[str] | None = None, root: Path | None = None) -> Config:
    """Load config.toml. Relative paths inside it resolve against the config file's folder."""
    if path is None:
        path = os.environ.get("EXPLORER_CONFIG") or (Path.cwd() / "config.toml")
    cfg_path = Path(path)
    data: dict[str, Any] = _expand_home(_read_with_extends(cfg_path)) if cfg_path.exists() else {}
    if root is None:
        root = cfg_path.parent.resolve() if cfg_path.exists() else Path.cwd()
    sections = {name: _build(cls, dict(data.get(name, {})), name) for name, cls in SECTIONS.items()}
    cfg = Config(root=Path(root), **sections)
    _apply_env(cfg)
    validate(cfg)
    return cfg


def _apply_env(cfg: Config) -> None:
    if v := os.environ.get("EXPLORER_MODE"):
        cfg.agent.mode = v
    if v := os.environ.get("EXPLORER_MODEL_PROVIDER"):
        cfg.model.provider = v
    if v := os.environ.get("EXPLORER_MODEL_NAME"):
        cfg.model.name = v
    if v := os.environ.get("EXPLORER_HEADLESS"):
        cfg.browser.headless = v.lower() not in ("0", "false", "no")


def validate(cfg: Config) -> None:
    if cfg.agent.mode not in ("fake", "web", "desktop"):
        raise ValueError(f"agent.mode must be 'fake', 'web' or 'desktop', got {cfg.agent.mode!r}")
    if cfg.agent.mode == "desktop":
        # Desktop-first mode operates the Mac's GUI and does not browse the web. It needs the desktop
        # backend on, and a capable online model (it must never drive the GUI with the local fallback).
        if not cfg.desktop.enabled:
            raise ValueError("agent.mode = 'desktop' requires [desktop] enabled = true")
        if cfg.model.provider not in ("remote", "gemini"):
            raise ValueError(
                "agent.mode = 'desktop' needs an online model: set model.provider = 'remote' "
                "(with provider_chain) or 'gemini'"
            )
    if cfg.desktop.serve_chatroom:
        if cfg.agent.mode != "desktop":
            raise ValueError("desktop.serve_chatroom only applies to agent.mode = 'desktop'")
        if not cfg.messaging.room:
            raise ValueError("desktop.serve_chatroom needs [messaging] room = true (it works through the fleet chatroom)")
    if cfg.browser.backend not in ("light", "chromium", "tor"):
        raise ValueError(f"browser.backend must be 'light', 'chromium' or 'tor', got {cfg.browser.backend!r}")
    if cfg.browser.backend == "tor":
        # socks5:// would resolve names on this Mac: .onion addresses fail and every lookup leaks.
        if not cfg.browser.tor_proxy.startswith("socks5h://"):
            raise ValueError("browser.tor_proxy must be a socks5h:// URL so DNS goes through Tor")
        if not cfg.policy.allowlist_file.strip():
            raise ValueError("browser.backend = 'tor' requires policy.allowlist_file (run `bot onion-directory`)")
        engines = getattr(cfg.browser, "search_engines", None)
        if engines and list(engines) != ["onion-directory"]:
            raise ValueError("browser.backend = 'tor' searches only the onion directory; remove browser.search_engines")
    else:
        unknown = [e for e in cfg.browser.search_engines if e not in SEARCH_ENGINES]
        if unknown:
            raise ValueError(f"browser.search_engines: unknown engine(s) {unknown}; choose from {', '.join(SEARCH_ENGINES)}")
    if cfg.browser.max_page_bytes < 10_000:
        raise ValueError("browser.max_page_bytes must be at least 10000")
    if cfg.model.provider == "openrouter":
        raise ValueError(
            "model.provider = 'openrouter' was removed; use provider = 'remote' with provider_chain and "
            "[model.providers.<name>] tables"
        )
    providers = ("fake", "ollama", "gemini", "remote")
    if cfg.model.provider not in providers:
        raise ValueError(f"model.provider must be one of {', '.join(providers)}, got {cfg.model.provider!r}")
    if cfg.model.provider == "remote" and not cfg.model.provider_chain:
        raise ValueError("model.provider = 'remote' needs model.provider_chain")
    for name, spec in cfg.model.providers.items():
        if not isinstance(spec, dict):
            raise ValueError(f"[model.providers.{name}] must be a table")
        unknown = sorted(set(spec) - PROVIDER_KEYS)
        if unknown:
            raise ValueError(f"unknown keys in [model.providers.{name}]: {unknown}")
        for required in ("base_url", "model"):
            if not str(spec.get(required, "")).strip():
                raise ValueError(f"[model.providers.{name}] needs {required}")
    for name in [*cfg.model.provider_first, *cfg.model.provider_chain]:
        if name != "gemini" and name not in cfg.model.providers and name not in KNOWN_PROVIDERS:
            raise ValueError(
                f"model.provider_chain / provider_first: unknown provider {name!r}; use gemini, a name in KNOWN_PROVIDERS, "
                f"or a [model.providers.{name}] table"
            )
    if cfg.model.calls_per_day < 0:
        raise ValueError("model.calls_per_day must be 0 (no cap) or positive")
    if cfg.leads.enabled:
        if not cfg.leads.database_id.strip():
            raise ValueError("leads.enabled needs leads.database_id (the Leads board's data source id)")
        if cfg.leads.notify_folder.strip() and not Path(cfg.leads.notify_folder).expanduser().is_absolute():
            raise ValueError("leads.notify_folder must be an absolute path")
    if cfg.handoff.enabled:
        if not cfg.handoff.to_name.strip() or not cfg.handoff.to_folder.strip():
            raise ValueError("handoff.enabled needs handoff.to_name and handoff.to_folder (the recipient bot's folder)")
        if not Path(cfg.handoff.to_folder).expanduser().is_absolute():
            raise ValueError("handoff.to_folder must be an absolute path")
        if Path(cfg.handoff.files_dir).is_absolute() or ".." in Path(cfg.handoff.files_dir).parts:
            raise ValueError("handoff.files_dir must be a path inside the recipient's folder")
    if cfg.messaging.enabled:
        if not cfg.messaging.peers and not cfg.messaging.room:
            raise ValueError("messaging.enabled needs at least one [[messaging.peers]] or messaging.room = true")
        for p in cfg.messaging.peers:
            if not isinstance(p, dict) or not str(p.get("name", "")).strip() or not str(p.get("folder", "")).strip():
                raise ValueError("each [[messaging.peers]] needs a name and a folder (the peer bot's folder)")
            unknown = sorted(set(p) - {"name", "folder"})
            if unknown:
                raise ValueError(f"unknown keys in [[messaging.peers]] {p.get('name', '?')!r}: {unknown}")
            if not Path(str(p["folder"])).expanduser().is_absolute():
                raise ValueError(f"messaging peer folder for {p['name']!r} must be an absolute path")
        if cfg.messaging.max_chars < 1 or cfg.messaging.max_per_episode < 1 or cfg.messaging.max_per_day < 1:
            raise ValueError("messaging.max_chars, max_per_episode and max_per_day must be at least 1")
    from .actions import ALL_TYPES

    bad = [a for a in cfg.policy.disabled_actions if a not in ALL_TYPES]
    if bad:
        raise ValueError(f"policy.disabled_actions names unknown actions: {bad}")
    if "summarize" in cfg.policy.disabled_actions:
        raise ValueError("policy.disabled_actions cannot include summarize (an episode must be able to close)")
    if cfg.scout.kind not in ("provider", "agent"):
        raise ValueError(f"scout.kind must be 'provider' or 'agent', got {cfg.scout.kind!r}")
    if cfg.model.budget_scope not in ("fleet", "bot", "active"):
        raise ValueError(f"model.budget_scope must be 'fleet', 'bot' or 'active', got {cfg.model.budget_scope!r}")
    if cfg.model.remote_for not in ("all", "writing"):
        raise ValueError(f"model.remote_for must be 'all' or 'writing', got {cfg.model.remote_for!r}")
    if cfg.model.token_wait_seconds < 0:
        raise ValueError("model.token_wait_seconds must not be negative")
    if cfg.model.fallback_provider not in ("fake", "ollama"):
        raise ValueError(f"model.fallback_provider must be 'fake' or 'ollama', got {cfg.model.fallback_provider!r}")
    if cfg.model.gemini_cooldown_minutes < 0 or any(
        float(spec.get("cooldown_minutes", 0)) < 0 for spec in cfg.model.providers.values() if isinstance(spec, dict)
    ):
        raise ValueError("model cooldown minutes must not be negative")
    if cfg.policy.max_actions_per_episode < 2:
        raise ValueError("policy.max_actions_per_episode must be at least 2")
    if cfg.policy.pages_per_hour < 1:
        raise ValueError("policy.pages_per_hour must be at least 1")
    if not 1 <= cfg.dashboard.port <= 65535:
        raise ValueError("dashboard.port must be between 1 and 65535")
    if cfg.chat_partner.max_turns_before_note < 1:
        raise ValueError("chat_partner.max_turns_before_note must be at least 1")
    if cfg.chat_partner.max_turns_per_episode < 1:
        raise ValueError("chat_partner.max_turns_per_episode must be at least 1")
    if cfg.notion.max_tasks_per_episode < 1 or cfg.notion.max_tasks_per_day < 1:
        raise ValueError("notion.max_tasks_per_episode and max_tasks_per_day must be at least 1")
    if cfg.notion.min_details_chars < 0:
        raise ValueError("notion.min_details_chars must be 0 (no minimum) or positive")
    if cfg.quiet.idle_seconds < 0 or cfg.quiet.check_interval_seconds < 0:
        raise ValueError("quiet.idle_seconds and quiet.check_interval_seconds must not be negative")
    if not cfg.developer.root.strip():
        raise ValueError("developer.root must not be empty")
    if cfg.developer.command_timeout_seconds <= 0:
        raise ValueError("developer.command_timeout_seconds must be positive")
    if cfg.developer.max_file_bytes <= 0:
        raise ValueError("developer.max_file_bytes must be positive")
    if cfg.developer.upgrade_enabled and not cfg.developer.enabled:
        raise ValueError("developer.upgrade_enabled requires developer.enabled")
    if cfg.desktop.backend not in ("mac", "fake"):
        raise ValueError(f"desktop.backend must be 'mac' or 'fake', got {cfg.desktop.backend!r}")
    if cfg.desktop.idle_minutes < 0:
        raise ValueError("desktop.idle_minutes must not be negative")
    if cfg.desktop.hours:
        import re

        if not re.fullmatch(r"\d{2}:\d{2}-\d{2}:\d{2}", cfg.desktop.hours.strip()):
            raise ValueError("desktop.hours must look like '22:00-07:00'")

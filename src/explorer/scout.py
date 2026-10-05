"""The scout's output skill: record a free AI provider it found, for the owner to act on.

The scout (persona `scout`, `[scout]` in its config) researches LLM providers with a genuinely free
tier and writes each solid find, with the pages it read, to a Markdown file the owner reads
(`scout.report_file`, `~/bots/common-data/providers-found.md` by default). The bots never sign up or
create keys: this is a recommendation the owner reviews, then, for any worth adding, the owner creates
the key (and `model.auto_discover_providers` picks it up). Plain file, written atomically; nothing
leaves the Mac beyond the research reads themselves.
"""
from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path

from .actions import Provider
from .config import ScoutConfig

HEADER = ("# Free AI providers and tools the scout has found\n\nWritten by the scout bot for the owner to review. The bots never "
          "sign up. An AI model provider: add a key yourself for any worth having (drop it at ~/bots/common-data/keys/<name>.key "
          "and it joins the model chain). Any other tool (search, data, verification): a key alone does nothing -- tell the dev "
          "agent to wire it in.\n")
# What a find is called when the owner is told about it. "model" is the only kind a key file alone switches on.
CATEGORY_LABELS = {"model": "AI provider", "search": "search tool", "data": "data source", "verification": "verification tool", "tool": "tool"}
_MODEL_HINTS = re.compile(r"\b(llm|llms|language model|chat completions?|inference|openai-compatible|tokens? per|gpt|llama|qwen|mistral|gemma|glm|deepseek|claude)\b", re.I)
_OTHER_HINTS = (
    ("verification", re.compile(r"\b(verif\w*|validat\w*|deliverability)\b", re.I)),
    ("search", re.compile(r"\b(web search|search api|search engine|serp|page reader|reader api|scrap\w*|crawl\w*)\b", re.I)),
    ("data", re.compile(r"\b(dataset|open data|company data|business data|records|registry|directory)\b", re.I)),
)
_ENTRY = re.compile(r"^## ", re.MULTILINE)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "provider"


HEADER_AGENTS = ("# AI agents the Onion Reader has found\n\nWritten by the Onion Reader for the owner (asked in its chat, "
                 "2026-09-25): AI agents, free if possible, and what each one does. Nothing here was signed up for or run; "
                 "every line comes from a page the bot read.\n")


def find_category(p: Provider) -> str:
    """One of CATEGORY_LABELS for this find: what the model said when it names one, else read from the record's own
    words. Capabilities that say verification / search / data win over a stray model name; nothing recognisable is a
    "tool", never an "AI provider" by default."""
    said = p.category.strip().lower()
    for key in CATEGORY_LABELS:
        if said.startswith(key) or (key == "model" and said in ("ai", "llm", "ai provider", "ai model")):
            return key
    text = " ".join([p.name, p.free_terms, " ".join(p.models), p.why])
    for key, pattern in _OTHER_HINTS:
        if pattern.search(text):
            return key
    return "model" if _MODEL_HINTS.search(text) or p.base_url.rstrip("/").endswith("/v1") else "tool"


def find_label(p: Provider) -> str:
    return CATEGORY_LABELS[find_category(p)]


def entry_markdown(p: Provider, now: dt.datetime, kind: str = "provider") -> str:
    models = ", ".join(m.strip() for m in p.models if m.strip()) or "(not noted)"
    sources = "\n".join(f"- {s.strip()}" for s in p.sources if s.strip()) or "- (none)"
    card = "needs a card" if p.needs_card else "no card required"
    if kind == "agent":
        return (
            f"## {p.name.strip()}\n\n"
            f"Found {now.date().isoformat()}.\n\n"
            f"- **Website:** {p.base_url.strip()}\n"
            f"- **Free?** {p.free_terms.strip()} ({card})\n"
            f"- **Runs on / models:** {models}\n"
            f"- **What it does:** {p.why.strip()}\n\n"
            f"Sources:\n{sources}\n"
        )
    if find_category(p) != "model":
        return (
            f"## {p.name.strip()}\n\n"
            f"Found {now.date().isoformat()}. A {find_label(p)}, not a model provider: a key alone does nothing; tell the dev agent to wire it in.\n\n"
            f"- **Website:** {p.base_url.strip()}\n"
            f"- **Free terms:** {p.free_terms.strip()} ({card})\n"
            f"- **What it does:** {models}\n\n"
            f"{p.why.strip()}\n\n"
            f"Sources:\n{sources}\n"
        )
    return (
        f"## {p.name.strip()}\n\n"
        f"Found {now.date().isoformat()}. Suggested key file: `~/bots/common-data/keys/{slug(p.name)}.key`.\n\n"
        f"- **Endpoint:** {p.base_url.strip()}\n"
        f"- **Free terms:** {p.free_terms.strip()} ({card})\n"
        f"- **Models:** {models}\n\n"
        f"{p.why.strip()}\n\n"
        f"Sources:\n{sources}\n"
    )


def existing_names(report_file: Path) -> set[str]:
    """Lower-cased provider names already in the report, so the scout never adds one twice."""
    try:
        text = report_file.read_text(encoding="utf-8")
    except OSError:
        return set()
    return {line[3:].strip().lower() for line in text.splitlines() if line.startswith("## ")}


def record_provider(cfg: ScoutConfig, provider: Provider, now: dt.datetime | None = None) -> Path:
    """Append the provider to the report file (creating it with a header), atomically. Returns the file."""
    now = now or dt.datetime.now()
    path = Path(cfg.report_file).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    kind = getattr(cfg, "kind", "provider")
    body = path.read_text(encoding="utf-8") if path.exists() else (HEADER_AGENTS if kind == "agent" else HEADER)
    if not body.endswith("\n"):
        body += "\n"
    body += "\n" + entry_markdown(provider, now, kind)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(body, encoding="utf-8")
    os.replace(tmp, path)
    return path

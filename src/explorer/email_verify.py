"""Does a business email accept mail? (owner, 2026-10-02: a key for QuickEmailVerification, found by the Scout.)

The engine already proves a lead's email is printed on the business's own page. This adds the other half: one call to
a verification service says whether the mailbox exists. A result is cached per address for 30 days in
common-data/shared-state/email-verify.json, so an address costs one credit; when the service is unreachable, out of
credits or the key is missing, the answer is "unverified" and the lead goes through -- a checker never stops the family.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
from pathlib import Path

import httpx

ENDPOINT = "https://api.quickemailverification.com/v1/verify"
FALLBACK_ENDPOINT = "https://api.sniffmail.io/verify"  # Sniffmail's free tier: syntax, MX and disposable checks only
CACHE_DAYS = 30


class EmailVerifier:
    def __init__(self, key_file: str | Path, cache_file: str | Path, logger: logging.Logger | None = None, client: httpx.Client | None = None,
                 fallback_key_file: str | Path = ""):
        self.fallback_key_file = Path(fallback_key_file).expanduser() if fallback_key_file else None
        self.key_file = Path(key_file).expanduser() if key_file else None
        self.cache_file = Path(cache_file).expanduser()
        self.logger = logger or logging.getLogger("explorer")
        self.client = client

    def _key(self) -> str:
        try:
            return self.key_file.read_text(encoding="utf-8").strip() if self.key_file else ""
        except OSError:
            return ""

    def _cache(self) -> dict:
        try:
            data = json.loads(self.cache_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _remember(self, email: str, verdict: dict) -> None:
        try:
            data = self._cache()
            data[email] = verdict
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_file.with_name(self.cache_file.name + f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")
            tmp.replace(self.cache_file)
        except OSError as exc:
            self.logger.warning("email verify cache not written: %s", exc)

    def _basic(self, email: str, why: str) -> dict | None:
        """The fallback's shallower verdict when the main service cannot answer: a domain with no mail server is
        invalid, a disposable mailbox is flagged, anything else is "unknown" (the mailbox itself is not confirmed)."""
        try:
            key = self.fallback_key_file.read_text(encoding="utf-8").strip() if self.fallback_key_file else ""
        except OSError:
            key = ""
        if not key:
            return None
        try:
            client = self.client or httpx.Client(timeout=40.0)
            r = client.post(FALLBACK_ENDPOINT, json={"email": email}, headers={"Authorization": "Bearer " + key})
            d = r.json() if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(d, dict) or "mx_valid" not in d:
            return None
        mx = bool(d.get("mx_valid"))
        verdict = {"result": "unknown" if mx else "invalid",
                   "reason": "domain accepts mail, mailbox not confirmed (basic check)" if mx else "the domain has no mail server",
                   "accept_all": False, "role": bool(d.get("is_role_account")), "disposable": bool(d.get("is_disposable")),
                   "at": dt.datetime.now().isoformat(timespec="seconds"), "credits": "", "by": "basic", "main": why}
        self._remember(email, verdict)
        return verdict

    def check(self, email: str) -> dict:
        """{"result": valid | invalid | unknown | unverified, "reason", "accept_all", "role", "disposable", "at", "credits"}."""
        email = (email or "").strip().lower()
        unverified = {"result": "unverified", "reason": "", "accept_all": False, "role": False, "disposable": False}
        if not email:
            return unverified
        hit = self._cache().get(email)
        if isinstance(hit, dict) and hit.get("at"):
            try:
                if (dt.datetime.now() - dt.datetime.fromisoformat(str(hit["at"]))).days < CACHE_DAYS:
                    return {**hit, "cached": True}
            except ValueError:
                pass
        key = self._key()
        if not key:
            return self._basic(email, "no key") or {**unverified, "reason": "no key"}
        try:
            client = self.client or httpx.Client(timeout=40.0)
            r = client.get(ENDPOINT, params={"email": email, "apikey": key})
        except httpx.HTTPError as exc:
            return self._basic(email, "unreachable") or {**unverified, "reason": f"service unreachable ({type(exc).__name__})"}
        if r.status_code != 200:
            return self._basic(email, f"answered {r.status_code}") or {**unverified, "reason": f"service answered {r.status_code}"}  # 402/429: out of credits
        try:
            d = r.json()
        except ValueError:
            return {**unverified, "reason": "unreadable answer"}
        if str(d.get("success", "true")).lower() != "true" or d.get("result") not in ("valid", "invalid", "unknown"):
            return {**unverified, "reason": str(d.get("message") or "no result")[:80]}
        flag = lambda k: str(d.get(k, "false")).lower() == "true"  # noqa: E731
        verdict = {"result": d["result"], "reason": str(d.get("reason", ""))[:60], "accept_all": flag("accept_all"), "role": flag("role"),
                   "disposable": flag("disposable"), "at": dt.datetime.now().isoformat(timespec="seconds"),
                   "credits": r.headers.get("x-qev-remaining-credits", "")}
        self._remember(email, verdict)
        return verdict


def describe(verdict: dict) -> str:
    """The text for the board's "Email check" cell."""
    day = str(verdict.get("at", ""))[:10]
    r = verdict.get("result")
    if r == "valid":
        extra = " (catch-all domain: accepts any address)" if verdict.get("accept_all") else ""
        return f"deliverable{extra}, checked {day}"
    if r == "invalid":
        return f"NOT deliverable ({verdict.get('reason') or 'rejected'}), checked {day}"
    if r == "unknown":
        return f"could not be confirmed ({verdict.get('reason') or 'no answer from the mail server'}), checked {day}"
    return "not checked" + (f" ({verdict.get('reason')})" if verdict.get("reason") else "")

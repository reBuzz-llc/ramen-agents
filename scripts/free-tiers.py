#!/usr/bin/env python3
"""The free limits beyond the model providers: the hosting, the databases, file storage, training. One read-only look
per service, hourly (launchd com.ramen-agents.free-tiers), written to common-data/shared-state/free-tiers.json for the
dashboard's Allowance view ("Other free tiers"). The dashboard reads only that file: it never holds a key or calls a
provider.

Each row: used, limit, unit, when it resets, a status word ("ok", "near" from 80 %, "over" from 100 %, "unknown"), and
how we know. Where the free plan offers no number, the row says "not measurable" and where to look, never a guess.

The services are yours to list, in common-data/configs/free-tiers.toml (see free-tiers.example.toml next to it); with
no file, nothing is listed. Each [[service]] has name, what, limit, unit, resets and one way to measure:

    measure = "none"        not measurable; `where` says where to look (a console's usage page)
    measure = "json"        a number in a JSON file under common-data/shared-state: `file`, `field`, optional
                            `scale` (multiplied in), e.g. the portal database's size from db-standby.json's db_mb
    measure = "s3-bucket"   the bytes in one bucket (S3 ListObjectsV2, listed read-only and summed): `endpoint`,
                            `bucket`, `region`, `key_file` (common-data/keys/<file>, one line "access-id:secret");
                            reported in GB
    measure = "neon-api"    a Neon project's period numbers (GET /api/v2/projects/<id>): `key_file` (a Neon API key),
                            `field` = "data_transfer" (GB) or "compute_hours"

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/free-tiers.py          # write the file
    ~/Projects/bot/.venv/bin/python ~/bots/scripts/free-tiers.py --print  # and print the rows
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import os
import re
import sys
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BOTS = Path(os.environ.get("BOTS_DIR", Path.home() / "bots"))
GB = 1024 ** 3


def paths(bots: Path = BOTS) -> dict[str, Path]:
    return {"keys": bots / "common-data" / "keys", "shared": bots / "common-data" / "shared-state",
            "config": bots / "common-data" / "configs" / "free-tiers.toml"}


def _ctx():
    """TLS with certifi's roots when present (some Python builds have no system roots: CERTIFICATE_VERIFY_FAILED)."""
    import ssl

    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def row(name: str, what: str, used: float | None, limit: float | None, unit: str, resets: str, how: str) -> dict:
    """A row with its status: "near" from 80 % (the ticker warns), "over" from 100 %, "ok" under, "unknown" without a
    number."""
    if used is None or not limit:
        status = "unknown"
    else:
        share = used / limit
        status = "over" if share >= 1 else "near" if share >= 0.8 else "ok"
    return {"name": name, "what": what, "used": None if used is None else round(used, 2), "limit": limit, "unit": unit, "resets": resets, "status": status, "how": how}


def _json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def first_of_next_month(today: dt.date) -> str:
    return (today.replace(day=1) + dt.timedelta(days=32)).replace(day=1).isoformat()


def resets_text(value: str, today: dt.date) -> str:
    """"monthly" becomes the first of next month; "weekly" next Monday; anything else is shown as written."""
    if value == "monthly":
        return first_of_next_month(today)
    if value == "weekly":
        return (today + dt.timedelta(days=7 - today.weekday())).isoformat()
    return value


# ---- S3 (AWS Signature V4, read-only listing) -------------------------------------------------------------------------
def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def s3_get(endpoint: str, path: str, query: dict, access: str, secret: str, now: dt.datetime, region: str = "auto") -> bytes:
    """A signed S3 GET. An endpoint with a path (Supabase: /storage/v1/s3) signs and requests the whole path; the region
    must be the store's own ("auto" for Cloudflare R2), or the request is refused."""
    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.netloc
    path = parsed.path.rstrip("/") + path
    base = f"{parsed.scheme}://{host}"
    amz = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    qs = "&".join(f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted(query.items()))
    payload = hashlib.sha256(b"").hexdigest()
    canonical = f"GET\n{path}\n{qs}\nhost:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n\nhost;x-amz-content-sha256;x-amz-date\n{payload}"
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    k = _sign(_sign(_sign(_sign(f"AWS4{secret}".encode(), day), region), "s3"), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={sig}"
    req = urllib.request.Request(f"{base}{path}{'?' + qs if qs else ''}", headers={"x-amz-date": amz, "x-amz-content-sha256": payload, "Authorization": auth})
    with urllib.request.urlopen(req, timeout=30, context=_ctx()) as r:  # noqa: S310
        return r.read()


def bucket_bytes(endpoint: str, bucket: str, access: str, secret: str, region: str) -> int:
    """The bytes stored in one bucket: its objects listed read-only (S3 ListObjectsV2) and summed."""
    now = dt.datetime.now(dt.timezone.utc)
    total, token = 0, None
    for _ in range(200):
        q = {"list-type": "2", **({"continuation-token": token} if token else {})}
        page = s3_get(endpoint, f"/{urllib.parse.quote(bucket)}", q, access, secret, now, region).decode()
        total += sum(int(s) for s in re.findall(r"<Size>(\d+)</Size>", page))
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", page)
        if not m:
            return total
        token = m.group(1)
    return total


# ---- Neon ---------------------------------------------------------------------------------------------------------
def neon_project(key: str) -> tuple[dict | None, str]:
    try:
        req = urllib.request.Request("https://console.neon.tech/api/v2/projects", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20, context=_ctx()) as r:  # noqa: S310
            projects = json.loads(r.read()).get("projects") or []
        if not projects:
            return None, "Neon's API lists no project for that key"
        req = urllib.request.Request(f"https://console.neon.tech/api/v2/projects/{projects[0]['id']}", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20, context=_ctx()) as r:  # noqa: S310
            return json.loads(r.read()).get("project"), ""
    except urllib.error.HTTPError as e:
        return None, f"Neon's API answered {e.code}"
    except OSError as e:
        return None, f"Neon's API did not answer ({str(e)[:60]})"


# ---- one service ------------------------------------------------------------------------------------------------------
def measure(svc: dict, p: dict[str, Path], today: dt.date, cache: dict) -> dict:
    name, what, unit = str(svc.get("name", "?")), str(svc.get("what", "")), str(svc.get("unit", ""))
    limit = svc.get("limit")
    limit = float(limit) if isinstance(limit, (int, float)) else None
    resets = resets_text(str(svc.get("resets", "")), today)
    kind = svc.get("measure", "none")

    def out(used: float | None, how: str) -> dict:
        return row(name, what, used, limit, unit, resets, how)

    if kind == "none":
        return out(None, f"not measurable: {svc.get('where') or 'the free plan has no usage API'}")
    if kind == "json":
        data = _json(p["shared"] / str(svc.get("file", "")), {})
        value = data.get(str(svc.get("field", ""))) if isinstance(data, dict) else None
        if not isinstance(value, (int, float)):
            return out(None, f"not measurable yet: no {svc.get('field')} in shared-state/{svc.get('file')}")
        at = f", {str(data.get('at'))[:16]}" if data.get("at") else ""
        return out(float(value) * float(svc.get("scale", 1)), f"shared-state/{svc.get('file')} {svc.get('field')}{at}")
    if kind == "s3-bucket":
        key_file = p["keys"] / str(svc.get("key_file", ""))
        if not key_file.is_file():
            return out(None, f"not measurable: no key file common-data/keys/{svc.get('key_file')} (one line, access-id:secret)")
        access, _, secret = key_file.read_text(encoding="utf-8").strip().partition(":")
        if not (access and secret and svc.get("endpoint") and svc.get("bucket")):
            return out(None, "not measurable: the key is not access-id:secret, or endpoint or bucket is missing")
        try:
            used = bucket_bytes(str(svc["endpoint"]), str(svc["bucket"]), access, secret, str(svc.get("region") or "auto")) / GB
            return out(used, f"the bucket '{svc['bucket']}' listed and summed (S3 API)")
        except urllib.error.HTTPError as e:
            return out(None, f"not measurable: the store answered {e.code}")
        except OSError as e:
            return out(None, f"not measurable: the store did not answer ({str(e)[:60]})")
    if kind == "neon-api":
        key_file = p["keys"] / str(svc.get("key_file", ""))
        if not key_file.is_file():
            return out(None, f"not measurable: no Neon API key at common-data/keys/{svc.get('key_file')}; the console's Usage page shows it")
        key = key_file.read_text(encoding="utf-8").strip()
        if key not in cache:
            cache[key] = neon_project(key)
        project, why = cache[key]
        if not project:
            return out(None, f"not measurable: {why}")
        start = str(project.get("consumption_period_start") or "")[:10]
        if svc.get("field") == "compute_hours":
            used = float(project.get("compute_time_seconds") or project.get("active_time_seconds") or 0) / 3600
        else:
            used = float(project.get("data_transfer_bytes") or 0) / GB
        return out(used, f"Neon's API, the period from {start or '?'}")
    return out(None, f"not measurable: unknown measure '{kind}' in free-tiers.toml")


def build(today: dt.date | None = None, bots: Path = BOTS) -> dict:
    today = today or dt.date.today()
    p = paths(bots)
    try:
        services = tomllib.loads(p["config"].read_text(encoding="utf-8")).get("service") or []
    except OSError:
        services = []
    except tomllib.TOMLDecodeError as e:
        return {"at": dt.datetime.now().isoformat(timespec="seconds"), "rows": [row("free-tiers.toml", "the list itself", None, None, "", "", f"not readable: {e}")]}
    cache: dict = {}
    return {"at": dt.datetime.now().isoformat(timespec="seconds"), "rows": [measure(s, p, today, cache) for s in services if isinstance(s, dict)]}


def main(argv: list[str]) -> int:
    data = build()
    shared = paths()["shared"]
    shared.mkdir(parents=True, exist_ok=True)
    out = shared / "free-tiers.json"
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(out)
    if "--print" in argv:
        if not data["rows"]:
            print(f"no services listed: copy common-data/configs/free-tiers.example.toml to {paths()['config']} and edit it")
        for r in data["rows"]:
            used = "?" if r["used"] is None else r["used"]
            print(f"{r['name']:14s} {r['what']:34s} {used} of {r['limit']} {r['unit']:12s} {r['status']:8s} {r['how'][:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

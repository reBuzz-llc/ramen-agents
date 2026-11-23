"""The read-only copy of the code on the main branch: is it true, and is it fit to publish?

engine/ and fleet/ on main are copies of the `engine` and `fleet` branches, for reading. CODE-COPY.json names the two commits
they were copied from. Installing and updating always use the branches.

    python3 scripts/check_code_copy.py --verify                  # the copy equals the commits it names (this is the CI check)
    python3 scripts/check_code_copy.py --verify --unpushed       # the same, for two commits not on their branches yet
    python3 scripts/check_code_copy.py --words FLEET ENGINE      # private words in those two commits (a maintainer, before a sync)
    python3 scripts/check_code_copy.py --note fleet              # the exact text of a folder's READ-ONLY-COPY.md

--words needs the maintainers' two lists, kept outside this repository: RAMEN_PRIVATE_WORDS, and RAMEN_COPY_ALLOW (default:
starter-allow.txt beside it), one reviewed exception a line: kind | value | paths (comma-separated globs, or *) | reason.
Kinds: word, email-domain, path, binary (value *: a binary file left unread), and refuse (a literal the copy must never hold, wherever
it is). --words reads the text of every file, file names, the text inside binaries (a PDF's streams too) and the messages of the
commits not yet on the remote, and refuses internal work-item references. Reserved examples pass by themselves: *.example, *.invalid, *.test, 555-01xx phone numbers.
Exit 0 when clean, 1 with each problem printed (a private word itself is never printed).
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
import types
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "CODE-COPY.json"
MARKER = "READ-ONLY-COPY.md"
FOLDERS = ("fleet", "engine")
OWN_ADDRESSES = ("reBuzz-llc@users.noreply.github.com", "github.com/reBuzz-llc/ramen-agents", "rebuzz-llc.github.io/ramen-agents",
                 "reBuzz-llc/ramen-agents")
RESERVED_MAIL = (".example", ".invalid", ".test")
TEST_PHONE = re.compile(r"555[ .-]01\d\d$")
_SESSIONS = "|".join(n + "CC" for n in ("creator", "leader", "vali", "app", "market", "site", "world", "peek"))     # never written whole here
_HTTP = "200|201|204|301|302|304|400|401|402|403|404|405|409|410|422|429|500|502|503|504"
WORK_REFS = re.compile(r"(?i)(?<![a-z0-9])queue[ _#-]*\d{2,4}(?![0-9])|(?<![A-Za-z0-9])(?:" + _SESSIONS + r")(?![A-Za-z0-9])|\bfamily's \d{3}\b"
                       r"|^\s*(?:#|//|/\*+|\"\"\")\s*(?!(?:" + _HTTP + r")\b)\d{3}[a-z]?:")


def marker_text(name: str) -> str:
    return (f"This folder is a copy of the `{name}` branch, for reading. Nothing is installed or run from it: "
            "install from the branch, as the README says.\n")


def git(*args: str, text: bool = True):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=text, check=True).stdout


def tree(ref: str) -> dict[str, str]:
    """path -> mode and blob id of every file under a commit or a commit:folder."""
    out = {}
    for line in git("ls-tree", "-r", ref).splitlines():
        meta, path = line.split("\t", 1)
        mode, _kind, oid = meta.split()
        out[path] = f"{mode} {oid}"
    return out


def verify(on_branches: bool = True) -> list[str]:
    if not MANIFEST.is_file():
        return ["CODE-COPY.json is missing"]
    copied = json.loads(MANIFEST.read_text(encoding="utf-8"))
    bad = []
    dirty = git("status", "--porcelain", "--", *FOLDERS, MANIFEST.name).splitlines()
    if dirty:
        bad.append(f"{len(dirty)} uncommitted change(s) in the copy, first: {dirty[0][3:]}")
    for name in FOLDERS:
        commit = str(copied.get(name) or "")
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            bad.append(f"{name}: CODE-COPY.json names no full commit")
            continue
        try:
            if git("cat-file", "-t", commit).strip() != "commit":
                bad.append(f"{name}: {commit[:12]} in CODE-COPY.json is not a commit")
                continue
            want, have = tree(commit), tree(f"HEAD:{name}")
        except subprocess.CalledProcessError:
            bad.append(f"{name}: commit {commit[:12]} or the folder is not here (fetch the {name} branch)")
            continue
        if MARKER not in have:
            bad.append(f"{name}/{MARKER} is missing")
        elif git("show", f"HEAD:{name}/{MARKER}") != marker_text(name):
            bad.append(f"{name}/{MARKER}: its text is not the copy's marker")
        have.pop(MARKER, None)
        for path in sorted(set(want) | set(have)):
            if want.get(path) != have.get(path):
                bad.append(f"{name}/{path}: differs from {commit[:12]}")
        branch = f"refs/remotes/origin/{name}"
        if on_branches and subprocess.run(["git", "-C", str(ROOT), "rev-parse", "-q", "--verify", branch], capture_output=True).returncode == 0 and \
                subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", commit, branch], capture_output=True).returncode != 0:
            bad.append(f"{name}: {commit[:12]} is not on the {name} branch")
    return bad


def allow_list(path: Path) -> list[tuple[str, str, list[str]]]:
    out = []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 4 or parts[0] not in ("word", "email-domain", "path", "binary", "refuse") or not all(parts):
            raise SystemExit(f"{path.name}:{n}: expected kind | value | paths | reason")
        out.append((parts[0], parts[1].lower(), [g.strip() for g in parts[2].split(",")]))
    return out


def allowed(rules, kind: str, value: str, path: str) -> bool:
    return any(k == kind and v == value.lower() and any(fnmatch.fnmatch(path, g) for g in globs) for k, v, globs in rules)


LITERAL = re.compile(r'"([^"\\\n]*)"|\'([^\'\\\n]*)\'|`([^`\\$\n]*)`')


def built_from(parts: list[str], word: str) -> bool:
    """These string literals, in order, spell the word, with or without its own separators between them."""
    rest = word.lower()
    used = 0
    for part in parts:
        part = part.lower()
        if not part:
            continue
        if used and rest[:1] in "-. " and not rest.startswith(part):
            rest = rest[1:]
        if not rest.startswith(part):
            return False
        rest = rest[len(part):]
        used += 1
        if not rest:
            return used >= 2
    return False


def split_words(words, rules, path: str, text: str) -> list[str]:
    """A private word assembled from neighbouring string literals, as in ["a", "b"].join("-"), on one line or across lines."""
    found = [(n, next(x for x in m.groups() if x is not None)) for n, line in enumerate(text.splitlines(), 1) for m in LITERAL.finditer(line)]
    first: dict[str, list[str]] = {}
    for w in words:
        first.setdefault(w[0].lower(), []).append(w)
    out = []
    for i, (n, lit) in enumerate(found):
        if not lit:
            continue
        for w in first.get(lit[0].lower(), ()):
            if len(lit) < len(w) and built_from([x for _, x in found[i:i + 6]], w) and not allowed(rules, "word", w, path):
                out.append(f"{path}:{n}: a private word built from string parts")
    return out


def scan_text(checker, words, rules, path: str, text: str, built_in: bool = True) -> list[str]:
    for own in OWN_ADDRESSES:
        text = re.sub(re.escape(own), "ORG/REPO", text, flags=re.I)
    pats = [(w, re.compile(r"(?i)(?<![A-Za-z0-9])" + re.escape(w) + r"(?![A-Za-z0-9])")) for w in words]
    refused = [v for k, v, globs in rules if k == "refuse" and any(fnmatch.fnmatch(path, g) for g in globs)]
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if any(v in line.lower() for v in refused):
            out.append(f"{path}:{n}: a string the maintainers refuse")
        if WORK_REFS.search(line):
            out.append(f"{path}:{n}: an internal work-item reference")
        for what, pat in (checker.BUILT_IN if built_in else ()):
            for m in pat.finditer(line):
                got = m.group(0)
                if what == "an email address":
                    domain = got.rsplit("@", 1)[1].lower()
                    if domain.endswith(RESERVED_MAIL) or allowed(rules, "email-domain", domain, path):
                        continue
                elif what == "a phone number" and TEST_PHONE.search(got):
                    continue
                elif what == "a home-folder path" and allowed(rules, "path", got, path):
                    continue
                out.append(f"{path}:{n}: {what}")
        for w, pat in pats:
            if pat.search(line) and not allowed(rules, "word", w, path):
                out.append(f"{path}:{n}: a word on the private list")
    return out + split_words(words, rules, path, text)


def binary_text(blob: bytes) -> tuple[str, bool]:
    """The readable text inside a binary, and whether it is real text (a PDF's streams) rather than strings from image or font bytes."""
    parts = [blob]
    is_pdf = blob[:5] == b"%PDF-"
    if is_pdf:
        for raw in re.findall(rb"stream\r?\n(.*?)\r?\n?endstream", blob, re.S):
            try:
                parts.append(zlib.decompress(raw))
            except zlib.error:
                pass
    found: list[str] = []
    for data in parts:
        found += [m.decode("ascii") for m in re.findall(rb"[\x20-\x7e]{6,}", data)]
        found += [m.replace(b"\0", b"").decode("ascii") for m in re.findall(rb"(?:[\x20-\x7e]\x00){6,}", data)]
    return "\n".join(found), is_pdf


def scan_files(checker, words, rules, prefix: str, ref: str, skip: tuple[str, ...] = ()) -> list[str]:
    out = []
    for f in git("ls-tree", "-r", "--name-only", ref).splitlines():
        if f.startswith(skip) and skip:
            continue
        shown = f"{prefix}{f}"
        out += [x.replace(":1:", ": (its file name):") for x in scan_text(checker, words, rules, shown, f, built_in=False)]
        blob = git("show", f"{ref}:{f}", text=False)
        try:
            if b"\0" in blob:
                raise UnicodeDecodeError("utf-8", b"", 0, 1, "binary")
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            if allowed(rules, "binary", "*", shown):
                continue
            inner, real = binary_text(blob)
            out += scan_text(checker, words, rules, shown, inner, built_in=real)
            continue
        out += scan_text(checker, words, rules, shown, text)
    return out


def new_messages(checker, words, rules, name: str, tip: str) -> list[str]:
    """The commit messages on `tip` that the remote branch does not have yet."""
    base = f"refs/remotes/origin/{name}"
    if subprocess.run(["git", "-C", str(ROOT), "rev-parse", "-q", "--verify", base], capture_output=True).returncode != 0:
        return [f"{name}: no {base} here, so the new commit messages cannot be told apart (fetch it)"]
    out = []
    for sha in git("rev-list", f"{base}..{tip}").split():
        msg = "\n".join(l for l in git("log", "-1", "--format=%B", sha).splitlines() if not l.lower().startswith("co-authored-by:"))
        out += scan_text(checker, words, rules, f"commit {sha[:12]} ({name})", msg)
    return out


def words_check(fleet: str, engine: str) -> list[str]:
    private = Path(os.environ.get("RAMEN_PRIVATE_WORDS") or "~/.config/ramen-agents/private-words.txt").expanduser()
    allow = Path(os.environ.get("RAMEN_COPY_ALLOW") or private.with_name("starter-allow.txt")).expanduser()
    if not private.is_file() or not allow.is_file():
        return [f"the private word list or the allow list is not there ({private.name}, {allow.name})"]
    checker = types.ModuleType("check_private_words")
    exec(git("show", f"{fleet}:scripts/check_private_words.py"), checker.__dict__)
    words, _src = checker.private_words(private)
    rules = allow_list(allow)
    out = []
    for name, ref in (("fleet", fleet), ("engine", engine)):
        out += scan_files(checker, words, rules, f"{name}/", ref)
        out += new_messages(checker, words, rules, name, ref)
    out += scan_files(checker, words, rules, "", "HEAD", skip=("fleet/", "engine/"))
    out += new_messages(checker, words, rules, "main", "HEAD")
    return out


def main(argv: list[str]) -> int:
    if argv in (["--verify"], ["--verify", "--unpushed"]):
        bad = verify(on_branches="--unpushed" not in argv)
        ok = "the copy equals the commits in CODE-COPY.json"
    elif len(argv) == 2 and argv[0] == "--note" and argv[1] in FOLDERS:
        sys.stdout.write(marker_text(argv[1]))
        return 0
    elif len(argv) == 3 and argv[0] == "--words":
        bad = words_check(argv[1], argv[2])
        ok = "no private words"
    else:
        print(__doc__)
        return 2
    for line in bad[:200]:
        print(line)
    print(ok if not bad else f"{len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

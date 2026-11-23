#!/usr/bin/env python3
"""Does a tree meant for the public hold a phone number or a private word, also inside a document?

It reads every file of a git ref or a folder: text as text, a PDF by its extracted text and its link targets. Any other binary document is a
failure, because a file that cannot be read has not passed. Pictures are listed, not read here. It prints file and kind, never the value.

A number fails when it is:
- on a dial code the maintainers must not show, in any written form (a "dial" line in their private public-numbers file);
- the target of a wa.me, WhatsApp, tel:, sms: or callto: link;
- any other phone number that is not on the maintainers' public-number list (sha256:<hash of its digits> | file globs | reason). The list holds a
  hash, so it never carries the number, and each entry is good only in the files it names.

The lists stay out of the public repository: beside RAMEN_PRIVATE_WORDS, else in common-data/public-text, else in ~/.config/ramen-agents.
The ranges reserved for fiction (555-0100 to 555-0199, and the UK's 020 7946 0xxx) cannot belong to anyone: they are counted apart and pass.

    python3 scripts/public_file_check.py --ref <repo> <ref> [--ref <repo> <ref>] [--dir <folder>]
"""
from __future__ import annotations

import argparse
import collections
import fnmatch
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
_SEP = r"[\s().-]*"
NEVER = re.compile(r"(?!)")
DIAL = NEVER                    # set by use_dial_codes(), from the private list: no code is written in this file
TARGET = re.compile(r"(?i)(?:wa\.me/|whatsapp\.com/send/?\?phone=|whatsapp://send/?\?phone=|\btel:|\bsms:|\bcallto:)\s*(\+?[\d(][\d\s().-]{5,}\d)(?!\d|\$\{)")      # a number still being built in a template is no target yet
PHONE = re.compile(r"(?<![\w/.:#-])(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w/-])|(?<![\w/.:#-])\+\d(?:[ ().-]?\d){7,14}(?![\w/-])")
PICTURES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", ".heic", ".tif", ".tiff", ".bmp"})
FONTS = frozenset({".woff", ".woff2", ".ttf", ".otf", ".eot"})
PDF_URI = re.compile(rb"/URI\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)")


def lists_dir() -> Path:
    named = os.environ.get("RAMEN_PRIVATE_WORDS")
    if named:
        return Path(named).expanduser().parent
    here = HERE.parent / "common-data" / "public-text"
    return here if here.is_dir() else Path("~/.config/ramen-agents").expanduser()


def use_dial_codes(codes: list[str]) -> None:
    global DIAL
    alt = "|".join(re.escape(x) for x in codes)
    DIAL = re.compile(rf"(?:\+|(?<!\d)00){_SEP}(?:{alt}){_SEP}\d(?:{_SEP}\d){{5,}}|(?<![\d.])(?:{alt})\d{{9,10}}(?!\d)") if codes else NEVER


def load_dial_codes(path: Path | None = None) -> list[str]:
    p = path or lists_dir() / "public-numbers.txt"
    if not p.is_file():
        return []
    return [x[1] for x in ([y.strip() for y in raw.split("|")] for raw in p.read_text(encoding="utf-8").splitlines()) if len(x) == 3 and x[0] == "dial" and x[1].isdigit()]


def digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def fictional(value: str) -> bool:
    """The ranges set aside for fiction, which cannot belong to anyone: 555-0100 to 555-0199 in North America, 020 7946 0000 to 0999 in the UK."""
    d = digits(value)
    return len(d) >= 10 and (d[-7:-2] == "55501" or bool(re.search(r"(?:^|44|0)2079460\d{3}$", d)))


def number_key(digits_only: str) -> str:
    return "sha256:" + hashlib.sha256(digits_only.encode("ascii")).hexdigest()


def load_public(path: Path | None = None) -> list[tuple[str, list[str]]]:
    """The public numbers: sha256:<hash of the digits> | file globs | reason. No file, or no line, means none."""
    p = path or lists_dir() / "public-numbers.txt"
    out: list[tuple[str, list[str]]] = []
    if not p.is_file():
        return out
    for n, raw in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [x.strip() for x in line.split("|")]
        if len(parts) == 3 and parts[0] == "dial" and parts[1].isdigit():
            continue
        if len(parts) != 3 or not re.fullmatch(r"sha256:[0-9a-f]{64}", parts[0]) or not all(parts):
            raise SystemExit(f"{p.name}:{n}: expected sha256:<hash of the digits> | file globs | reason")
        out.append((parts[0], [g.strip() for g in parts[1].split(",")]))
    return out


def is_public(value: str, path: str, public: list[tuple[str, list[str]]]) -> bool:
    key = number_key(digits(value))
    return any(key == n and any(fnmatch.fnmatch(path, g) for g in globs) for n, globs in public)


def number_hits(text: str, path: str, public: list[tuple[str, list[str]]]) -> tuple[list[tuple[int, str]], int]:
    """([(line, kind)], how many fictional numbers). A number found by a stronger rule is not counted again."""
    out: list[tuple[int, str]] = []
    made_up = 0
    for n, line in enumerate(text.splitlines(), 1):
        taken: list[tuple[int, int]] = []
        for kind, rx in (("a number on the dial code", DIAL), ("a phone link target", TARGET), ("a phone number", PHONE)):
            for m in rx.finditer(line):
                if any(m.start() < b and a < m.end() for a, b in taken):
                    continue
                taken.append(m.span())
                value = m.group(1) if rx is TARGET else m.group(0)
                if fictional(value):
                    made_up += 1
                elif not is_public(value, path, public):
                    out.append((n, kind))
    return out, made_up


def _pdf_string(raw: bytes) -> str:
    if raw[:1] == b"<":
        h = re.sub(rb"\s", b"", raw[1:-1])
        data = bytes.fromhex((h + (b"0" if len(h) % 2 else b"")).decode("ascii"))
        return data[2:].decode("utf-16-be", "replace") if data[:2] == b"\xfe\xff" else data.decode("latin-1")
    body = raw[1:-1]
    return re.sub(rb"\\([()\\])", rb"\1", body).decode("latin-1")


def pdf_links(blob: bytes) -> list[str]:
    parts = [blob]
    for raw in re.findall(rb"stream\r?\n(.*?)\r?\n?endstream", blob, re.S):
        try:
            parts.append(zlib.decompress(raw))
        except zlib.error:
            pass
    return [_pdf_string(m) for data in parts for m in PDF_URI.findall(data)]


def read_pdf(blob: bytes) -> tuple[str, list[str], str]:
    """(text, link targets, why it could not be read). No text at all is not a pass: it may be pictures of text."""
    gs = shutil.which("gs") or next((p for p in ("/opt/homebrew/bin/gs", "/usr/local/bin/gs") if os.path.exists(p)), "")
    if not gs:
        return "", [], "ghostscript is not installed"
    if b"/Encrypt" in blob:
        return "", [], "the PDF is encrypted"
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d) / "in.pdf", Path(d) / "out.txt"
        src.write_bytes(blob)
        try:
            r = subprocess.run([gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", f"-sOutputFile={out}", str(src)],
                               capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            return "", [], "reading it timed out"
        if r.returncode != 0 or not out.exists():
            return "", [], "ghostscript could not read it"
        text = out.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        return "", [], "it holds no readable text"
    try:
        return text, pdf_links(blob), ""
    except (ValueError, UnicodeError):
        return "", [], "its link targets could not be read"


def load_words(path: Path | None = None) -> list[re.Pattern]:
    p = Path(os.environ["RAMEN_PRIVATE_WORDS"]).expanduser() if path is None and os.environ.get("RAMEN_PRIVATE_WORDS") else path or lists_dir() / "private-words.txt"
    words = [w.strip() for w in p.read_text(encoding="utf-8").splitlines() if w.strip() and not w.strip().startswith("#")] if p.is_file() else []
    return [re.compile(r"(?i)(?<![A-Za-z0-9])" + re.escape(w) + r"(?![A-Za-z0-9])") for w in words]


def allowed_words(path: Path | None = None) -> list[tuple[re.Pattern, list[str]]]:
    """The reviewed word exceptions of the starter's allow list. Its "binary" lines are not honoured: a document is always read."""
    p = path or Path(os.environ.get("RAMEN_COPY_ALLOW") or lists_dir() / "starter-allow.txt").expanduser()
    out = []
    if p.is_file():
        for raw in p.read_text(encoding="utf-8").splitlines():
            parts = [x.strip() for x in raw.split("|")]
            if len(parts) == 4 and parts[0] == "word":
                out.append((re.compile(r"(?i)(?<![A-Za-z0-9])" + re.escape(parts[1]) + r"(?![A-Za-z0-9])"), [g.strip() for g in parts[2].split(",")]))
    return out


def document_words(text: str, path: str, words: list[re.Pattern], allow: list[tuple[re.Pattern, list[str]]]) -> int:
    """How many private words a document holds, less the reviewed exceptions for that file."""
    free = [rx for rx, globs in allow if any(fnmatch.fnmatch(path, g) for g in globs)]
    cleaned = text
    for rx in free:
        cleaned = rx.sub(" ", cleaned)
    return sum(1 for rx in words if rx.search(cleaned))


class Report:
    def __init__(self) -> None:
        self.hits: list[tuple[str, str]] = []
        self.made_up = 0
        self.files = 0
        self.kinds: collections.Counter = collections.Counter()
        self.pictures: list[str] = []

    def add(self, where: str, kind: str) -> None:
        self.hits.append((where, kind))


def check_file(path: str, blob: bytes, rep: Report, public, words, allow) -> None:
    rep.files += 1
    ext = os.path.splitext(path)[1].lower()
    if ext in PICTURES:
        rep.kinds["picture"] += 1
        rep.pictures.append(path)
        return
    if ext in FONTS:
        rep.kinds["font"] += 1
        return
    if blob[:5] == b"%PDF-" or ext == ".pdf":
        rep.kinds["pdf"] += 1
        text, links, why = read_pdf(blob)
        if why:
            rep.add(path, f"could not be read ({why})")
            return
        found, made = number_hits(text, path, public)
        rep.made_up += made
        for n, kind in found:
            rep.add(f"{path} (printed text, line {n})", kind)
        for i, link in enumerate(links, 1):
            found, made = number_hits(link, path, public)
            rep.made_up += made
            for _, kind in found:
                rep.add(f"{path} (link {i})", kind)
        if (n := document_words("\n".join([text, *links]), path, words, allow)):
            rep.add(path, f"{n} word(s) on the private list")
        return
    try:
        if b"\0" in blob:
            raise UnicodeDecodeError("utf-8", b"", 0, 1, "binary")
        text = blob.decode("utf-8")
    except UnicodeDecodeError:
        rep.kinds["unread binary"] += 1
        rep.add(path, "could not be read (a binary type this check does not know)")
        return
    rep.kinds["text"] += 1
    found, made = number_hits(text, path, public)
    rep.made_up += made
    for n, kind in found:
        rep.add(f"{path}:{n}", kind)


def scan_ref(repo: str, ref: str, rep: Report, public, words, allow, prefix: str = "") -> None:
    names = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "-z", "--name-only", ref], capture_output=True, check=True).stdout.decode("utf-8").split("\0")
    if not any(names):
        raise SystemExit(f"no files at {ref}")
    for f in filter(None, names):
        blob = subprocess.run(["git", "-C", repo, "show", f"{ref}:{f}"], capture_output=True, check=True).stdout
        check_file(prefix + f, blob, rep, public, words, allow)


def scan_dir(folder: str, rep: Report, public, words, allow, prefix: str = "") -> None:
    root = Path(folder)
    if not root.is_dir():
        raise SystemExit(f"no such folder: {folder}")      # nothing read is not a pass
    for p in sorted(x for x in root.rglob("*") if x.is_file() and ".git" not in x.parts):
        check_file(prefix + str(p.relative_to(root)), p.read_bytes(), rep, public, words, allow)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", nargs=2, action="append", default=[], metavar=("REPO", "REF"))
    ap.add_argument("--dir", action="append", default=[])
    ap.add_argument("--dir-as", default="", help="the path a --dir's files have in the repository, e.g. docs/ for the built docs site")
    a = ap.parse_args(argv)
    if not a.ref and not a.dir:
        ap.error("name a --ref or a --dir")
    use_dial_codes(load_dial_codes())
    public, words, allow = load_public(), load_words(), allowed_words()
    bad = 0
    for label, run in [*((f"{r} {x}", (lambda rep, r=r, x=x: scan_ref(r, x, rep, public, words, allow))) for r, x in a.ref),
                       *((d, (lambda rep, d=d: scan_dir(d, rep, public, words, allow, a.dir_as))) for d in a.dir)]:
        rep = Report()
        run(rep)
        print(f"== {label}: {rep.files} files {dict(rep.kinds)}, {len(rep.hits)} hit(s), {rep.made_up} fictional number(s) passed")
        for where, kind in rep.hits:
            print(f"  {where}: {kind}")
        bad += len(rep.hits)
    print("clean" if not bad else f"{bad} hit(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

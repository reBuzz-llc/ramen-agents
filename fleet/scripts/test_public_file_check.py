"""A phone number fails in text and inside a PDF, and a document that cannot be read is not a pass. All numbers here are made up."""
from __future__ import annotations

import shutil
import zlib

import pytest

import public_file_check as c

CODE = "999"          # a code no country has
A, B, D = "212", "7123", "980"  # joined below, so this file holds no phone number of its own when the check reads it
FAKE = f"+{CODE} 980-0000000"
LINK = f"https://wa.me/{CODE}9800000000"
NOTE = "Need help? WhatsApp text only"
needs_gs = pytest.mark.skipif(not (shutil.which("gs") or shutil.which("/opt/homebrew/bin/gs")), reason="needs ghostscript")


@pytest.fixture(autouse=True)
def dial_code():
    c.use_dial_codes([CODE])
    yield
    c.use_dial_codes([])


def _pdf(text: str, uri: str = "", compress_annot: bool = False, hex_uri: bool = False) -> bytes:
    """A one-page PDF with real text, and a link annotation when given a target."""
    stream = f"BT /F1 12 Tf 40 700 Td ({text}) Tj ET".encode()
    target = f"<{uri.encode().hex()}>" if hex_uri else f"({uri})"
    annot = f"<< /Type /Annot /Subtype /Link /Rect [0 0 9 9] /A << /S /URI /URI {target} >> >>".encode() if uri else b""
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>" + (b" /Annots [6 0 R]" if uri else b"") + b" >>",
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream), b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    if uri:
        objs.append(annot)
    out, at = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        at.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, o)
    if compress_annot:
        z = zlib.compress(annot)
        out += b"9 0 obj\n<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream\nendobj\n" % (len(z), z)
    start = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % a for a in at)
    return out + b"trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, start)


def _check(path: str, blob: bytes, public=(), words=()) -> c.Report:
    rep = c.Report()
    c.check_file(path, blob, rep, list(public), list(words), [])
    return rep


@pytest.mark.parametrize("line", [FAKE, f"+{CODE}9800000000", f"00{CODE} 9800000000", f"{CODE}9800000000", f"+{CODE} ({D}) 000-0000"])
def test_the_dial_code_fails_in_any_written_form(line):
    assert [k for _, k in c.number_hits(f"call {line} now", "a.md", [])[0]] == ["a number on the dial code"]


@pytest.mark.parametrize("line", [f"https://wa.me/1{A}5550000", f"tel:+1{A}5550000", f"sms:{A}5550000", f"https://api.whatsapp.com/send?phone=1{A}5550000"])
def test_a_phone_link_target_fails(line):
    assert c.number_hits(line, "a.md", [])[0] == [(1, "a phone link target")]


@pytest.mark.parametrize("line", [f"({A}) 555-0000", f"{A}-555-0000", f"{A}.555.0000", f"+1 {A} 555 0000", f"+44 20 {B} 0000"])
def test_a_phone_number_fails(line):
    assert c.number_hits(f"call {line}", "a.md", [])[0] == [(1, "a phone number")]


@pytest.mark.parametrize("line", ["(212) 555-0147", "https://wa.me/12125550100", "tel:+1-212-555-0199", "+44 20 7946 0958", "tel:+442079460000"])
def test_the_reserved_fictional_range_passes_and_is_counted(line):
    assert c.number_hits(line, "a.md", []) == ([], 1)


@pytest.mark.parametrize("line", ["version 1.2.3", "2026-11-23 10:20:30", "id 00000000-0000-4000-8000-000000000000", "price 1,234,567", "sold 1002003000 units",
                                  "offset +0000", "https://wa.me/${number}", "tel:${phone}", "https://wa.me/1718555${String(100 + i)}", "ratio 3.14159265"])
def test_what_is_no_phone_number_passes(line):
    assert c.number_hits(line, "a.md", [])[0] == []


def test_a_public_number_passes_only_in_its_own_file():
    public = [(c.number_key(c.digits(FAKE)), ["docs/brochure.pdf"])]
    assert c.number_hits(FAKE, "docs/brochure.pdf", public)[0] == []
    assert c.number_hits(FAKE, "README.md", public)[0] != []


@needs_gs
def test_a_second_number_in_the_allowed_file_still_fails():
    public = [(c.number_key(c.digits(FAKE)), ["docs/b.pdf"])]
    assert _check("docs/b.pdf", _pdf(f"{NOTE} {FAKE}"), public=public).hits == []
    assert len(_check("docs/b.pdf", _pdf(f"{FAKE} and +{CODE} 981-1111111"), public=public).hits) == 1


def test_the_public_list_starts_empty_and_a_bad_line_stops(tmp_path):
    assert c.load_public(tmp_path / "none.txt") == []
    bad = tmp_path / "p.txt"
    bad.write_text("# note\nnot a line\n")
    with pytest.raises(SystemExit):
        c.load_public(bad)
    bad.write_text("12125550000 | a.md | a number in the clear is refused\n")
    with pytest.raises(SystemExit):
        c.load_public(bad)
    good = tmp_path / "ok.txt"
    good.write_text(f"{c.number_key('12125550000')} | a.md, b.md | named by the owner\n")
    assert c.load_public(good) == [(c.number_key("12125550000"), ["a.md", "b.md"])]


@needs_gs
def test_a_pdf_number_is_found_in_its_printed_text():
    rep = _check("docs/b.pdf", _pdf(f"{NOTE} {FAKE}"))
    assert [k for _, k in rep.hits] == ["a number on the dial code"] and "printed text" in rep.hits[0][0]


@needs_gs
@pytest.mark.parametrize("hex_uri", [False, True])
def test_a_pdf_link_target_is_read(hex_uri):
    rep = _check("docs/b.pdf", _pdf(NOTE, LINK, hex_uri=hex_uri))
    assert [k for _, k in rep.hits] == ["a number on the dial code"] and "(link 1)" in rep.hits[0][0]


@needs_gs
def test_a_link_inside_a_compressed_stream_is_read():
    assert len(c.pdf_links(_pdf(NOTE, LINK, compress_annot=True))) == 2


@needs_gs
def test_a_clean_pdf_passes():
    assert _check("docs/b.pdf", _pdf(NOTE, "https://example.com/")).hits == []


@needs_gs
def test_a_private_word_in_a_pdf_fails():
    assert _check("docs/b.pdf", _pdf("Written by Zebrafox"), words=c.load_words.__defaults__ and [__import__("re").compile("Zebrafox")]).hits == [("docs/b.pdf", "1 word(s) on the private list")]


@pytest.mark.parametrize("blob", [b"%PDF-1.4\nnot really a pdf", b"%PDF-1.4\n/Encrypt 1 0 R\n"])
def test_a_pdf_it_cannot_read_is_a_failure(blob):
    rep = _check("docs/b.pdf", blob)
    assert len(rep.hits) == 1 and rep.hits[0][1].startswith("could not be read")


def test_no_ghostscript_is_a_failure(monkeypatch):
    monkeypatch.setattr(c.shutil, "which", lambda *_a, **_k: None)
    monkeypatch.setattr(c.os.path, "exists", lambda *_a: False)
    assert _check("docs/b.pdf", _pdf(NOTE)).hits[0][1] == "could not be read (ghostscript is not installed)"


def test_an_unknown_binary_is_a_failure():
    rep = _check("docs/a.docx", b"PK\x03\x04\0\0binary")
    assert rep.hits == [("docs/a.docx", "could not be read (a binary type this check does not know)")]


def test_dial_codes_come_from_the_private_file_and_no_line_is_a_number(tmp_path):
    f = tmp_path / "public-numbers.txt"
    f.write_text(f"# note\ndial | {CODE} | a code the maintainers must not show\n{c.number_key('12125550000')} | a.md | named\n")
    assert c.load_dial_codes(f) == [CODE] and c.load_public(f) == [(c.number_key("12125550000"), ["a.md"])]
    c.use_dial_codes([])
    assert c.number_hits(f"{CODE}9800000000", "a.md", [])[0] == []


def test_pictures_are_listed_and_no_value_is_printed(capsys, tmp_path, monkeypatch):
    (tmp_path / "public-numbers.txt").write_text(f"dial | {CODE} | test\n")
    monkeypatch.setenv("RAMEN_PRIVATE_WORDS", str(tmp_path / "private-words.txt"))
    (tmp_path / "a.png").write_bytes(b"\x89PNG\0")
    (tmp_path / "b.md").write_text(f"call {FAKE}\n")
    assert c.main(["--dir", str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "b.md:1: a number on the dial code" in out and "'picture': 1" in out and "980" not in out


def test_a_folder_that_is_not_there_is_no_pass(tmp_path):
    with pytest.raises(SystemExit):
        c.main(["--dir", str(tmp_path / "none")])

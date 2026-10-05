"""A lead's email is checked for deliverability before the row is written (owner, 2026-10-02)."""
import httpx

from explorer.email_verify import EmailVerifier, describe


def _client(payload, status=200, calls=None):
    def handler(request):
        if calls is not None:
            calls.append(str(request.url))
        return httpx.Response(status, json=payload, headers={"x-qev-remaining-credits": "98"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_verdicts_are_cached_and_described(tmp_path):
    key = tmp_path / "k.key"; key.write_text("secret\n")
    calls = []
    v = EmailVerifier(key, tmp_path / "cache.json", client=_client({"result": "valid", "reason": "accepted_email", "accept_all": "true", "role": "true", "disposable": "false", "success": "true"}, calls=calls))
    a = v.check("Info@Joes.Example")
    assert a["result"] == "valid" and a["accept_all"] is True and a["credits"] == "98"
    assert "deliverable (catch-all domain" in describe(a)
    b = v.check("info@joes.example")
    assert b.get("cached") and len(calls) == 1  # one credit per address
    assert "apikey=secret" in calls[0]


def test_service_trouble_never_blocks(tmp_path):
    key = tmp_path / "k.key"; key.write_text("secret")
    out = EmailVerifier(key, tmp_path / "c.json", client=_client({"message": "Low credit"}, status=402)).check("a@b.example")
    assert out["result"] == "unverified" and "402" in out["reason"] and not (tmp_path / "c.json").exists()
    assert EmailVerifier(tmp_path / "missing.key", tmp_path / "c.json").check("a@b.example")["result"] == "unverified"
    assert describe({"result": "invalid", "reason": "rejected_email", "at": "2026-10-02T10:00:00"}).startswith("NOT deliverable (rejected_email)")


def test_the_basic_fallback_answers_when_the_main_service_is_out_of_credits(tmp_path):
    key = tmp_path / "k.key"; key.write_text("main"); fb = tmp_path / "f.key"; fb.write_text("basic")

    def handler(request):
        if "quickemailverification" in str(request.url):
            return httpx.Response(402, json={"message": "Low credit"})
        dead = b"nomx.example" in request.content
        return httpx.Response(200, json={"email": "x", "mx_valid": not dead, "is_disposable": False, "is_role_account": True, "is_reachable": "unverified"})

    v = EmailVerifier(key, tmp_path / "c.json", client=httpx.Client(transport=httpx.MockTransport(handler)), fallback_key_file=fb)
    ok = v.check("info@joes.example")
    assert ok["result"] == "unknown" and ok["by"] == "basic" and "mailbox not confirmed" in describe(ok)
    assert v.check("info@nomx.example")["result"] == "invalid"  # no mail server at all is a solid no

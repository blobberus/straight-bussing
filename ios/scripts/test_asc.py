#!/usr/bin/env python3
"""Hermetic tests for ios/scripts/asc.py (no network, no Apple account): key normalization, the ES256 token
(signed with a throwaway P-256 key and verified with openssl), the preflight decisions on fake API answers, and
the export-log hints.
  python3 ios/scripts/test_asc.py      -> prints 'ok N/N tests', exits 1 on failure (needs the openssl command)"""
import base64, json, subprocess, sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asc  # noqa: E402

TESTS = []
TMP = Path(tempfile.mkdtemp(prefix="asc-test-"))


def test(fn):
    TESTS.append(fn)
    return fn


def raises_stop(fn, contains):
    try:
        fn()
    except asc.Stop as s:
        assert contains.lower() in str(s).lower(), f"Stop message {str(s)!r} lacks {contains!r}"
        return
    raise AssertionError("expected Stop containing " + repr(contains))


def p256_key():
    """A throwaway PKCS#8 P-256 key, the same format as an App Store Connect AuthKey_XXXXXXXXXX.p8."""
    path = TMP / "AuthKey_TEST000000.p8"
    if not path.exists():
        subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(path)],
                       check=True, capture_output=True)
    return path.read_text(encoding="ascii")


@test
def key_accepts_base64_pem_and_escaped_newlines():
    pem = p256_key()
    want = asc.normalize_key(pem)
    assert want.startswith("-----BEGIN PRIVATE KEY-----\n") and want.endswith("-----END PRIVATE KEY-----\n")
    assert asc.normalize_key(base64.b64encode(pem.encode()).decode()) == want, "base64 of the file (documented)"
    wrapped = base64.encodebytes(pem.encode()).decode()          # base64 with line breaks (base64 without -w0)
    assert asc.normalize_key(wrapped) == want, "wrapped base64"
    assert asc.normalize_key(pem.replace("\n", "\\n")) == want, "PEM with literal \\n"
    assert asc.normalize_key(pem.replace("\n", "\r\n") + "\n\n") == want, "CRLF and trailing blank lines"


@test
def key_rejects_garbage_with_a_readable_message():
    raises_stop(lambda: asc.normalize_key(""), "empty")
    raises_stop(lambda: asc.normalize_key("not a key!"), "neither base64")
    raises_stop(lambda: asc.normalize_key(base64.b64encode(b"hello").decode()), "does not contain a private key")


@test
def write_key_checks_with_openssl():
    out = TMP / "k" / "AuthKey.p8"
    asc.write_key(asc.normalize_key(p256_key()), out)
    assert out.is_file()
    bad = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"
    raises_stop(lambda: asc.write_key(bad, TMP / "bad.p8"), "not a valid private key")
    assert not (TMP / "bad.p8").exists(), "an unreadable key is not left behind"


@test
def der_to_raw_pads_and_strips():
    # r with a leading 0x00 (high bit set), s short (needs left padding)
    r = b"\x00" + b"\x80" + b"\x11" * 31
    s = b"\x01\x02"
    der = b"\x30" + bytes([2 + len(r) + 2 + len(s)]) + b"\x02" + bytes([len(r)]) + r + b"\x02" + bytes([len(s)]) + s
    raw = asc.der_to_raw(der)
    assert len(raw) == 64 and raw[:32] == r[1:] and raw[32:] == b"\x00" * 30 + s


def raw_to_der(raw):
    def integer(b):
        b = b.lstrip(b"\x00") or b"\x00"
        if b[0] & 0x80:
            b = b"\x00" + b
        return b"\x02" + bytes([len(b)]) + b
    body = integer(raw[:32]) + integer(raw[32:])
    return b"\x30" + bytes([len(body)]) + body


@test
def token_is_a_valid_es256_jwt_for_app_store_connect():
    key = TMP / "k" / "AuthKey.p8"
    asc.write_key(asc.normalize_key(p256_key()), key)
    tok = asc.make_token("ABC123DEFG", "11111111-2222-3333-4444-555555555555", key, now=1_800_000_000)
    h, p, sig = tok.split(".")
    pad = lambda x: x + "=" * (-len(x) % 4)
    header = json.loads(base64.urlsafe_b64decode(pad(h)))
    payload = json.loads(base64.urlsafe_b64decode(pad(p)))
    assert header == {"alg": "ES256", "kid": "ABC123DEFG", "typ": "JWT"}, header
    assert payload == {"iss": "11111111-2222-3333-4444-555555555555", "iat": 1_800_000_000, "exp": 1_800_000_900,
                       "aud": "appstoreconnect-v1"}, payload
    assert payload["exp"] - payload["iat"] <= 1200, "Apple allows at most 20 minutes"
    raw = base64.urlsafe_b64decode(pad(sig))
    assert len(raw) == 64, "JWS ES256 signature is r || s, 64 bytes"
    pub = TMP / "pub.pem"
    subprocess.run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(pub)], check=True, capture_output=True)
    (TMP / "sig.der").write_bytes(raw_to_der(raw))
    (TMP / "msg").write_bytes(f"{h}.{p}".encode())
    v = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(pub), "-signature", str(TMP / "sig.der"), str(TMP / "msg")],
                       capture_output=True, text=True)
    assert v.returncode == 0 and "Verified OK" in v.stdout, v.stdout + v.stderr


class FakeASC:
    """Answers like App Store Connect: apps list, bundle id list, bundle id registration."""

    def __init__(self, apps=(), bundles=(), apps_status=200, bundles_status=200, post_status=201, post_detail=""):
        self.apps, self.bundles = list(apps), list(bundles)
        self.apps_status, self.bundles_status, self.post_status, self.post_detail = apps_status, bundles_status, post_status, post_detail
        self.calls = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and path.startswith("/v1/apps?"):
            assert "filter%5BbundleId%5D=" in path, path
            return self.apps_status, {"data": [{"attributes": {"bundleId": b, "name": "Straight Bussing"}} for b in self.apps]}
        if method == "GET" and path.startswith("/v1/bundleIds?"):
            # Apple's identifier filter also matches longer ids (the widget id contains the app id)
            ident = path.split("filter%5Bidentifier%5D=")[1].split("&")[0]
            hits = [b for b in self.bundles if ident in b]
            return self.bundles_status, {"data": [{"attributes": {"identifier": b}} for b in hits]}
        if method == "POST" and path == "/v1/bundleIds":
            if self.post_status == 201:
                self.bundles.append(body["data"]["attributes"]["identifier"])
                return 201, {"data": {"attributes": body["data"]["attributes"]}}
            return self.post_status, {"errors": [{"title": "An attribute value is not acceptable.", "detail": self.post_detail}]}
        raise AssertionError("unexpected call " + method + " " + path)


APP, WIDGET = "io.github.blobberus.straightbussing", "io.github.blobberus.straightbussing.widgets"


@test
def preflight_all_set_registers_nothing():
    fake = FakeASC(apps=[APP], bundles=[APP, WIDGET])
    notes = asc.preflight(fake, APP, WIDGET)
    assert not [c for c in fake.calls if c[0] == "POST"], "nothing to register"
    assert ("notice", "App record found", f"Straight Bussing ({APP})") in notes, notes


@test
def preflight_registers_missing_ids_then_asks_for_the_app_record():
    fake = FakeASC(apps=[], bundles=[APP + ".old"])      # a longer id must not count as ours
    raises_stop(lambda: asc.preflight(fake, APP, WIDGET), "New App")
    posts = [c[2]["data"]["attributes"] for c in fake.calls if c[0] == "POST"]
    assert posts == [{"identifier": APP, "name": "Straight Bussing", "platform": "IOS"},
                     {"identifier": WIDGET, "name": "Straight Bussing Widgets", "platform": "IOS"}], posts
    assert all(n.isalnum() or n == " " for p in posts for n in p["name"]), "App ID names allow no special characters"


@test
def preflight_widget_only_missing():
    fake = FakeASC(apps=[APP], bundles=[APP])
    asc.preflight(fake, APP, WIDGET)
    assert [c[2]["data"]["attributes"]["identifier"] for c in fake.calls if c[0] == "POST"] == [WIDGET]


@test
def preflight_bad_key_and_wrong_role_stop_early():
    raises_stop(lambda: asc.preflight(FakeASC(apps_status=401), APP, WIDGET), "401")
    raises_stop(lambda: asc.preflight(FakeASC(apps=[APP], bundles_status=403), APP, WIDGET), "Admin")
    raises_stop(lambda: asc.preflight(FakeASC(apps_status=403), APP, WIDGET), "agreement")


@test
def preflight_taken_id_stops_other_errors_only_warn():
    raises_stop(lambda: asc.preflight(FakeASC(apps=[APP], post_status=409,
                                              post_detail="An App ID with Identifier 'x' is not available."), APP, WIDGET),
                "not available")
    notes = asc.preflight(FakeASC(apps=[APP], post_status=500, post_detail="oops"), APP, WIDGET)
    assert sum(1 for k, t, _ in notes if k == "warning" and t == "Bundle id not registered") == 2, notes
    notes = asc.preflight(FakeASC(apps_status=500, bundles=[APP, WIDGET]), APP, WIDGET)
    assert any(t == "App record not checked" for _, t, _ in notes), "an unreadable app list warns, never stops"


@test
def explain_maps_known_apple_errors():
    log = ("error: exportArchive: Cloud signing permission error\nError Domain=IDEDistributionSigningAssetStepErrorDomain "
           "Code=0 \"Cloud signing permission error\"")
    hints = asc.explain(log)
    assert len(hints) == 1 and "Admin" in hints[0], hints
    assert any("New App" in h for h in asc.explain("Error: No suitable application records were found. Verify your bundle identifier"))
    assert any("build number" in h for h in asc.explain("ERROR ITMS-90189: Redundant Binary Upload."))
    assert any("agreement" in h.lower() for h in asc.explain("You must accept the latest Program License Agreement (PLA Update)"))
    assert asc.explain("** EXPORT SUCCEEDED **") == []


@test
def cli_key_reads_the_secret_and_reports_problems():
    import io, contextlib, os
    out = TMP / "cli" / "AuthKey.p8"
    env = dict(os.environ)
    try:
        os.environ["ASC_KEY_P8"] = base64.b64encode(p256_key().encode()).decode()
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        assert asc.main(["key", "--out", str(out)]) == 0 and out.is_file()
        os.environ["ASC_KEY_P8"] = ""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            assert asc.main(["key", "--out", str(TMP / "cli" / "none.p8")]) == 1
        assert "::error title=Release stopped::" in buf.getvalue(), buf.getvalue()
    finally:
        os.environ.clear()
        os.environ.update(env)


def main():
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            failed += 1
            print("FAIL", fn.__name__)
            traceback.print_exc(limit=2)
    print(("ok %d/%d tests" % (len(TESTS), len(TESTS))) if not failed else ("FAILED %d of %d tests" % (failed, len(TESTS))))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

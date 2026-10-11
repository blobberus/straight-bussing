#!/usr/bin/env python3
"""App Store Connect helper for .github/workflows/ios-release.yml (stdlib + the openssl command, no pip installs).

  python3 ios/scripts/asc.py key --out <AuthKey.p8>
      Writes the API key from $ASC_KEY_P8 (base64 of the .p8 file, or the PEM text itself) and checks it.
  python3 ios/scripts/asc.py preflight --app <bundle id> --widget <bundle id> --key <AuthKey.p8>
      Before the 15-minute archive: checks that App Store Connect accepts the key ($ASC_KEY_ID, $ASC_ISSUER_ID),
      registers the two bundle ids if they are missing, and stops with a readable message if the app record
      does not exist yet (Nathan's checklist in docs/APPSTORE-SUBMIT.md).
  python3 ios/scripts/asc.py explain <xcodebuild log>
      After a failed export/upload: turns the known Apple errors into what to do.

Every failure prints a GitHub ::error:: annotation and a line in the run summary. Tests: ios/scripts/test_asc.py.
Never prints the key or the token.
"""
import argparse, base64, binascii, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com"
GUIDE = "docs/APPSTORE-SUBMIT.md, Nathan's checklist"


class Stop(Exception):
    """A failure with a message meant for Nathan."""


def say(kind, title, text):
    """kind: error | warning | notice. GitHub annotation + run summary line."""
    print(f"::{kind} title={title}::{text}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"- **{title}**: {text}\n")


# ---------- the key ----------

def normalize_key(raw):
    """PEM text of the .p8 key from what was pasted into the secret: base64 of the file (the documented way), the
    PEM itself, or PEM with literal \\n. Raises Stop with a readable message."""
    raw = (raw or "").replace("\\n", "\n").replace("\r", "").strip()
    if not raw:
        raise Stop("ASC_KEY_P8 is empty.")
    if "BEGIN" not in raw:
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", raw), validate=True).decode("utf-8").replace("\r", "").strip()
        except (binascii.Error, UnicodeDecodeError, ValueError):
            raise Stop("ASC_KEY_P8 is neither base64 of the .p8 file nor the key text. Set it again with the "
                       "command in " + GUIDE + ".")
    m = re.search(r"-----BEGIN ([A-Z ]*PRIVATE KEY)-----(.*?)-----END \1-----", raw, re.S)
    if not m:
        raise Stop("ASC_KEY_P8 does not contain a private key (expected the AuthKey_XXXXXXXXXX.p8 file from App Store "
                   "Connect > Users and Access > Integrations).")
    body = re.sub(r"\s+", "", m.group(2))
    lines = [body[i:i + 64] for i in range(0, len(body), 64)]
    return f"-----BEGIN {m.group(1)}-----\n" + "\n".join(lines) + f"\n-----END {m.group(1)}-----\n"


def write_key(pem, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(pem, encoding="ascii")
    os.chmod(out, 0o600)
    r = subprocess.run(["openssl", "pkey", "-in", str(out), "-noout"], capture_output=True, text=True)
    if r.returncode:
        out.unlink()
        raise Stop("ASC_KEY_P8 is not a valid private key (openssl could not read it). Download a new key if the .p8 "
                   "file was lost; it can only be downloaded once.")


# ---------- the token (ES256 JWT, https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests) ----------

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def der_to_raw(der, size=32):
    """ECDSA signature: DER SEQUENCE { INTEGER r, INTEGER s } (what openssl prints) -> r || s (what JWS wants)."""
    def length(i):
        n = der[i]
        if n < 0x80:
            return n, i + 1
        k = n & 0x7F
        return int.from_bytes(der[i + 1:i + 1 + k], "big"), i + 1 + k

    if der[0] != 0x30:
        raise ValueError("not a DER sequence")
    _, i = length(1)
    out = b""
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("not a DER integer")
        n, i = length(i + 1)
        v = der[i:i + n].lstrip(b"\x00")
        if len(v) > size:
            raise ValueError("integer too long")
        out += v.rjust(size, b"\x00")
        i += n
    return out


def make_token(key_id, issuer_id, key_path, now=None, ttl=900):
    now = int(now if now is not None else time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {"iss": issuer_id, "iat": now, "exp": now + ttl, "aud": "appstoreconnect-v1"}
    signing_input = (b64url(json.dumps(header, separators=(",", ":")).encode()) + "." +
                     b64url(json.dumps(payload, separators=(",", ":")).encode())).encode("ascii")
    r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(key_path)], input=signing_input, capture_output=True)
    if r.returncode:
        raise Stop("Could not sign the App Store Connect token with ASC_KEY_P8 (openssl failed).")
    return signing_input.decode("ascii") + "." + b64url(der_to_raw(r.stdout))


def http(method, path, token, body=None, timeout=60):
    """(status, parsed JSON or {}) for one API request; network errors -> (0, {"error": text})."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, {"error": str(e)}


def detail(d):
    errs = (d or {}).get("errors") or []
    if errs:
        return "; ".join(filter(None, (" ".join(filter(None, [e.get("title"), e.get("detail")])) for e in errs)))[:400]
    return str((d or {}).get("error", ""))[:400]


# ---------- preflight ----------

def preflight(call, app_id, widget_id):
    """call(method, path, body=None) -> (status, json). Returns the list of notes; raises Stop on a real problem."""
    notes = []
    q = urllib.parse.urlencode({"filter[bundleId]": app_id, "fields[apps]": "name,bundleId", "limit": 200})
    st, d = call("GET", "/v1/apps?" + q)
    if st == 401:
        raise Stop("App Store Connect rejected the API key (401 Unauthorized). Check that ASC_KEY_ID is the Key ID, "
                   "ASC_ISSUER_ID is the Issuer ID (Users and Access > Integrations > App Store Connect API) and "
                   "ASC_KEY_P8 is the .p8 file of that same key, then run again.")
    if st == 403:
        raise Stop("App Store Connect refused the request (403): " + (detail(d) or "no detail") + ". Usually an "
                   "agreement is waiting: sign it in App Store Connect > Business (and developer.apple.com/account).")
    app_record, apps_read = None, st == 200
    if apps_read:
        app_record = next((a for a in d.get("data") or [] if (a.get("attributes") or {}).get("bundleId") == app_id), None)
    else:
        notes.append(("warning", "App record not checked", f"App Store Connect answered {st}: {detail(d)}. Continuing."))

    for ident, name in ((app_id, "Straight Bussing"), (widget_id, "Straight Bussing Widgets")):
        q = urllib.parse.urlencode({"filter[identifier]": ident, "fields[bundleIds]": "identifier,name,platform", "limit": 200})
        st, d = call("GET", "/v1/bundleIds?" + q)
        if st == 403:
            raise Stop("This API key cannot read Identifiers (403). Signing in the cloud needs a Team key with Admin "
                       "access: App Store Connect > Users and Access > Integrations > Team Keys > (+), Access: Admin. "
                       "Then set ASC_KEY_ID and ASC_KEY_P8 again (" + GUIDE + ").")
        if st != 200:
            notes.append(("warning", "Bundle id not checked", f"{ident}: App Store Connect answered {st}: {detail(d)}. "
                          "Xcode registers it during the export if needed."))
            continue
        if any((b.get("attributes") or {}).get("identifier") == ident for b in d.get("data") or []):
            notes.append(("notice", "Bundle id registered", ident))
            continue
        st, d = call("POST", "/v1/bundleIds", {"data": {"type": "bundleIds", "attributes": {
            "identifier": ident, "name": name, "platform": "IOS"}}})
        if st == 201:
            notes.append(("notice", "Bundle id registered now", f"{ident} ({name})"))
        elif st == 409 and re.search(r"not available|already|taken|exists", detail(d), re.I):
            raise Stop(f"The bundle id {ident} is not available to your team: {detail(d)}. If someone else owns it, "
                       "pick another id (SB_BUNDLE_ID in ios/project.yml) and tell Claude.")
        else:
            notes.append(("warning", "Bundle id not registered", f"{ident}: App Store Connect answered {st}: "
                          f"{detail(d)}. Xcode tries again during the export."))

    if apps_read and app_record is None:
        raise Stop(f"There is no app in App Store Connect for {app_id} yet. The bundle ids are registered now, so: "
                   "App Store Connect > Apps > (+) > New App > iOS, name Straight Bussing, Bundle ID " + app_id +
                   ", SKU straightbussing-ios. Then run this workflow again (" + GUIDE + ").")
    if app_record:
        notes.append(("notice", "App record found", f"{(app_record.get('attributes') or {}).get('name', '')} ({app_id})"))
    return notes


# ---------- explain a failed export / upload ----------

HINTS = [
    (r"Cloud signing permission error|not been given access to cloud-managed distribution certificates",
     "The API key needs the Admin role to sign in the cloud. App Store Connect > Users and Access > Integrations > "
     "Team Keys > (+), Access: Admin; then set ASC_KEY_ID and ASC_KEY_P8 again. A key's role can't be changed."),
    (r"No suitable application records were found|Cannot determine the Apple ID from Bundle ID|No App Store Connect record",
     "App Store Connect has no app with this bundle id. Create it: Apps > (+) > New App (" + GUIDE + ")."),
    (r"agreement|PLA Update|Program License Agreement",
     "An Apple agreement is waiting. Sign it at developer.apple.com/account and in App Store Connect > Business."),
    (r"bundle version must be higher|Redundant Binary Upload|ITMS-90189|has already been used|CFBundleVersion.*(?:higher|previous)",
     "This build number was already uploaded. Start a new run (Actions > iOS release > Run workflow) instead of "
     "re-running this one: the build number is the run number."),
    (r"NOT_AUTHORIZED|Authentication credentials are missing or invalid|status code 401|Unable to authenticate",
     "The API key was rejected. Check ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 (the .p8 of the same key)."),
    (r"ITMS-90725|SDK version issue|built with .* SDK",
     "Apple wants a newer SDK: the runner's Xcode is too old. Tell Claude (ios-release.yml selects Xcode)."),
    (r"No profiles for|Provisioning profile .* doesn't|requires a provisioning profile|No Accounts",
     "Xcode could not make a provisioning profile. Usually the key is not Admin or the bundle ids are not "
     "registered: run again (the preflight step registers them) or tell Claude with this log."),
    (r"ITMS-9\d{4}",
     "App Store Connect rejected the build (an ITMS error above). Send the run link to Claude."),
]


def explain(log_text):
    """Readable hints for the known failures in an xcodebuild export log (first match per hint)."""
    found = []
    for pattern, hint in HINTS:
        if re.search(pattern, log_text, re.I) and hint not in found:
            found.append(hint)
    return found


# ---------- CLI ----------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("key")
    k.add_argument("--out", required=True)
    p = sub.add_parser("preflight")
    p.add_argument("--app", required=True)
    p.add_argument("--widget", required=True)
    p.add_argument("--key", required=True)
    e = sub.add_parser("explain")
    e.add_argument("log")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "key":
            write_key(normalize_key(os.environ.get("ASC_KEY_P8", "")), a.out)
            print("API key written and readable")
        elif a.cmd == "preflight":
            token = make_token(os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], a.key)
            for kind, title, text in preflight(lambda m, path, body=None: http(m, path, token, body), a.app, a.widget):
                say(kind, title, text)
        elif a.cmd == "explain":
            text = Path(a.log).read_text(encoding="utf-8", errors="replace") if Path(a.log).is_file() else ""
            hints = explain(text) or ["Unknown failure: the log above has the details. Send the run link to Claude."]
            for h in hints:
                say("error", "What to do", h)
    except Stop as s:
        say("error", "Release stopped", str(s))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

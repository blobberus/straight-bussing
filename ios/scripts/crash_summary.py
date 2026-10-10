#!/usr/bin/env python3
"""Print the gist of iOS Simulator crash reports (.ips): exception, termination reason, crashed thread's frames.

  python3 ios/scripts/crash_summary.py ~/Library/Logs/DiagnosticReports/StraightBussing-*.ips

Used by .github/workflows/ios.yml when the app dies during UI tests or the screenshot run (the Mac has no other way
to show us why). An .ips file is a JSON header line followed by a JSON body.
"""
import json
import sys


def summary(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    head, _, rest = text.partition("\n")
    try:
        body = json.loads(rest)
    except ValueError:
        return text[:4000]
    out = [f"== {path}", f"app: {json.loads(head).get('app_name', '?') if head.startswith('{') else '?'}"]
    exc = body.get("exception") or {}
    out.append(f"exception: {exc.get('type', '')} {exc.get('signal', '')} {exc.get('subtype', '')}".strip())
    term = body.get("termination") or {}
    if term:
        out.append(f"termination: {term.get('namespace', '')} {term.get('indicator', '')} {' '.join(term.get('reasons', []) or [])}")
    asi = body.get("asi")
    if asi:
        out.append(f"asi: {json.dumps(asi)[:1500]}")
    images = body.get("usedImages") or []
    threads = body.get("threads") or []
    ft = body.get("faultingThread")
    for i, t in enumerate(threads):
        if not (t.get("triggered") or i == ft):
            continue
        out.append(f"thread {i} {t.get('name', '') or t.get('queue', '')}:")
        for fr in (t.get("frames") or [])[:25]:
            img = images[fr["imageIndex"]].get("name", "?") if fr.get("imageIndex", -1) < len(images) else "?"
            sym = fr.get("symbol", "")
            loc = f" ({fr.get('sourceFile')}:{fr.get('sourceLine')})" if fr.get("sourceFile") else ""
            out.append(f"  {img}  {sym}{loc}")
        break
    return "\n".join(out)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    for p in sys.argv[1:]:
        print(summary(p))
    return 0


if __name__ == "__main__":
    sys.exit(main())

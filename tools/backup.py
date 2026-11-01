#!/usr/bin/env python3
"""Copy all collected data off GitHub, to a folder on this computer (incremental; safe to rerun any time).

  python tools/backup.py                    # into ~/StraightBussing-backup (outside the repo)
  python tools/backup.py --to D:/sb-backup  # anywhere else (an external drive, a synced folder)
  python tools/backup.py --check            # only verify what is already there

Why (risk review 2026-11-01, docs/DATA-COLLECTION-LOG.md DC-021): every copy of the data lives on one GitHub account:
the data branch, the 90-day run artifacts and the daily archive (release assets). The collector runs 24/7 on GitHub's
hosted runners, a use GitHub's terms only allow when it serves the software project (it does: the data builds the app's
learned times), so a suspension, an account problem or a deleted repository would lose everything at once.

What it copies:
  data-branch/   the data branch's files as of now (arrivals, predictions, alerts, bus changes, timetable versions and
                 zips, the daily summary, context): every row ever collected, since the CSVs only grow and rotate into
                 archive/ (no git history: that is on GitHub and in any clone)
  releases/<tag>/  every asset of every data-archive-YYYY-MM release (raw polls, prediction updates, forecast tables,
                 GTFS zips, alerts, bus changes), downloaded once, size-checked against GitHub
  MANIFEST.json  what is there, sizes, sha256, when
Needs git and the gh CLI (logged in, or GH_TOKEN). Stdlib only.
"""
import argparse, hashlib, io, json, subprocess, sys, tarfile, time
from pathlib import Path

REPO = "blobberus/straight-bussing"
ROOT = Path(__file__).resolve().parent.parent


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=900)
    if r.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {(r.stderr or r.stdout).strip()[:300]}")
    return r.stdout


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def data_branch(dest, repo_dir=ROOT, remote="origin"):
    """Extract the data branch's current files into dest/data-branch (replacing the previous copy). -> file count."""
    subprocess.run(["git", "fetch", "-q", "--no-tags", remote, "+refs/heads/data:refs/remotes/origin/data"],
                   cwd=repo_dir, check=True, timeout=900)
    tar = subprocess.run(["git", "archive", "--format=tar", "refs/remotes/origin/data"], cwd=repo_dir,
                         capture_output=True, check=True, timeout=900).stdout
    out, tmp = Path(dest) / "data-branch", Path(dest) / "data-branch.tmp"
    if tmp.exists():
        _rmtree(tmp)
    tmp.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(tar)) as t:
        members = [m for m in t.getmembers() if m.isfile() and not m.name.startswith(("/", "..")) and ".." not in m.name]
        t.extractall(tmp, members=members)
    if out.exists():
        _rmtree(out)
    tmp.rename(out)
    return len(members)


def _rmtree(p):
    import shutil, os, stat
    def onerror(func, path, _):
        os.chmod(path, stat.S_IWRITE)
        func(path)
    shutil.rmtree(p, onerror=onerror)


def releases(dest, repo=REPO, log=print):
    """Download every data-archive-* release asset not yet here (or with the wrong size). -> (downloaded, kept, bytes)."""
    tags = [t for t in gh("release", "list", "-R", repo, "--limit", "200", "--json", "tagName", "--jq",
                          ".[].tagName").split() if t.startswith("data-archive-")]
    got = kept = size = 0
    for tag in sorted(tags):
        assets = json.loads(gh("release", "view", tag, "-R", repo, "--json", "assets"))["assets"]
        d = Path(dest) / "releases" / tag
        d.mkdir(parents=True, exist_ok=True)
        for a in assets:
            p = d / a["name"]
            if p.exists() and p.stat().st_size == a["size"]:
                kept += 1
                continue
            gh("release", "download", tag, "-R", repo, "-p", a["name"], "-D", str(d), "--clobber")
            if p.stat().st_size != a["size"]:
                raise RuntimeError(f"{tag}/{a['name']}: {p.stat().st_size} bytes, GitHub says {a['size']}")
            got += 1
            size += a["size"]
            log(f"  {tag}/{a['name']} ({a['size'] / 1e6:.1f} MB)")
    return got, kept, size


def manifest(dest):
    files = sorted(p for p in Path(dest).rglob("*") if p.is_file() and p.name != "MANIFEST.json")
    m = {"made": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "repo": REPO, "files": {
        str(p.relative_to(dest)).replace("\\", "/"): {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in files}}
    (Path(dest) / "MANIFEST.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    return m


def check(dest):
    """-> list of problems against MANIFEST.json (a file changed or vanished since the last backup)."""
    mp = Path(dest) / "MANIFEST.json"
    if not mp.exists():
        return ["no MANIFEST.json: no backup here yet"]
    m = json.loads(mp.read_text(encoding="utf-8"))
    bad = []
    for rel, info in m["files"].items():
        p = Path(dest) / rel
        if not p.exists():
            bad.append(f"missing: {rel}")
        elif p.stat().st_size != info["bytes"] or sha256(p) != info["sha256"]:
            bad.append(f"changed: {rel}")
    return bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--to", default=str(Path.home() / "StraightBussing-backup"))
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--check", action="store_true", help="only verify the existing backup against its manifest")
    ap.add_argument("--no-releases", action="store_true")
    a = ap.parse_args(argv)
    dest = Path(a.to)
    if a.check:
        bad = check(dest)
        print("\n".join(bad) if bad else f"backup ok: {dest}")
        return 1 if bad else 0
    dest.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    n = data_branch(dest)
    print(f"data branch: {n} files -> {dest / 'data-branch'}")
    if not a.no_releases:
        got, kept, size = releases(dest, a.repo)
        print(f"releases: {got} new asset(s) ({size / 1e6:.1f} MB), {kept} already here")
    m = manifest(dest)
    total = sum(f["bytes"] for f in m["files"].values())
    print(f"backup done in {time.time() - t0:.0f} s: {len(m['files'])} files, {total / 1e6:.0f} MB in {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

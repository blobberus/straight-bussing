#!/usr/bin/env python3
"""Asserts that web/sw.js precaches the whole offline shell, so a new file can never be missed offline.
Walks what the app loads, starting at web/index.html:
  - <link href> / <script src> / <img src> in index.html, privacy.html and support.html (same-origin only);
  - every JS module reachable through static imports, `export ... from`, and dynamic import() (a template
    such as `./ui/views/${v}.js` counts every file it can match);
  - pages and data files the JS links or fetches ("privacy.html", "data/meta.json", ...), the manifest's
    icons, local url(...) in CSS;
plus every file under web/js, web/css, web/icons and web/data. Each must be in PRECACHE, and every PRECACHE
entry must exist. Query strings (?v=5) are ignored. Files that do not exist (data/learned.json, optional)
are skipped unless an import needs them (a broken import fails).
  python tools/test_precache.py      -> prints 'ok N tests', exits 1 on failure (hermetic, no browser)"""
import json, re, sys, traceback
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
PAGES = ["index.html", "privacy.html", "support.html"]
TREES = ["js", "css", "icons", "data"]

IMPORT_RE = re.compile(r"""(?:^|[;\s])(?:import|export)\s[^;'"`]*?\sfrom\s*(['"])([^'"]+)\1|(?:^|[;\s])import\s*(['"])([^'"]+)\3""", re.M)
DYN_RE = re.compile(r"""import\(\s*(['"`])([^'"`]+)\1\s*\)""")
HTML_REF_RE = re.compile(r"""<(?:link|script|img)\b[^>]*?\s(?:href|src)=["']([^"']+)["']""", re.I)
JS_REF_RE = re.compile(r"""["'`]((?:\.\./)*(?:[\w-]+/)*[\w-]+\.(?:html|json|webmanifest|png|svg))["'`?#]""")
CSS_URL_RE = re.compile(r"""url\(\s*["']?([^"')]+)["']?\s*\)""")

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def precache():
    src = (WEB / "sw.js").read_text(encoding="utf-8")
    m = re.search(r"const PRECACHE = \[([\s\S]*?)\];", src)
    assert m, "PRECACHE list not found in web/sw.js"
    return src, re.findall(r"'([^']+)'", m.group(1))


def local(ref, base):
    """Resolve a reference against the file that makes it; None for other origins, data: and fragments."""
    ref = ref.split("#")[0].split("?")[0]
    if not ref or re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I) or ref.startswith("//"):
        return None
    p = (WEB / ref.lstrip("/")) if ref.startswith("/") else (base.parent / ref)
    try:
        return p.resolve().relative_to(WEB.resolve()).as_posix()
    except ValueError:
        return None


def strip_comments(js):
    """Drop // and /* */ comments (keeps strings; good enough for import scanning)."""
    js = re.sub(r"/\*[\s\S]*?\*/", "", js)
    return re.sub(r"(^|[^:\\'\"`])//[^\n]*", r"\1", js)


def module_graph():
    """Every module reachable from the pages' module scripts: {path: [imports]}; missing imports collected."""
    seen, todo, missing = {}, [], []
    for page in PAGES:
        if (WEB / page).is_file():
            html = (WEB / page).read_text(encoding="utf-8")
            for ref in re.findall(r"""<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']""", html, re.I):
                r = local(ref, WEB / page)
                if r:
                    todo.append(r)
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        f = WEB / rel
        if not f.is_file():
            missing.append(rel)
            seen[rel] = []
            continue
        js = strip_comments(f.read_text(encoding="utf-8"))
        deps = [m.group(2) or m.group(4) for m in IMPORT_RE.finditer(js)]
        for m in DYN_RE.finditer(js):
            spec = m.group(2)
            if "${" in spec:   # template: every file it can name
                pat = re.sub(r"\$\{[^}]*\}", "*", spec)
                d = (f.parent / pat).parent
                deps += [(Path(spec).parent / p.name).as_posix() for p in sorted(d.glob(Path(pat).name))]
            else:
                deps.append(spec)
        out = []
        for d in deps:
            r = local(d, f)
            if r:
                out.append(r)
                todo.append(r)
        seen[rel] = out
    return seen, missing


def referenced():
    """Every same-origin file the shell names: page assets, module graph, JS-linked pages / data, manifest icons, CSS urls."""
    refs = {}
    def add(r, why):
        if r:
            refs.setdefault(r, why)
    for page in PAGES:
        f = WEB / page
        if not f.is_file():
            continue
        add(page, "shell page")
        for ref in HTML_REF_RE.findall(f.read_text(encoding="utf-8")):
            add(local(ref, f), page)
    graph, _ = module_graph()
    for mod in graph:
        add(mod, "module graph")
        for ref in JS_REF_RE.findall(strip_comments((WEB / mod).read_text(encoding="utf-8")) if (WEB / mod).is_file() else ""):
            # "../../data/x.json" in a module is fetched relative to the page (index.html) or the module; accept either
            r = local(ref, WEB / mod)
            r = r if r and (WEB / r).is_file() else local(ref, WEB / "index.html")
            add(r, mod)
    man = WEB / "manifest.webmanifest"
    if man.is_file():
        for icon in json.loads(man.read_text(encoding="utf-8")).get("icons", []):
            add(local(icon.get("src", ""), man), "manifest icon")
    for css in (WEB / "css").glob("*.css"):
        for ref in CSS_URL_RE.findall(css.read_text(encoding="utf-8")):
            add(local(ref, css), css.name)
    return refs


@test
def precache_entries_exist():
    _, entries = precache()
    assert "./" in entries and "index.html" in entries, "shell entries './' and 'index.html'"
    assert not any("tests/" in e for e in entries), "tests are never precached"
    bad = [e for e in entries if e != "./" and not (WEB / e).is_file()]
    assert not bad, "PRECACHE entries that do not exist: %s" % bad
    dup = sorted({e for e in entries if entries.count(e) > 1})
    assert not dup, "duplicate PRECACHE entries: %s" % dup


@test
def cache_name_is_versioned():
    src, _ = precache()
    assert re.search(r"const CACHE = 'sb-v2-\d+';", src), "cache name sb-v2-<n>"


@test
def module_graph_has_no_broken_import():
    graph, missing = module_graph()
    assert "js/main.js" in graph, "index.html loads js/main.js"
    assert len(graph) > 40, "walked the module graph (%d modules)" % len(graph)
    assert not missing, "imports of files that do not exist: %s" % missing


@test
def every_loaded_file_is_precached():
    _, entries = precache()
    have = set(entries)
    need = {r: why for r, why in referenced().items() if (WEB / r).is_file() and not r.startswith("tests/")}
    gone = sorted("%s (from %s)" % (r, why) for r, why in need.items() if r not in have)
    assert not gone, "loaded by the app but missing from web/sw.js PRECACHE (add them, bump CACHE): %s" % gone


@test
def every_shell_tree_file_is_precached():
    have = set(precache()[1])
    files = sorted(p.relative_to(WEB).as_posix() for t in TREES for p in (WEB / t).rglob("*") if p.is_file())
    gone = [f for f in files if f not in have]
    assert not gone, "files under web/%s missing from PRECACHE: %s" % ("|".join(TREES), gone)


@test
def walker_sees_dynamic_views_and_linked_pages():
    graph, _ = module_graph()
    refs = referenced()
    for mod in ["js/ui/views/nearby.js", "js/ui/views/about.js", "js/ui/demo.js", "js/ui/pill.js", "js/ui/update.js"]:
        assert mod in graph, "walker reaches " + mod
    for page in ["privacy.html", "support.html", "manifest.webmanifest", "icons/icon-180.png", "data/meta.json"]:
        assert page in refs, "walker sees " + page


def main():
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            failed += 1
            print("FAIL", fn.__name__)
            traceback.print_exc(limit=1)
    print(("ok %d/%d tests" % (len(TESTS), len(TESTS))) if not failed else ("FAILED %d of %d tests" % (failed, len(TESTS))))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

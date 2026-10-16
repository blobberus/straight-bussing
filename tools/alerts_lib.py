"""Passio serviceAlerts as alert versions (stdlib only): schema, feed parsing, CSV read / write.

One row = one version of one operator alert: a hash of what the rider is told (header, description, cause, effect,
active periods, informed entities). A changed text, window or route makes a new version; the same version seen again
only moves its last_seen. alert_id lists every Passio entity id the version was seen under (';'): Passio numbers its
alerts by their place in the feed, so an alert's id changes when one above it ends (DC-012, 2026-10-16: "UGo Bus Route
Assistance" was 2, then 1). The version is the key; its active periods are part of it, so a new posting of the same
text with new dates is a new row. Collected by tools/truth_logger.py (--alerts-out, about every
5 min), merged into data/ground_truth/alerts.csv on the data branch by tools/merge_alerts.py. Docs: docs/DATA.md
"alerts.csv". The text is the operator's, verbatim; this project adds nothing to it.
"""
import csv, hashlib, io, json, os
from pathlib import Path

from arrivals_lib import chicago

COLUMNS = ("alert_id,version,first_seen,last_seen,first_seen_local,last_seen_local,active_start,active_end,"
           "active_start_local,active_end_local,active_periods,cause,effect,agency_ids,route_ids,route_names,"
           "stop_ids,header,description").split(",")
HEADER = ",".join(COLUMNS) + "\n"


def local(epoch):
    """'YYYY-MM-DD HH:MM:SS' on a Chicago clock, '' for a blank."""
    return "" if epoch in (None, "") else chicago(int(epoch)).strftime("%Y-%m-%d %H:%M:%S")


def _int(x):
    """Feed number (GTFS-RT JSON may send uint64 as a string) -> int, else None."""
    if x is None or isinstance(x, bool) or x == "":
        return None
    try:
        return int(float(x))
    except (TypeError, ValueError, OverflowError):
        return None


def _str(x):
    return "" if x is None or isinstance(x, (dict, list)) else str(x)


def _translations(ts):
    """TranslatedString -> [[language, text], ...] (a bare string counts as one untagged translation)."""
    if isinstance(ts, str):
        return [["", ts]]
    tr = ts.get("translation") if isinstance(ts, dict) else None
    return [[_str(t.get("language")), t["text"]] for t in tr or () if isinstance(t, dict) and isinstance(t.get("text"), str)]


def text_of(ts):
    """The English (or untagged) translation, else the first one, verbatim; '' when there is none."""
    tr = _translations(ts)
    for lang, text in tr:
        if lang.lower() in ("", "en") or lang.lower().startswith("en-"):
            return text
    return tr[0][1] if tr else ""


def _periods(al):
    out = []
    for p in al.get("active_period") or ():
        if isinstance(p, dict):
            out.append((_int(p.get("start")), _int(p.get("end"))))
    return sorted(out, key=lambda p: (-1 if p[0] is None else p[0], -1 if p[1] is None else p[1]))


def _entities(al):
    return [e for e in al.get("informed_entity") or () if isinstance(e, dict)]


def version_of(al):
    """12-hex hash of what the alert says, independent of entity / translation order and of Passio's extra
    startDatetime / endDatetime strings (only the epochs count)."""
    norm = {"header": sorted(_translations(al.get("header_text"))),
            "description": sorted(_translations(al.get("description_text"))),
            "cause": _str(al.get("cause")), "effect": _str(al.get("effect")),
            "periods": [list(p) for p in _periods(al)],
            "entities": sorted(json.dumps(e, sort_keys=True, ensure_ascii=False) for e in _entities(al))}
    blob = json.dumps(norm, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:12]


def _ids(ents, key, trip_key=None):
    out = set()
    for e in ents:
        v = e.get(key)
        if v is None and trip_key and isinstance(e.get("trip"), dict):
            v = e["trip"].get(trip_key)
        if _str(v):
            out.add(_str(v))
    return sorted(out)


def _id_order(s):
    """Sort key of an id list: its first id, numbers in number order (ties in a sorted file read like the feed)."""
    i = str(s or "").split(";")[0]
    return (0, int(i), "") if i.isdigit() else (1, 0, i)


def join_ids(*parts):
    """';'-joined entity id lists -> one sorted list without repeats ('2', '1;2' -> '1;2'); numbers in number order."""
    ids = {i for p in parts for i in str(p or "").split(";") if i != ""}
    return ";".join(sorted(ids, key=_id_order))


def versions(feed, now, route_name=None):
    """serviceAlerts feed (dict) -> one row dict per alert version in it, first_seen = last_seen = now.
    Junk entities and deleted ones are skipped; a feed that is not a dict raises ValueError (the caller counts it)."""
    if not isinstance(feed, dict):
        raise ValueError(f"serviceAlerts is not a feed object ({type(feed).__name__})")
    rows, seen = [], {}
    for e in feed.get("entity") or ():
        if not isinstance(e, dict) or e.get("is_deleted") is True or not isinstance(e.get("alert"), dict):
            continue
        al = e["alert"]
        key = (_str(e.get("id")), version_of(al))
        if key[1] in seen:                       # the same alert under two ids in one feed: one row, both ids
            seen[key[1]]["alert_id"] = join_ids(seen[key[1]]["alert_id"], key[0])
            continue
        per, ents = _periods(al), _entities(al)
        starts, ends = [p[0] for p in per], [p[1] for p in per]
        start = min(starts) if per and None not in starts else None      # blank = open (no bound) or no period
        end = max(ends) if per and None not in ends else None
        routes = _ids(ents, "route_id", "route_id")
        names = []
        for r in routes:
            try:
                names.append(_str(route_name(r)) if route_name else "")
            except Exception:
                names.append("")
        seen[key[1]] = {"alert_id": key[0], "version": key[1], "first_seen": now, "last_seen": now,
                     "first_seen_local": local(now), "last_seen_local": local(now),
                     "active_start": "" if start is None else start, "active_end": "" if end is None else end,
                     "active_start_local": local(start), "active_end_local": local(end),
                     "active_periods": ";".join(f"{'' if s is None else s}/{'' if t is None else t}" for s, t in per),
                     "cause": _str(al.get("cause")), "effect": _str(al.get("effect")),
                     "agency_ids": ";".join(_ids(ents, "agency_id")), "route_ids": ";".join(routes),
                     "route_names": ";".join(names) if any(names) else "", "stop_ids": ";".join(_ids(ents, "stop_id")),
                     "header": text_of(al.get("header_text")), "description": text_of(al.get("description_text"))}
        rows.append(seen[key[1]])
    return rows


def key(r):
    """A row's identity: its version (DC-012: never Passio's entity id, which moves)."""
    return r.get("version", "")


def absorb(into, r):
    """Fold version row r into the dict {key: row}: new key -> added; known -> min first_seen, max last_seen, the
    entity ids joined and blanks filled. -> 'added' | 'extended' | 'same'."""
    k = key(r)
    old = into.get(k)
    if old is None:
        into[k] = dict(r, alert_id=join_ids(r.get("alert_id")))
        return "added"
    before = (old["first_seen"], old["last_seen"], old.get("alert_id"))
    f, l = min(int(old["first_seen"]), int(r["first_seen"])), max(int(old["last_seen"]), int(r["last_seen"]))
    old.update(first_seen=f, last_seen=l, first_seen_local=local(f), last_seen_local=local(l),
               alert_id=join_ids(old.get("alert_id"), r.get("alert_id")))
    for c in COLUMNS:
        if old.get(c) in (None, "") and r.get(c) not in (None, ""):
            old[c] = r[c]
    return "same" if (int(before[0]), int(before[1]), before[2]) == (f, l, old["alert_id"]) else "extended"


def valid(r):
    """A row merge can use: id / version present, first_seen <= last_seen as integers."""
    try:
        return bool(r.get("version")) and r.get("alert_id") is not None and int(r["first_seen"]) <= int(r["last_seen"])
    except (KeyError, TypeError, ValueError):
        return False


def read_csv(path):
    """-> (valid rows, unusable rows), each restricted to COLUMNS. Missing or empty file -> ([], [])."""
    p = Path(path)
    if not p.exists() or p.stat().st_size == 0:
        return [], []
    with open(p, encoding="utf-8", newline="") as f:
        rows = [{c: (r.get(c) or "") for c in COLUMNS} for r in csv.DictReader(f)]
    return [r for r in rows if valid(r)], [r for r in rows if not valid(r)]


def sort_rows(rows):
    def k(r):
        try:
            return int(r["first_seen"]), _id_order(r.get("alert_id")), str(r["version"])
        except (KeyError, TypeError, ValueError):
            return 0, _id_order(r.get("alert_id")), str(r.get("version"))
    return sorted(rows, key=k)


def to_text(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(sort_rows(rows))
    return buf.getvalue()


def write_csv(path, rows):
    """Atomic rewrite (temp file + os.replace); the temp file never stays behind."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(to_text(rows))
        os.replace(tmp, p)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def in_window(rows, t0, t1):
    """Versions that were in the feed at some poll in [t0, t1)."""
    out = []
    for r in rows:
        try:
            if int(r["first_seen"]) < t1 and int(r["last_seen"]) >= t0:
                out.append(r)
        except (KeyError, TypeError, ValueError):
            continue
    return out

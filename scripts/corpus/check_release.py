#!/usr/bin/env python3
"""Check the corpus release against its invariants. Exits 1 if any fails.

Reads data/corpus/release.jsonl (written by build_release.py) and checks:

  - ids are unique and every record has text, a genre and an http(s) source URL
  - no text contains a NUL character (Postgres text cannot hold one)
  - no core or voices title or text holds a control character other than tab,
    newline or carriage return: the site's search marks matches with U+0001
    and U+0002 and trusts that the text has neither
  - every record names its speaker (speakers.json has the slug)
  - every date is ISO with a precision of day, month or year, or is empty with
    precision "unknown"
  - every collection is core, executive, tweets or voices
  - every record has a settled rights basis (not empty, not "pending")
  - no two core records share a title and a date
  - no speaker is credited with words dated after their death
  - the core holds the 27 amendments, each as its own dated record
  - every series value names a series in series.json and sits on a core
    speech that answers to a member of its list, and no member answers to
    more than one record
  - every series record carries the series_member key of the member it
    answers to (build_release.member_key), no other record carries one, and
    no two records share one

Usage (from the repo root):
  python3 scripts/corpus/check_release.py [--release PATH]

Stdlib only.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_release import RELEASE_JSONL, SERIES, SPEAKER_LAST_DATE, member_key, series_matches  # noqa: E402

COLLECTIONS = {"core", "executive", "tweets", "voices"}
# What the site loads into Postgres: core and voices (scripts/corpus/cli.mjs),
# executive (scripts/executive/cli.mjs).
SITE_COLLECTIONS = {"core", "executive", "voices"}
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
PRECISIONS = {"day", "month", "year"}
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AMENDMENT = re.compile(r"\bAmendment ([IVXL]+)\b")
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII",
         "XXIII", "XXIV", "XXV", "XXVI", "XXVII"]


def check(records):
    """Map of failed invariant -> list of offending ids (or a note)."""
    fail = defaultdict(list)
    seen = set()
    core_title_date = defaultdict(list)
    amendments = defaultdict(list)

    for r in records:
        rid = r.get("id") or "(no id)"
        if rid in seen:
            fail["duplicate id"].append(rid)
        seen.add(rid)

        if not (r.get("text") or "").strip():
            fail["empty text"].append(rid)
        if "\x00" in (r.get("text") or ""):
            fail["NUL in text"].append(rid)
        if r.get("collection") in SITE_COLLECTIONS and (
                CONTROL.search(r.get("text") or "") or CONTROL.search(r.get("title") or "")):
            fail["control character in a site record"].append(rid)
        if not r.get("speaker_name"):
            fail["speaker has no name"].append(rid)
        if not r.get("genre"):
            fail["no genre"].append(rid)
        if not re.match(r"^https?://", r.get("source_url") or ""):
            fail["no source URL"].append(rid)

        d, p = r.get("date"), r.get("date_precision")
        if d is None:
            if p != "unknown":
                fail["empty date without precision 'unknown'"].append(rid)
        elif not ISO_DATE.match(d) or p not in PRECISIONS:
            fail["date not ISO with day/month/year precision"].append(rid)

        if r.get("collection") not in COLLECTIONS:
            fail["collection not core/executive/tweets/voices"].append(rid)

        rights = r.get("rights")
        if not rights or rights in ("pending", "exclude"):
            fail[f"rights not settled ({rights or 'empty'})"].append(rid)

        last = SPEAKER_LAST_DATE.get(r.get("speaker"))
        if last and d and d > last:
            fail["speaker credited after death"].append(rid)

        if r.get("collection") == "core":
            title = (r.get("title") or "").strip().lower()
            core_title_date[(title, d)].append(rid)
            m = AMENDMENT.search(r.get("title") or "")
            if m and r.get("genre") == "document" and d and p == "day":
                amendments[m.group(1)].append(rid)

    for (title, d), ids in sorted(core_title_date.items(), key=lambda kv: kv[0][0]):
        if len(ids) > 1:
            fail["core title and date shared"].extend(ids)

    member_ids = defaultdict(list)
    for r in records:
        key = r.get("series")
        if (key is None) != (r.get("series_member") is None):
            fail["series and series_member not set together"].append(r.get("id"))
        if r.get("series_member") is not None:
            member_ids[r["series_member"]].append(r.get("id"))
        if key is None:
            continue
        if key not in SERIES:
            fail["series not in series.json"].append(r.get("id"))
        elif r.get("collection") != "core" or r.get("genre") != "speech" or not r.get("date"):
            fail["series on a record that is not a dated core speech"].append(r.get("id"))
    for key, spec in SERIES.items():
        pattern = re.compile(spec["title_pattern"])
        marked = [r for r in records if r.get("series") == key and r.get("date")]
        answered, claimed = set(), set()
        for m in sorted(spec["members"], key=lambda m: m.get("date") is None):
            hits = series_matches(m, marked, pattern, claimed)
            if len(hits) > 1:
                fail[f"series {key}: a member matches more than one record"].extend(r["id"] for r in hits)
            for r in hits:
                answered.add(r["id"])
                claimed.add(r["id"])
                if r.get("series_member") != member_key(key, m):
                    fail[f"series {key}: series_member does not name its member"].append(r["id"])
        for r in marked:
            if r["id"] not in answered:
                fail[f"series {key}: record answers to no member"].append(r["id"])
    for ids in member_ids.values():
        if len(ids) > 1:
            fail["series_member shared"].extend(ids)

    missing = [n for n in ROMAN if n not in amendments]
    if missing:
        fail["amendments missing (as dated core documents)"].extend(missing)
    for n, ids in amendments.items():
        if n in ROMAN and len(ids) > 1:
            fail["amendment present more than once"].extend(ids)
    return fail


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--release", default=RELEASE_JSONL)
    args = ap.parse_args()

    with open(args.release, encoding="utf-8") as f:
        records = [json.loads(line) for line in f]
    fail = check(records)
    print(f"{len(records)} records in {os.path.relpath(args.release)}")
    if not fail:
        print("all invariants hold")
        return 0
    for name, ids in fail.items():
        print(f"FAIL {name}: {len(ids)}  e.g. {', '.join(str(i)[:16] for i in ids[:5])}")
    return 1


if __name__ == "__main__":
    sys.exit(main())

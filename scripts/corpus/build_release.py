#!/usr/bin/env python3
"""Build the corpus release from the untouched scrape.

corpus.db is the scrape as imported and is never written here. This script opens
it read-only, applies the rules below in order, and writes two files next to it:

  release.jsonl         one record per line: the release
  release-report.json   counts per rule, collection, genre and decade, plus every
                        excluded or changed record with the rule that did it

The rules are data at the top of this file, so a change to what the release
contains is a reviewable diff. The build is deterministic: the same corpus.db
gives byte-identical output.

Order: exclude whole works, exclude single records, fix speakers, normalize dates,
assign collection and genre, attach the rights basis, drop near-duplicates.

Usage (from the repo root):
  python3 scripts/corpus/build_release.py            # build
  python3 scripts/corpus/build_release.py --summary  # build, print the report summary

Stdlib only.
"""

import argparse
import calendar
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import CORPUS_DB, CORPUS_DIR  # noqa: E402  (stdlib-only module)

RELEASE_JSONL = os.path.join(CORPUS_DIR, "release.jsonl")
RELEASE_REPORT = os.path.join(CORPUS_DIR, "release-report.json")

GUTENBERG = "https://www.gutenberg.org/ebooks/"
TWEETS = "trump_tweet_archive_github"

# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

# Works that are not what the importer thought they were. Every record from the
# source URL is left out of the release.
EXCLUDE_WORKS = {
    GUTENBERG + "5400": "wrong author: 'Complete Works of Winston Churchill' by the "
                        "American novelist (1871-1947), not Winston S. Churchill; "
                        "the records are chapters of his novels",
    GUTENBERG + "36854": "wrong work: 'The Chief Justice: A Novel' by Karl Emil "
                         "Franzos, imported as Frederick Douglass papers",
    GUTENBERG + "12606": "not the speaker's words: Edwin P. Whipple's introduction "
                         "to an anthology of Webster's speeches",
    GUTENBERG + "28020": "compiled work: History of Woman Suffrage, Vol. I (1881), "
                         "edited by Stanton, Anthony and Gage, with chapters and "
                         "documents by many authors; imported as Anthony's own "
                         "words and dated 1898",
    GUTENBERG + "14721": "split wrong: records run past their own document into the "
                         "next ones (one is 321,228 chars), and the book ends in "
                         "anecdotes about Lincoln told by others; needs a re-split",
}

# Single records that are front matter, not the speaker's words. Keyed by
# (source_url, exact title).
EXCLUDE_RECORDS = {
    (GUTENBERG + "18419", "HODDER AND STOUGHTON LONDON MCMIX"):
        "front matter: title page and preface",
}

# Retweets ("RT @...") are another account's text. Old-style quote tweets
# ('"@user: ...') are kept and flagged, because many add the account holder's
# own words after the quote.
EXCLUDE_RETWEETS = True

# Speaker corrections, keyed by source_url. Filled from the opinion-author survey.
SPEAKER_FIXES = {}

# Speakers who cannot have spoken after a date. A record past it is flagged in
# the report (not changed) until SPEAKER_FIXES resolves it.
SPEAKER_LAST_DATE = {
    "john-marshall": "1835-07-06",
}

# Records whose stored day is a placeholder for a year or a month.
DATE_PRECISION_OVERRIDES = {
    "https://en.wikisource.org/wiki/The_War_Prayer": "year",
    "https://en.wikisource.org/wiki/Churchill's_1919_War_Office_Memorandum": "year",
}

# Sources whose dates come from a dated document or an API field, so a first of
# the month is a real day.
DAY_PRECISION_SOURCES = {
    "federal_register", "miller_center", "ucsb_american_presidency_project",
    "american_rhetoric", "cornell_lii", "international_churchill_society",
    "wikisource",
}

# Collections. Tweets and the two literary voices stay out of the core, which is
# the part trend charts count.
VOICES = {"mark-twain", "winston-churchill"}

# Normalized genre. The original type is kept on every record.
GENRE = {
    "speech": "speech", "address": "speech", "remarks": "speech",
    "floor_speech": "speech",
    "debate": "debate",
    "press_conference": "press_conference", "press_gaggle": "press_conference",
    "interview": "interview",
    "statement": "statement",
    "opinion": "opinion",
    "executive_order": "executive_action", "proclamation": "executive_action",
    "founding_document": "document",
    "essay": "writing", "memo": "writing",
    "letter": "letter",
    "tweet": "post", "truth_social": "post",
}

# Rights basis per record group (see rights_group). Every group starts as
# "pending" and gets its basis from the licensing review. A group set to
# "exclude" stays in corpus.db and out of the release.
RIGHTS = defaultdict(lambda: "pending")

# Near-duplicate threshold: the share of the shorter record's 5-word shingles
# found in the longer one. Only records sharing a speaker and date, or a work and
# title, are compared.
CONTAINMENT = 0.8

# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

# Twitter's snowflake ids carry a millisecond timestamp from this epoch
# (2010-11-04). Older ids are sequential and stop near 3e10. Decoded as a
# snowflake, such an id lands seconds after the epoch, so the test is on the id:
# below 2**42 (the epoch's first 17 minutes, which no snowflake id falls in).
SNOWFLAKE_EPOCH_MS = 1288834974657
SNOWFLAKE_MIN_ID = 1 << 42
SNOWFLAKE_START = date(2010, 11, 4)
ACCOUNT_START = date(2009, 3, 1)

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
TWITTER_DAY = re.compile(r"^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2})$")
TITLE_DATE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|"
    r"November|December) (\d{1,2}), (\d{4})\b")
MONTHS = {m: i for i, m in enumerate(calendar.month_name) if m}
ABBR_MONTHS = {m: i for i, m in enumerate(calendar.month_abbr) if m}
ABBR_DAYS = {d: i for i, d in enumerate(calendar.day_abbr)}


def snowflake_time(status_id):
    """UTC datetime encoded in a snowflake id, or None for a pre-snowflake id.

    >>> snowflake_time(1079888205351145472).isoformat()
    '2018-12-31T23:53:06.165000+00:00'
    >>> snowflake_time(24783636234) is None
    True
    """
    if status_id < SNOWFLAKE_MIN_ID:
        return None
    ms = (status_id >> 22) + SNOWFLAKE_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def pre_snowflake_dates(weekday, month, day):
    """Dates between the account's start and the snowflake cutover that match a
    'Mon Dec 31' string. Exactly one for every valid string, because the window
    is under two years.

    >>> pre_snowflake_dates("Thu", "Dec", "31")
    [datetime.date(2009, 12, 31)]
    """
    out = []
    for year in range(ACCOUNT_START.year, SNOWFLAKE_START.year + 1):
        try:
            d = date(year, ABBR_MONTHS[month], int(day))
        except (KeyError, ValueError):
            continue
        if ACCOUNT_START <= d <= SNOWFLAKE_START and d.weekday() == ABBR_DAYS.get(weekday):
            out.append(d)
    return out


def tweet_date(rec, flags):
    """(date, precision, timestamp) for a tweet. The stored date lost its year
    in the scrape; the id or the weekday recovers it."""
    m = re.search(r"/status/(\d+)", rec["source_url"] or "")
    stored = TWITTER_DAY.match(rec["date"] or "")
    if not m:
        flags["tweet_no_status_id"].append(rec["id"])
        return None, "unknown", None
    when = snowflake_time(int(m.group(1)))
    if when:
        if stored and (calendar.day_abbr[when.weekday()], calendar.month_abbr[when.month],
                       "%02d" % when.day) != stored.groups():
            flags["tweet_stored_day_disagrees_with_id"].append(rec["id"])
        return when.date().isoformat(), "day", when.isoformat().replace("+00:00", "Z")
    if stored:
        candidates = pre_snowflake_dates(*stored.groups())
        if len(candidates) == 1:
            return candidates[0].isoformat(), "day", None
    flags["tweet_date_unresolved"].append(rec["id"])
    return None, "unknown", None


def normalize_date(rec, flags):
    """(date, precision, timestamp) for any record."""
    if rec["source_name"] == TWEETS:
        return tweet_date(rec, flags)
    raw = (rec["date"] or "").strip()
    m = ISO_DATE.match(raw)
    if not m:
        t = TITLE_DATE.search(rec["title"] or "")
        if t:
            d = date(int(t.group(3)), MONTHS[t.group(1)], int(t.group(2)))
            return d.isoformat(), "day", None
        if raw:
            flags["date_unparsed"].append(rec["id"])
        return None, "unknown", None
    override = DATE_PRECISION_OVERRIDES.get(rec["source_url"])
    if override:
        return raw, override, None
    if rec["source_name"] in DAY_PRECISION_SOURCES:
        return raw, "day", None
    # Book sources store a publication year or month as its first day.
    _, mm, dd = m.groups()
    if mm == "01" and dd == "01":
        return raw, "year", None
    if dd == "01":
        return raw, "month", None
    return raw, "day", None


# ---------------------------------------------------------------------------
# Grouping, rights and duplicates
# ---------------------------------------------------------------------------

def rights_group(rec):
    """The unit a rights basis applies to: a book for Gutenberg, a speaker for
    Wikisource (one page per record), otherwise the source."""
    if rec["source_name"] == "project_gutenberg":
        return "project_gutenberg:" + rec["source_url"].rsplit("/", 1)[-1]
    if rec["source_name"] == "wikisource":
        return "wikisource:" + rec["speaker"]
    return rec["source_name"]


WORD = re.compile(r"[a-z0-9']+")


def shingles(text, n=5):
    words = WORD.findall(text.lower())
    return {tuple(words[i:i + n]) for i in range(max(1, len(words) - n + 1))}


def find_duplicates(records):
    """Ids of records mostly contained in a longer record they share a speaker
    and date, or a work and title, with. The longer record is kept; on a tie, the
    lower id. Tweets are not compared (no two share a text).

    Federal Register documents are compared only when title and date both match:
    those pairs are republications of one document. Distinct orders signed the
    same day often share a template ("...Our Northern Border" and "...Our
    Southern Border"), so a speaker-and-date match would fold them together."""
    groups = defaultdict(list)
    for r in records:
        if r["collection"] == "tweets":
            continue
        title = (r["title"] or "").strip().lower()
        if r["source_name"] == "federal_register":
            groups[("fr", title, r["date"])].append(r)
            continue
        if r["date"]:
            groups[("day", r["speaker"], r["date"])].append(r)
        groups[("title", r["source_url"], title)].append(r)
    cache, dropped = {}, {}
    for members in groups.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda r: (-len(r["text"]), r["id"]))
        for i, short in enumerate(members):
            if short["id"] in dropped:
                continue
            a = cache.setdefault(short["id"], shingles(short["text"]))
            for long in members[:i]:
                if long["id"] in dropped:
                    continue
                b = cache.setdefault(long["id"], shingles(long["text"]))
                if a and len(a & b) / len(a) >= CONTAINMENT:
                    dropped[short["id"]] = long["id"]
                    break
    return dropped


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def load(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "select id, speaker, date, type, source_url, source_name, text, title "
        "from statements order by id").fetchall()
    con.close()
    return [dict(r) for r in rows]


def build(db_path):
    excluded = []          # (id, rule, detail)
    changed = []           # (id, rule, detail)
    flags = defaultdict(list)
    kept = []

    for rec in load(db_path):
        url, title = rec["source_url"] or "", rec["title"] or ""
        if url in EXCLUDE_WORKS:
            excluded.append((rec["id"], "work", EXCLUDE_WORKS[url]))
            continue
        if (url, title) in EXCLUDE_RECORDS:
            excluded.append((rec["id"], "record", EXCLUDE_RECORDS[(url, title)]))
            continue
        # Federal Register text from GPO carries NUL separators; Postgres text
        # cannot hold NUL, and SQLite's length() stops at the first one.
        raw_text = rec["text"] or ""
        text = raw_text.replace("\x00", "")
        if len(text) != len(raw_text):
            flags["nul_stripped"].append(rec["id"])
        is_retweet = rec["source_name"] == TWEETS and text.startswith("RT @")
        if is_retweet and EXCLUDE_RETWEETS:
            excluded.append((rec["id"], "retweet", "another account's text"))
            continue

        speaker = SPEAKER_FIXES.get(url, rec["speaker"])
        if speaker != rec["speaker"]:
            changed.append((rec["id"], "speaker", f"{rec['speaker']} -> {speaker}"))

        d, precision, timestamp = normalize_date(rec, flags)
        last = SPEAKER_LAST_DATE.get(speaker)
        if last and d and d > last:
            flags["speaker_after_death"].append(rec["id"])

        if rec["source_name"] == TWEETS:
            collection = "tweets"
        elif speaker in VOICES:
            collection = "voices"
        else:
            collection = "core"

        genre = GENRE.get(rec["type"])
        if genre is None:
            flags["genre_unmapped"].append(rec["id"])

        group = rights_group(rec)
        rights = RIGHTS[group]
        if rights == "exclude":
            excluded.append((rec["id"], "rights", group))
            continue

        out = {
            "id": rec["id"],
            "speaker": speaker,
            "date": d,
            "date_precision": precision,
            "collection": collection,
            "genre": genre,
            "type": rec["type"],
            "title": title,
            "source_name": rec["source_name"],
            "source_url": url,
            "rights_group": group,
            "rights": rights,
        }
        if timestamp:
            out["timestamp"] = timestamp
        if rec["source_name"] == TWEETS and text.startswith('"@'):
            out["quote_tweet"] = True
        out["text"] = text
        kept.append(out)

    dropped = find_duplicates(kept)
    for dup_id, kept_id in sorted(dropped.items()):
        excluded.append((dup_id, "duplicate", f"contained in {kept_id}"))
    release = [r for r in kept if r["id"] not in dropped]
    release.sort(key=lambda r: (r["collection"], r["date"] or "9999", r["id"]))
    return release, excluded, changed, flags


def report(release, excluded, changed, flags, db_path):
    by = lambda key: dict(sorted(Counter(key(r) for r in release).items()))  # noqa: E731
    decade = lambda r: f"{r['collection']}:{r['date'][:3]}0s" if r["date"] else f"{r['collection']}:undated"  # noqa: E731
    same_title = defaultdict(list)
    for r in release:
        if r["collection"] != "tweets":
            same_title[(r["source_url"], r["title"])].append(r["id"])
    return {
        "source": os.path.relpath(db_path),
        "records": len(release),
        "chars": sum(len(r["text"]) for r in release),
        "excluded": len(excluded),
        "excluded_by_rule": dict(sorted(Counter(e[1] for e in excluded).items())),
        "excluded_by_reason": dict(sorted(Counter(f"{e[1]}: {e[2]}" for e in excluded
                                                  if e[1] != "duplicate").items())),
        "by_collection": by(lambda r: r["collection"]),
        "chars_by_collection": {c: sum(len(r["text"]) for r in release if r["collection"] == c)
                                for c in sorted({r["collection"] for r in release})},
        "by_genre": by(lambda r: f"{r['collection']}:{r['genre']}"),
        "by_precision": by(lambda r: f"{r['collection']}:{r['date_precision']}"),
        "by_rights": by(lambda r: f"{r['rights']}:{r['rights_group']}"),
        "by_decade": by(decade),
        "quote_tweets": sum(1 for r in release if r.get("quote_tweet")),
        "flags": {k: sorted(v) for k, v in sorted(flags.items())},
        "same_title_in_work": {f"{u} | {t}": ids for (u, t), ids in sorted(same_title.items())
                               if len(ids) > 1},
        "changed": [list(c) for c in changed],
        "excluded_records": [list(e) for e in excluded],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default=CORPUS_DB)
    ap.add_argument("--summary", action="store_true", help="print the report summary")
    args = ap.parse_args()

    release, excluded, changed, flags = build(args.db)
    rep = report(release, excluded, changed, flags, args.db)

    with open(RELEASE_JSONL, "w", encoding="utf-8") as f:
        for r in release:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=False) + "\n")
    with open(RELEASE_REPORT, "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"{rep['records']} records, {rep['chars']:,} chars -> {os.path.relpath(RELEASE_JSONL)}")
    print(f"{rep['excluded']} excluded: {rep['excluded_by_rule']}")
    print(f"flags: { {k: len(v) for k, v in rep['flags'].items()} }")
    if args.summary:
        for key in ("excluded_by_reason", "by_collection", "chars_by_collection",
                    "by_genre", "by_precision", "by_decade"):
            print(f"\n{key}:")
            for k, v in rep[key].items():
                print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")
        print(f"\nsame title within a work: {len(rep['same_title_in_work'])} groups")
        print(f"quote tweets kept and flagged: {rep['quote_tweets']:,}")


if __name__ == "__main__":
    main()

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

Order: exclude whole works, exclude single records, fix speakers, normalize dates
(amendments take theirs from amendments.json), assign collection and genre,
attach the rights basis, drop near-duplicates.

Usage (from the repo root):
  python3 scripts/corpus/build_release.py            # build
  python3 scripts/corpus/build_release.py --summary  # build, print the report summary

Stdlib only.
"""

import argparse
import calendar
import html
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
    GUTENBERG + "9880": "compiled work: The Woman's Bible (1895), long King James "
                        "passages with commentary signed by several authors; "
                        "credited whole to Stanton it would count scripture as "
                        "her words",
    # import_lincoln.py re-splits these two books. Its records carry the URL of
    # the text file it cut them from, so this landing-page URL matches only the
    # old split.
    GUTENBERG + "48364": "split wrong: the record titled Lincoln's Reply opens "
                         "with Douglas's opening speech, and the other holds the "
                         "contents; re-split by import_lincoln.py",
    GUTENBERG + "14721": "split wrong: records run past their own document into the "
                         "next ones (one is 321,228 chars), and the book ends in "
                         "anecdotes about Lincoln told by others; re-split by "
                         "import_lincoln.py",
    GUTENBERG + "5": "superseded: the whole Constitution as one record, with the "
                     "Gutenberg header left on; the National Archives transcription "
                     "gives one record per article",
    GUTENBERG + "2": "superseded: the Bill of Rights as one record; the National "
                     "Archives transcription gives one record per amendment",
}

# Single records that are front matter, not the speaker's words. Keyed by
# (source_url, exact title).
EXCLUDE_RECORDS = {
    (GUTENBERG + "18419", "HODDER AND STOUGHTON LONDON MCMIX"):
        "front matter: title page and preface",
}

# Single records by id, where the title is shared with a record that stays.
EXCLUDE_IDS = {
    "406a1339da0332cddcc057f6c7f31b637fdc7e4a61a85c9a9e85dd9e440011d6":
        "front matter: end of the contents, list of illustrations and George L. "
        "Ruffin's introduction, imported as Life and Times, Chapter XIX",
    "d2f8b270528e26c51717a15bcbbf95b26e2ab4857dabb8a1976f8c4422e0934e":
        "not the opinion: a 1,392-character encyclopedia summary of Loving v. "
        "Virginia; the opinion itself is the Cornell LII record",
}

# Retweets ("RT @...") are another account's text. Old-style quote tweets
# ('"@user: ...') are kept and flagged, because many add the account holder's
# own words after the quote.
EXCLUDE_RETWEETS = True

# Speaker corrections, keyed by source_url. Each author is the one the opinion's
# own first line names ("Mr. Justice CURTIS dissenting"); an unsigned per curiam
# opinion is credited to the Court. import_opinions.py credits its records the
# same way, so the records it replaced need no entry here.
WS = "https://en.wikisource.org/wiki/"
SPEAKER_FIXES = {
    WS + "Dred_Scott_v._Sandford/Dissent_Curtis": "benjamin-curtis",
    WS + "Plessy_v._Ferguson/Opinion_of_the_Court": "henry-brown",
    WS + "Lochner_v._New_York/Opinion_of_the_Court": "rufus-peckham",
    WS + "Bush_v._Gore/Opinion_of_the_Court": "supreme-court",
}

# Opinion records that are not the opinion. import_opinions.py imports each of
# these opinions in full from another page, so these stay out for good.
STUB = ("not the opinion: a syllabus, header or disambiguation page; the "
        "opinion comes from Cornell LII or Wikisource instead")
EXCLUDE_PAGES = {
    WS + "Heart_of_Atlanta_Motel,_Inc._v._United_States": STUB,
    WS + "Engel_v._Vitale": STUB,
    WS + "Mapp_v._Ohio": STUB,
    WS + "Brandenburg_v._Ohio": STUB,
    WS + "Gideon_v._Wainwright": STUB,
    WS + "Tinker_v._Des_Moines_Independent_Community_School_District": STUB,
    WS + "Furman_v._Georgia": STUB,
    WS + "Schenck_v._United_States": STUB,
    WS + "Gregg_v._Georgia": STUB,
    WS + "The_Morals_of_Chess": "stub: 140 characters, not the essay",
    WS + "The_Whistle_(Franklin)": "stub: 189 characters, not the essay",
    WS + "Miranda_v._Arizona/Opinion_of_the_Court":
        "partial: the first 12,819 characters of the Court's opinion, then a "
        "footnote; the full opinion comes from Cornell LII instead",
}

# Speakers who cannot have spoken after a date. A record past it is flagged in
# the report (not changed) until SPEAKER_FIXES resolves it.
SPEAKER_LAST_DATE = {
    "john-marshall": "1835-07-06",
}

# Records whose stored day is a placeholder for a year or a month, or a book
# record whose date really is the first of a month (keyed by URL and title).
LINCOLN_TEXTS = {n: f"https://www.gutenberg.org/cache/epub/{n}/pg{n}.txt" for n in (14721, 48364)}
DATE_PRECISION_OVERRIDES = {
    (LINCOLN_TEXTS[48364], "Proclamation of Emancipation"): "day",
    (LINCOLN_TEXTS[14721], "A Letter to Mrs. O.H. Browning. Springfield, Illinois. April 1, 1838"): "day",
    (LINCOLN_TEXTS[14721], "From the Annual Message to Congress. December 1, 1862"): "day",
    (LINCOLN_TEXTS[14721], "Emancipation Proclamation. January 1, 1863"): "day",
    (LINCOLN_TEXTS[14721], "Letter to Secretary Stanton. Washington. March 1, 1864"): "day",
    "https://en.wikisource.org/wiki/The_War_Prayer": "year",
    "https://en.wikisource.org/wiki/Churchill's_1919_War_Office_Memorandum": "year",
}

# Sources whose dates come from a dated document or an API field, so a first of
# the month is a real day.
DAY_PRECISION_SOURCES = {
    "federal_register", "miller_center", "ucsb_american_presidency_project",
    "american_rhetoric", "cornell_lii", "international_churchill_society",
    "wikisource", "national_archives", "historic_hansard", "govinfo",
}

# Amendment dates, reconciled across the National Archives, the Constitution
# Annotated and the House Manual, with the convention each date follows. An
# amendment's record date is its ratification; the proposal and certification
# dates ride along as fields.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "amendments.json"),
          encoding="utf-8") as _f:
    AMENDMENTS = {a["number"]: a for a in json.load(_f)["amendments"]}
AMENDMENT_TITLE = re.compile(r"^Amendment ([IVXL]+)$")

# Miller Center speeches whose bulk-download record has no URL: the page for
# each, keyed by title, every one fetched and checked against the title.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "miller_urls.json"),
          encoding="utf-8") as _f:
    MILLER_URLS = json.load(_f)["urls"]

# Collections. Trend charts count the core only. Tweets and the two literary
# voices are kept apart, and so are Federal Register orders and proclamations:
# the API starts in 1993, so in the core they would put a step in every trend
# that comes from the source's coverage, not from the record.
VOICES = {"mark-twain", "winston-churchill"}
EXECUTIVE_SOURCES = {"federal_register"}

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

# Rights basis per record group (see rights_group), settled by the licensing
# review on 2026-11-15. Bases: "us-gov-work" (17 USC 105: federal officers'
# official work, court opinions), "pd-expired" (published before 1931 in the
# US) and "license:<id>" (a license the publisher grants, whose attribution
# rides along on each record). A group with a reason instead stays in corpus.db
# and out of the release.
RIGHTS = {
    "federal_register": "us-gov-work",
    "cornell_lii": "us-gov-work",
    "national_archives": "us-gov-work",
    "historic_hansard": "license:OPL-3.0",
    "govinfo": "us-gov-work",
}

# Attribution text each license requires, in the licensor's words.
ATTRIBUTION = {
    "license:OPL-3.0": "Contains Parliamentary information licensed under the "
                       "Open Parliament Licence v3.0.",
}
NO_BASIS = {
    TWEETS: "no rights basis: third-party archive with no license; X's terms "
            "bar scraping; no basis for pre-2017 posts, and in-term posts as "
            "government work is an open question",
    "ucsb_american_presidency_project": "no rights basis: debate transcripts "
            "are not government work; UCSB's terms bar republishing and the "
            "sponsors reserve all rights",
    "international_churchill_society": "no rights basis: the Churchill estate "
            "holds the rights and the host's terms are personal use only",
    "american_rhetoric": "no rights basis in this copy: the host claims its "
            "transcripts; floor and committee speeches come from government "
            "sources instead",
    "wikisource:winston-churchill": "no rights basis: post-1930 Churchill is the "
            "estate's; the 1940 Commons speeches come from Hansard instead",
}

# Miller Center: speeches before 1931 are public domain by age. Later ones are
# government work only when given in office as part of the job; convention,
# campaign, debate and candidate-era speeches are not.
MILLER_PARTISAN = re.compile(
    r"Democratic National Convention|Republican National Convention|Accept.*Nomination|"
    r"Acceptance Speech|Nominee Acceptance|Acceptance of the Democratic|Debate with|"
    r"Presidential Debate|Campaign Speech|Campaign Rally|Election Night|Victory|"
    r"Checkers|Time for Choosing|Ministerial|Candidacy|Election Eve|City Upon",
    re.IGNORECASE)

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
    override = (DATE_PRECISION_OVERRIDES.get(rec["source_url"])
                or DATE_PRECISION_OVERRIDES.get((rec["source_url"], rec["title"])))
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


HEADING_DATE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|"
    r"November|December) (\d{1,2}), (\d{4})\b", re.IGNORECASE)


def heading_block(text):
    """The lines under a record's title and above its first line of body text
    (unindented and over 60 characters), where book editions print the venue
    and date of a speech.

    >>> heading_block("THE WEATHER\\n\\n   ADDRESS AT DINNER,\\n   MAY 1, 1876.\\n\\n" + "x" * 70)
    '   ADDRESS AT DINNER,\\n   MAY 1, 1876.'
    """
    lines = text.splitlines()[1:]
    out = []
    for line in lines:
        if len(line) > 60 and not line[:1].isspace():
            break
        if line.strip():
            out.append(line)
    return "\n".join(out)


def heading_date(text, stored, precision):
    """A day-precision date from the heading block, accepted only when it agrees
    with the stored year (and month, when the month was stored). None otherwise.

    >>> heading_date("X\\nLONDON, SEPTEMBER 28, 1872.\\n" + "x" * 70, "1872-01-01", "year")
    '1872-09-28'
    >>> heading_date("X\\nLONDON, SEPTEMBER 28, 1873.\\n" + "x" * 70, "1872-01-01", "year") is None
    True
    """
    m = HEADING_DATE.search(heading_block(text))
    if not m:
        return None
    found = date(int(m.group(3)), MONTHS[m.group(1).capitalize()], int(m.group(2)))
    iso = found.isoformat()
    if precision == "unknown" or not stored:
        return iso
    if precision == "year" and iso[:4] == stored[:4]:
        return iso
    if precision == "month" and iso[:7] == stored[:7]:
        return iso
    return None


PG_START = re.compile(r"^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$", re.MULTILINE)
# The END line is sometimes gone and the license follows the text directly, so
# the license's own first line counts as the footer too.
PG_END = re.compile(r"^(\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG|End of (the )?Project "
                    r"Gutenberg|Updated editions will replace the previous one)",
                    re.MULTILINE | re.IGNORECASE)
TRANSCRIBER = re.compile(r"^\s*\[?Transcriber[’']s Notes?\b", re.MULTILINE | re.IGNORECASE)


def strip_boilerplate(text):
    """Remove what Project Gutenberg and its transcribers added: the header
    through its START line, the footer from its END line, and transcriber's
    notes in the last third of a record. The author's text is left as printed.

    >>> strip_boilerplate("Header\\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\\nWords.\\n"
    ...                   "End of Project Gutenberg's X")
    'Words.'
    """
    m = PG_START.search(text)
    if m:
        text = text[m.end():]
    m = PG_END.search(text)
    if m:
        text = text[:m.start()]
    m = TRANSCRIBER.search(text)
    if m and m.start() > len(text) * 2 / 3:
        text = text[:m.start()]
    return text.strip()


HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
FR_DOC = re.compile(r"\[FR Doc\.?(?: No:)? ?([A-Z0-9][A-Z0-9-]+)")

CONTENTS_LINE = re.compile(r"^\s*CHAPTER [IVXLC]+\.", re.MULTILINE)
CHAPTER_TITLE = re.compile(r", Chapter [IVXLC]+$")
ROMAN_LINE = re.compile(r"^[IVXLC]+$")
SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
               "or", "the", "to", "with"}


def is_contents(text):
    """A table of contents imported as a chapter: five or more chapter lines."""
    return len(CONTENTS_LINE.findall(text[:5000])) >= 5


def title_case(s):
    """'A GENERAL SURVEY OF THE SLAVE PLANTATION.' -> 'A General Survey of the
    Slave Plantation'. Lines that are not all capitals are kept as printed.

    >>> title_case("“HONOR TO WHOM HONOR.”")
    '“Honor to Whom Honor”'
    >>> title_case("Genesis i: 26, 27, 28.")
    'Genesis i: 26, 27, 28'
    """
    s = s.strip().strip("_").strip()
    s = re.sub(r"\.(?=[”\"]?$)", "", s)
    if s != s.upper():
        return s
    words = s.lower().split()
    out = []
    for i, w in enumerate(words):
        lead = re.match(r"^[“\"‘']*", w).group()
        core = w[len(lead):]
        out.append(lead + (core if i and core in SMALL_WORDS else core[:1].upper() + core[1:]))
    return " ".join(out)


def subtitle(rec):
    """The line a chapter or numbered speech prints under its heading: the
    chapter's own title, or the part number of a speech in several parts."""
    lines = [l.strip() for l in rec["text"].splitlines() if l.strip()][:3]
    if len(lines) < 2:
        return None
    if CHAPTER_TITLE.search(rec["title"]) and re.match(r"^CHAPTER [IVXLC]+\.?$", lines[0]):
        return ": " + title_case(lines[1])
    if ROMAN_LINE.match(lines[1]):
        return ", " + lines[1]
    return None


def disambiguate_titles(records, changed):
    """Within a work, give records that share a title the subtitle their text
    prints. When any title in a work is shared, every chapter in it gets one, so
    the work's titles stay uniform."""
    # Federal Register corrections are titled "Correction" or repeat the title
    # of the document they correct; the document number tells them apart.
    fr = defaultdict(list)
    for r in records:
        if r["source_name"] == "federal_register":
            fr[(r["title"], r["date"])].append(r)
    for members in fr.values():
        if len(members) < 2:
            continue
        for r in members:
            m = FR_DOC.search(r["text"])
            if m:
                extra = f" (FR Doc. {m.group(1)})"
                changed.append((r["id"], "title", f"{r['title']} -> {r['title'] + extra}"))
                r["title"] += extra

    by_work = defaultdict(list)
    for r in records:
        if r["collection"] != "tweets":
            by_work[r["source_url"]].append(r)
    for members in by_work.values():
        counts = Counter(r["title"] for r in members)
        if max(counts.values()) < 2:
            continue
        for r in members:
            if counts[r["title"]] < 2 and not CHAPTER_TITLE.search(r["title"]):
                continue
            extra = subtitle(r)
            if extra:
                changed.append((r["id"], "title", f"{r['title']} -> {r['title'] + extra}"))
                r["title"] += extra


# ---------------------------------------------------------------------------
# Grouping, rights and duplicates
# ---------------------------------------------------------------------------

def rights_group(rec):
    """The unit a rights basis applies to: a book for Gutenberg, a speaker for
    Wikisource (one page per record), otherwise the source."""
    if rec["source_name"] == "project_gutenberg":
        # The ebook number, from a landing page (/ebooks/14721) or a text file
        # (/cache/epub/14721/pg14721.txt).
        return "project_gutenberg:" + re.search(r"/(?:ebooks|epub)/(\d+)", rec["source_url"]).group(1)
    if rec["source_name"] == "wikisource":
        return "wikisource:" + rec["speaker"]
    return rec["source_name"]


def rights_basis(rec, group, d, title):
    """(basis, None) for a record that may be released, or (None, reason)."""
    if group in NO_BASIS:
        return None, NO_BASIS[group]
    if group in RIGHTS:
        return RIGHTS[group], None
    if rec["source_name"] == "miller_center":
        if d and d < "1931":
            return "pd-expired", None
        if MILLER_PARTISAN.search(title):
            return None, ("no rights basis: convention, campaign, debate or "
                          "candidate-era speech, not an official duty")
        return "us-gov-work", None
    if rec["source_name"] == "wikisource" and rec["type"] == "opinion":
        return "us-gov-work", None
    if rec["source_name"] in ("project_gutenberg", "wikisource"):
        return "pd-expired", None
    return None, f"no rights basis recorded for {group}"


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
        if url in EXCLUDE_PAGES:
            excluded.append((rec["id"], "page", EXCLUDE_PAGES[url]))
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
        # GPO wraps each Federal Register document in an HTML page around a
        # <pre> block. The tags go; the printed text stays as it is.
        if rec["source_name"] == "federal_register":
            text = html.unescape(HTML_TAG.sub("", text))
        is_retweet = rec["source_name"] == TWEETS and text.startswith("RT @")
        if is_retweet and EXCLUDE_RETWEETS:
            excluded.append((rec["id"], "retweet", "another account's text"))
            continue
        if rec["id"] in EXCLUDE_IDS:
            excluded.append((rec["id"], "record", EXCLUDE_IDS[rec["id"]]))
            continue
        is_book = rec["source_name"] == "project_gutenberg"
        if is_book:
            stripped = strip_boilerplate(text)
            if stripped != text.strip():
                flags["boilerplate_stripped"].append(rec["id"])
            text = stripped
        if is_book and is_contents(text):
            excluded.append((rec["id"], "record", "front matter: table of contents"))
            continue

        if not url and rec["source_name"] == "miller_center" and title in MILLER_URLS:
            url = MILLER_URLS[title]
            changed.append((rec["id"], "source_url", url))

        speaker = SPEAKER_FIXES.get(url, rec["speaker"])
        if speaker != rec["speaker"]:
            changed.append((rec["id"], "speaker", f"{rec['speaker']} -> {speaker}"))

        d, precision, timestamp = normalize_date(rec, flags)
        if is_book and precision in ("year", "month", "unknown"):
            found = heading_date(text, d, precision)
            if found:
                changed.append((rec["id"], "date", f"{d} ({precision}) -> {found} (heading)"))
                d, precision = found, "day"
        amendment = None
        m = AMENDMENT_TITLE.match(title)
        if m and rec["source_name"] == "national_archives":
            amendment = AMENDMENTS[m.group(1)]
            if d != amendment["date"]:
                changed.append((rec["id"], "date", f"{d} -> {amendment['date']} (amendments.json)"))
                d, precision = amendment["date"], "day"
        last = SPEAKER_LAST_DATE.get(speaker)
        if last and d and d > last:
            flags["speaker_after_death"].append(rec["id"])

        if rec["source_name"] == TWEETS:
            collection = "tweets"
        elif rec["source_name"] in EXECUTIVE_SOURCES:
            collection = "executive"
        elif speaker in VOICES:
            collection = "voices"
        else:
            collection = "core"

        genre = GENRE.get(rec["type"])
        if genre is None:
            flags["genre_unmapped"].append(rec["id"])

        group = rights_group(rec)
        rights, reason = rights_basis(rec, group, d, title)
        if reason:
            excluded.append((rec["id"], "rights", reason))
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
        if rights in ATTRIBUTION:
            out["attribution"] = ATTRIBUTION[rights]
        if amendment:
            out["proposed"] = amendment["proposed"]
            if amendment["certified"]:
                out["certified"] = amendment["certified"]
        if rec["source_name"] == TWEETS and text.startswith('"@'):
            out["quote_tweet"] = True
        out["text"] = text.strip()
        kept.append(out)

    dropped = find_duplicates(kept)
    for dup_id, kept_id in sorted(dropped.items()):
        excluded.append((dup_id, "duplicate", f"contained in {kept_id}"))
    release = [r for r in kept if r["id"] not in dropped]
    disambiguate_titles(release, changed)
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

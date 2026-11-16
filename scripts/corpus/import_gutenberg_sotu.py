#!/usr/bin/env python3
"""Import State of the Union messages the corpus lacks, from Project Gutenberg.

Source: the "State of the Union Addresses" ebooks, one per president, each a
plain-text file whose messages are separated by a line of three asterisks and
headed by a title, the president's name and the date:
- 5038 Franklin D. Roosevelt: 1934 to 1940, 1942 and 1945
- 5039 Harry S. Truman: all eight messages, 1946 to 1953
- 5040 Dwight D. Eisenhower: January 12, 1961
- 5043 Richard Nixon: February 2, 1973
- 5045 Jimmy Carter: January 16, 1981
- 5049 George W. Bush: February 27, 2001

Why these: the Miller Center bulk download, the corpus's main source for
presidential speeches, has no record for these dates. Each ebook also holds
messages the corpus already has from Miller Center; those are not listed here
and are never read. Before inserting, the script looks for a record by the same
speaker within 3 days of each date whose title names a State of the Union
message, and skips the message if it finds one. Other records near a date (a
proclamation, a farewell speech) are printed but do not stop the import.

The text is kept as published: only the Gutenberg boilerplate, the ebook's
front matter and each message's three header lines are removed, and line
endings are normalized to \\n. Lines are not reflowed; build_release.py does
that. Title rule: "<Month D, YYYY>: State of the Union Address", the form the
Miller Center records use. Type is "address", also as in those records.

Usage:
  CORPUS_UA_CONTACT=<email or URL> python3 scripts/corpus/import_gutenberg_sotu.py
  python3 scripts/corpus/import_gutenberg_sotu.py --dry-run   # parse and check, write nothing
"""

import argparse
import os
import re
import sqlite3
import sys
from datetime import datetime

import requests

from ingest import CORPUS_DB, RAW_DIR, bulk_insert, make_id, user_agent

# ebook id -> (speaker slug, dates wanted, in the form the ebook prints them)
BOOKS = {
    5038: ("franklin-d-roosevelt", [
        "January 3, 1934", "January 4, 1935", "January 3, 1936",
        "January 6, 1937", "January 3, 1938", "January 4, 1939",
        "January 3, 1940", "January 6, 1942", "January 6, 1945"]),
    5039: ("harry-s-truman", [
        "January 21, 1946", "January 6, 1947", "January 7, 1948",
        "January 5, 1949", "January 4, 1950", "January 8, 1951",
        "January 9, 1952", "January 7, 1953"]),
    5040: ("dwight-d-eisenhower", ["January 12, 1961"]),
    5043: ("richard-nixon", ["February 2, 1973"]),
    5045: ("jimmy-carter", ["January 16, 1981"]),
    5049: ("george-w-bush", ["February 27, 2001"]),
}

WINDOW_DAYS = 3
SEPARATOR = re.compile(r"^\*\*\*\s*$", re.MULTILINE)
DATE_LINE = re.compile(r"^[A-Z][a-z]+ \d{1,2}, \d{4}$")


def read_local_or_fetch(session, ebook):
    """Read the ebook from the local cache in tmp/, or fetch it once."""
    filename = f"gutenberg_sotu_{ebook}.txt"
    local_path = os.path.join(RAW_DIR, filename)
    if os.path.exists(local_path):
        print(f"  Reading from local cache: tmp/corpus/raw/{filename}")
        with open(local_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    url = f"https://www.gutenberg.org/cache/epub/{ebook}/pg{ebook}.txt"
    print(f"  Fetching from {url}...")
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8", newline="") as f:
        f.write(resp.text)
    return resp.text


def strip_gutenberg(raw):
    """Strip Project Gutenberg header and footer from text."""
    start = 0
    for marker in ["*** START OF THE PROJECT GUTENBERG", "*** START OF THIS PROJECT GUTENBERG"]:
        pos = raw.find(marker)
        if pos != -1:
            start = raw.find("\n", pos) + 1
            break

    end = len(raw)
    for marker in ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]:
        pos = raw.find(marker, start)
        if pos != -1:
            end = pos
            break

    return raw[start:end].strip()


def split_messages(raw):
    """Return {date string: message text} for every section of an ebook.

    The first section is front matter (the list of dates), so it is dropped. A
    section opens with three non-blank header lines: title, president, date.
    """
    content = strip_gutenberg(raw.replace("\r\n", "\n"))
    sections = SEPARATOR.split(content)[1:]
    messages = {}
    for section in sections:
        lines = section.strip("\n").split("\n")
        header = [ln.strip() for ln in lines[:3]]
        when = header[2] if len(header) == 3 else ""
        if not DATE_LINE.match(when):
            sys.exit(f"Unrecognized section header: {header!r}")
        messages[when] = "\n".join(lines[3:]).strip()
    return messages


def iso(when):
    return datetime.strptime(when, "%B %d, %Y").date()


def existing_near(conn, speaker, day):
    """(date, title) of records by this speaker within WINDOW_DAYS of day."""
    rows = conn.execute(
        "SELECT date, title FROM statements WHERE speaker = ? AND date IS NOT NULL "
        "AND abs(julianday(date) - julianday(?)) <= ?",
        (speaker, day.isoformat(), WINDOW_DAYS)).fetchall()
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": user_agent()})
    conn = sqlite3.connect(CORPUS_DB)

    records = []
    skipped = []
    for ebook, (speaker, wanted) in BOOKS.items():
        print(f"Gutenberg {ebook} ({speaker})...")
        messages = split_messages(read_local_or_fetch(session, ebook))
        missing = [w for w in wanted if w not in messages]
        if missing:
            sys.exit(f"Ebook {ebook} has no message dated {', '.join(missing)}")
        for when in wanted:
            day = iso(when)
            nearby = existing_near(conn, speaker, day)
            found = [r for r in nearby if "state of the union" in (r[1] or "").lower()]
            if nearby and not found:
                print(f"  Note {when}: other records nearby, none a State of the Union: {nearby}")
            if found:
                skipped.append((speaker, when, found))
                print(f"  SKIP {when}: already have {found}")
                continue
            text = messages[when]
            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": day.isoformat(),
                "type": "address",
                "source_url": f"https://www.gutenberg.org/ebooks/{ebook}",
                "source_name": "project_gutenberg",
                "text": text,
                "title": f"{when}: State of the Union Address",
            })
            print(f"  Parsed: {when} ({len(text.split())} words)")
    conn.close()

    print(f"\n{len(records)} to insert, {len(skipped)} skipped")
    if args.dry_run:
        print("Dry run: nothing written")
        return
    if records:
        bulk_insert(records)


if __name__ == "__main__":
    main()

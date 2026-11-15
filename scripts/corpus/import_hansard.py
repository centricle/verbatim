#!/usr/bin/env python3
"""Import four of Winston Churchill's 1940 House of Commons speeches from the
official report (Hansard), as published by the historic Hansard service.

Hansard is Parliamentary copyright, licensed under the Open Parliament Licence
v3.0, which allows republishing with the attribution build_release.py attaches
to each record. Churchill's later broadcasts and speeches outside Parliament
carry no such license and are not imported.

Each speech is the single contribution historic Hansard's anchor points to: the
member's words as reported, without the column numbers printed in the margin.
The title is the debate's heading in the report, with the sitting date.

Usage (from the repo root):
  python3 scripts/corpus/import_hansard.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_hansard.py
"""

import argparse
import os
import re
import sys
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

BASE = "https://api.parliament.uk/historic-hansard/commons/"
SOURCE_NAME = "historic_hansard"
SPEAKER = "winston-churchill"
SPEAKER_PAGE = "/historic-hansard/people/mr-winston-churchill"

# (sitting date, section path, contribution anchor, known words)
SPEECHES = [
    ("1940-05-13", "1940/may/13/his-majestys-government-1", "S5CV0360P0_19400513_HOC_21",
     "I have nothing to offer but blood, toil, tears and sweat"),
    ("1940-06-04", "1940/jun/04/war-situation", "S5CV0361P0_19400604_HOC_231",
     "we shall fight on the beaches"),
    ("1940-06-18", "1940/jun/18/war-situation", "S5CV0362P0_19400618_HOC_260",
     "This was their finest hour"),
    ("1940-08-20", "1940/aug/20/war-situation", "S5CV0364P0_19400820_HOC_279",
     "Never in the field of human conflict was so much owed by so many to so few"),
]

COLUMN = "⁂"   # stands in for a column number while lines are rejoined

_session = None


def fetch(path):
    cache = os.path.join(RAW_DIR, "hansard-" + path.replace("/", "-") + ".html")
    if not os.path.exists(cache):
        global _session
        if _session is None:
            _session = requests.Session()
            _session.headers["User-Agent"] = user_agent()
        time.sleep(1.5)
        print(f"  fetching {BASE + path}")
        resp = _session.get(BASE + path, timeout=60)
        resp.raise_for_status()
        os.makedirs(RAW_DIR, exist_ok=True)
        with open(cache, "wb") as f:
            f.write(resp.content)
    with open(cache, encoding="utf-8") as f:
        return f.read()


def contribution(html, anchor):
    """(heading, text) for the contribution the anchor names."""
    soup = BeautifulSoup(html, "html.parser")
    mark = soup.find("a", attrs={"name": anchor})
    if mark is None:
        sys.exit(f"{anchor}: anchor not on the page")
    block = mark.find_parent("div", class_="member_contribution")
    who = block.select_one("cite.member a")
    if who is None or who.get("href") != SPEAKER_PAGE:
        sys.exit(f"{anchor}: contribution is not Churchill's ({who})")
    heading = soup.find("h1", class_="title") or soup.find("h1")
    for col in block.select("a.column-permalink"):
        col.replace_with(COLUMN)
    paragraphs = []
    for p in block.select("blockquote p"):
        # A column number sits on its own line in the middle of a sentence; the
        # remaining line breaks are the report's paragraphs.
        text = re.sub(r"\s*" + COLUMN + r"\s*", " ", p.get_text())
        paragraphs += [" ".join(line.split()) for line in text.split("\n") if line.strip()]
    return " ".join(heading.get_text().split()), "\n\n".join(paragraphs)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    print("Hansard: Churchill, 1940")
    records = []
    for day, path, anchor, words in SPEECHES:
        heading, text = contribution(fetch(path), anchor)
        if words.lower() not in " ".join(text.split()).lower():
            sys.exit(f"{day}: expected words not found: {words!r}")
        d = date.fromisoformat(day)
        # The report prints headings in capitals with a closing period.
        heading = " ".join(w.capitalize() for w in heading.rstrip(".").lower().split())
        title = f"{heading} (House of Commons, {d.day} {d:%B %Y})"
        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
            "date": day,
            "type": "speech",
            "source_url": f"{BASE}{path}#{anchor}",
            "source_name": SOURCE_NAME,
            "text": text,
            "title": title,
        })
        print(f"  {day}  {title:<52} {len(text):>7,} chars")

    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

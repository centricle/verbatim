#!/usr/bin/env python3
"""Import statements from Government Publishing Office prints on GovInfo, in
place of copies from transcript sites that claim their transcripts.

  Barbara Jordan, statement in the House Judiciary Committee's debate on the
  articles of impeachment, July 25, 1974 (evening session). From the committee's
  print, "Debate on Articles of Impeachment" (CHRG-93hhrg38750), using the plain
  text GPO publishes beside the scan. The statement runs from the heading the
  print gives it to "I yield back the balance of my time, Mr. Chairman." The
  speaker label that opens it ("Ms. Jordan.") is dropped, as are the page numbers
  the text file leaves on their own lines in the middle of sentences.

GPO's text is OCR of the printed page. Where it misreads the print, the fix is
listed below, word for word, and each must apply exactly once. Proceedings
printed by the GPO are U.S. government works.

Usage (from the repo root):
  python3 scripts/corpus/import_govinfo.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_govinfo.py
"""

import argparse
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

GOVINFO = "https://www.govinfo.gov/content/pkg/"

STATEMENTS = [
    {
        "package": "CHRG-93hhrg38750",
        "speaker": "barbara-jordan",
        "date": "1974-07-25",
        "type": "statement",
        "title": "Statement on the Articles of Impeachment (House Judiciary Committee, "
                 "July 25, 1974)",
        "after": "THURSDAY, JULY 25, 1974",
        "heading": "STATEMENT OF HON. BARBARA JORDAN",
        "label": "Ms. Jordan. ",
        "last": "I yield back the balance of my time, Mr. Chairman.",
        "ocr_fixes": [
            ("thanking you tor giving", "thanking you for giving"),
            ("mi scon -duct of public men", "misconduct of public men"),
            ("Federalist Papers No'. 65", "Federalist Papers No. 65"),
        ],
        "known": "My faith in the Constitution is whole, it is complete, it is total.",
    },
]

# A printed page number on a line of its own; OCR reads 111 as "Ill".
PAGE_NUMBER = re.compile(r"^(?:\d{1,4}|[Il1]{3})$")

_session = None


def fetch(package):
    path = os.path.join(RAW_DIR, f"govinfo-{package}.txt")
    if not os.path.exists(path):
        global _session
        if _session is None:
            _session = requests.Session()
            _session.headers["User-Agent"] = user_agent()
        url = f"{GOVINFO}{package}/text/{package}.txt"
        time.sleep(1.5)
        print(f"  fetching {url}")
        resp = _session.get(url, timeout=120)
        resp.raise_for_status()
        os.makedirs(RAW_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(resp.content)
    with open(path, encoding="utf-8") as f:
        return f.read()


def cut(raw, s):
    lines = [l.strip() for l in raw.split("\n")]
    after = lines.index(s["after"])
    start = next(i for i in range(after, len(lines)) if lines[i].startswith(s["heading"]))
    end = next(i for i in range(start, len(lines)) if lines[i].endswith(s["last"]))
    paras = []
    joining = False
    for line in lines[start + 1:end + 1]:
        if not line:
            continue
        if PAGE_NUMBER.match(line):
            joining = True      # the sentence continues on the next page
            continue
        if joining and paras:
            paras[-1] += " " + line
        else:
            paras.append(line)
        joining = False
    if not paras[0].startswith(s["label"]):
        sys.exit(f"{s['title']}: does not open with {s['label']!r}")
    paras[0] = paras[0][len(s["label"]):]
    text = "\n\n".join(paras)
    for wrong, right in s["ocr_fixes"]:
        if text.count(wrong) != 1:
            sys.exit(f"{s['title']}: OCR fix {wrong!r} found {text.count(wrong)} times")
        text = text.replace(wrong, right)
    if s["known"] not in text:
        sys.exit(f"{s['title']}: expected words not found: {s['known']!r}")
    return text


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    print("GovInfo prints")
    records = []
    for s in STATEMENTS:
        text = cut(fetch(s["package"]), s)
        records.append({
            "id": make_id(s["speaker"], text),
            "speaker": s["speaker"],
            "date": s["date"],
            "type": s["type"],
            "source_url": f"https://www.govinfo.gov/app/details/{s['package']}",
            "source_name": "govinfo",
            "text": text,
            "title": s["title"],
        })
        print(f"  {s['date']}  {s['title']}  {len(text):,} chars")
    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

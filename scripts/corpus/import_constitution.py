#!/usr/bin/env python3
"""Import the Constitution and its 27 amendments, one record per part, from the
National Archives transcriptions.

Three pages on archives.gov, one request each, cached under RAW_DIR:

  constitution-transcript    The Preamble and Articles I to VII, transcribed from
                             the parchment (spelling and punctuation as signed).
                             The interlineation note, the attestation, the "done
                             in Convention" clause and the signers follow Article
                             VII with no heading of their own, so they end that
                             record.
  bill-of-rights-transcript  Amendments I to X, from the page's second half. The
                             first half, the 1789 joint resolution proposing
                             twelve articles, is not imported.
  amendments-11-27           Amendments XI to XXVII.

Titles are "Constitution, Preamble", "Constitution, Article I" and so on, and
"Amendment I" to "Amendment XXVII". The Preamble and Articles are credited to the
Constitutional Convention, the amendments to Congress, which proposed each one.
Section headings stay in the text; the record's own heading does not.

The National Archives' annotations are not part of the text and are dropped:
the "Note:" paragraphs saying which clause an amendment changed, the "*Superseded
by" and "*Changed by" footnotes with their asterisk markers, and the brackets
that mark the superseded passage of Amendment XII. The words inside the brackets
are the amendment's and stay.

The date stored is the one the page gives: 1787-09-17 for the Preamble and
Articles, the ratification date for an amendment. build_release.py takes each
amendment's date from amendments.json, which reconciles these pages with two
other government sources, and adds the proposal and certification dates.

Usage (from the repo root):
  python3 scripts/corpus/import_constitution.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_constitution.py
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

NARA = "https://www.archives.gov/founding-docs/"
PAGES = {
    "constitution": NARA + "constitution-transcript",
    "bill_of_rights": NARA + "bill-of-rights-transcript",
    "amendments": NARA + "amendments-11-27",
}
SOURCE_NAME = "national_archives"
TYPE = "founding_document"
CONVENTION = "constitutional-convention"
CONGRESS = "united-states-congress"
SIGNED = "1787-09-17"

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
         "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII",
         "XXIII", "XXIV", "XXV", "XXVI", "XXVII"]

# Annotation marks each amendment is known to carry on the page. A mark anywhere
# else means the page changed, and the import stops rather than guess.
MARKS = "[]*"
EXPECTED_MARKS = {"XII": set("[]*"), "XIV": set("*")}

# Words every parse must find, so a page that answers 200 with something else
# (a redesign, an error page) fails loudly.
KNOWN = {
    "Constitution, Preamble": "insure domestic Tranquility",
    "Constitution, Article I": "Section. 10.",
    "Constitution, Article VII": "Attest William Jackson Secretary",
    "Amendment I": "Congress shall make no law respecting an establishment of religion",
    "Amendment XIV": "nor shall any State deprive any person of life, liberty, or property",
    "Amendment XXVII": "No law, varying the compensation",
}

MONTH_DATE = r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, \d{4})"

_session = None


def fetch(key):
    """The page's HTML, from the RAW_DIR cache or, failing that, archives.gov."""
    url = PAGES[key]
    path = os.path.join(RAW_DIR, "nara-" + url.rsplit("/", 1)[-1] + ".html")
    if os.path.exists(path):
        print(f"  cached: {os.path.relpath(path)}")
        with open(path, encoding="utf-8") as f:
            return f.read()
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = user_agent()
    print(f"  fetching {url}")
    resp = _session.get(url, timeout=60)
    resp.raise_for_status()
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(path, "wb") as f:
        f.write(resp.content)
    return resp.content.decode("utf-8")


def clean(el):
    """An element's text, with <br> as a line break and spaces collapsed."""
    for br in el.find_all("br"):
        br.replace_with("\n")
    lines = (" ".join(line.split()) for line in el.get_text().replace("\xa0", " ").split("\n"))
    return "\n".join(line for line in lines if line)


def iso(text):
    """'February 7, 1795' or 'Sept. 25, 1789' as an ISO date."""
    month, rest = text.split(" ", 1)
    month = month.rstrip(".")[:3]
    return datetime.strptime(f"{month} {rest}", "%b %d, %Y").date().isoformat()


def record(speaker, title, anchor, date, blocks):
    text = "\n\n".join(blocks)
    url = PAGES["constitution"] if speaker == CONVENTION else None
    return {
        "id": make_id(speaker, text),
        "speaker": speaker,
        "date": date,
        "type": TYPE,
        "source_url": f"{url}#{anchor}" if anchor else url,
        "source_name": SOURCE_NAME,
        "text": text,
        "title": title,
    }


def parse_constitution(page):
    soup = BeautifulSoup(page, "html.parser")
    h1 = soup.find("h1", string=re.compile(r"Constitution of the United States"))
    parts = []      # [title, anchor, blocks]
    for el in h1.find_all_next(["h2", "h3", "p"]):
        text = clean(el)
        if el.name == "p" and "non-signing delegates" in text:
            break
        if not parts:
            # The callout and spacer paragraphs above the Preamble are the
            # archive's, not the document's.
            if el.name == "p" and text.startswith("We the People"):
                parts.append(["Constitution, Preamble", None, [text]])
            continue
        if el.name == "h2":
            m = re.fullmatch(r"Article\. ([IVX]+)\.", text)
            if not m:
                sys.exit(f"constitution: unexpected heading {text!r}")
            parts.append([f"Constitution, Article {m.group(1)}", el.get("id"), []])
        elif text:
            parts[-1][2].append(text)
    return [record(CONVENTION, title, anchor, SIGNED, blocks)
            for title, anchor, blocks in parts]


def parse_bill_of_rights(page):
    soup = BeautifulSoup(page, "html.parser")
    note = re.search(r"These amendments were ratified " + MONTH_DATE, soup.get_text())
    if not note:
        sys.exit("bill of rights: ratification note not found")
    ratified = iso(note.group(1))
    start = soup.find("h2", string="The U.S. Bill of Rights")
    out = []
    for h3 in start.find_all_next("h3"):
        m = re.fullmatch(r"Amendment ([IVX]+)", clean(h3))
        if not m:
            continue
        body = clean(h3.find_next_sibling("p"))
        rec = record(CONGRESS, f"Amendment {m.group(1)}", None, ratified, [body])
        rec["source_url"] = f"{PAGES['bill_of_rights']}#amendment{m.group(1)}"
        out.append(rec)
    return out


def parse_amendments(page):
    soup = BeautifulSoup(page, "html.parser")
    heads = [h for h in soup.find_all(["h2", "h3"])
             if re.fullmatch(r"AMENDMENT [IVXL]+", clean(h))]
    out = []
    for i, head in enumerate(heads):
        number = clean(head).split()[1]
        stop = heads[i + 1] if i + 1 < len(heads) else None
        ratified, blocks = None, []
        for el in head.find_all_next(["h2", "h3", "p"]):
            if el is stop:
                break
            text = clean(el)
            if el.name != "p":
                if not re.fullmatch(r"Section \d+\.", text):
                    break   # "On This Page" and the rest of the page chrome
                blocks.append(text)
                continue
            if el.find("a", class_="btn"):
                break       # "Back to Constitution Main Page"
            if "smaller" in (el.get("class") or []):
                m = re.search(r"Ratified " + MONTH_DATE, text)
                ratified = iso(m.group(1)) if m else None
                continue
            if not text or text.startswith("Note:") or text.startswith("*"):
                continue
            blocks.append(text)
        text = "\n\n".join(blocks)
        found = {c for c in text if c in MARKS}
        if not found <= EXPECTED_MARKS.get(number, set()):
            sys.exit(f"amendment {number}: unexpected annotation marks {sorted(found)}")
        for c in MARKS:
            text = text.replace(c, "")
        if not ratified:
            sys.exit(f"amendment {number}: no ratification line")
        rec = record(CONGRESS, f"Amendment {number}", None, ratified, [text])
        rec["source_url"] = f"{PAGES['amendments']}#{number.lower()}"
        out.append(rec)
    return out


def check(records):
    """Exit unless the parse is whole: every part once, in order, with its known
    words, and each amendment's date matching amendments.json."""
    titles = [r["title"] for r in records]
    want = (["Constitution, Preamble"] + [f"Constitution, Article {n}" for n in ROMAN[:7]]
            + [f"Amendment {n}" for n in ROMAN])
    if titles != want:
        sys.exit(f"parts out of order or missing:\n  got  {titles}\n  want {want}")
    by_title = {r["title"]: r for r in records}
    for title, words in KNOWN.items():
        if words not in by_title[title]["text"]:
            sys.exit(f"{title}: expected words not found: {words!r}")
    for r in records:
        if len(r["text"]) < 100:
            sys.exit(f"{r['title']}: suspiciously short ({len(r['text'])} chars)")

    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "amendments.json"),
              encoding="utf-8") as f:
        dates = {a["number"]: a["date"] for a in json.load(f)["amendments"]}
    for r in records:
        if r["title"].startswith("Amendment "):
            n = r["title"].split()[1]
            if r["date"] != dates.get(n):
                print(f"  note: {r['title']} ratified {r['date']} on the page, "
                      f"{dates.get(n)} in amendments.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    print("National Archives transcriptions")
    records = (parse_constitution(fetch("constitution"))
               + parse_bill_of_rights(fetch("bill_of_rights"))
               + parse_amendments(fetch("amendments")))
    check(records)
    for r in records:
        print(f"  {r['date']}  {r['title']:<26} {len(r['text']):>6,} chars  {r['source_url']}")

    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Re-split two Lincoln books from Project Gutenberg, one record per document.

deepen_lincoln.py split these books on headings it detected, and missed most of
them: its records run from one document into the next, and one credits Stephen
Douglas's half of a debate to Lincoln. build_release.py leaves those records out
(they carry each book's landing-page URL). The records here carry the URL of the
text file they were cut from, and are split on the books' own headings.

  14721  Speeches & Letters of Abraham Lincoln, 1832-1865 (Everyman's Library,
         1907). Split on the italic heading that opens each document; the
         heading's date is the record's date. Two parts are not Lincoln's words
         and are left out: the "Lost Speech" of May 19, 1856, which the book
         prints as H.C. Whitney's reconstruction from memory, and the appendix of
         anecdotes told by others.
  48364  Noted Speeches of Abraham Lincoln, Including the Lincoln-Douglas Debate
         (1911). Split at each speech's capitalized title. The two biographical
         sketches are the editor's and are left out; the Ottawa debate's opening
         speech is credited to Douglas.

Text keeps the books' wording and paragraphs. Line wrapping and the underscores
that mark italics are removed, and so are the editor's headings, which become the
title. An undated document stops the import, so no record gets a guessed date.

Usage (from the repo root):
  python3 scripts/corpus/import_lincoln.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_lincoln.py
"""

import argparse
import calendar
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

LINCOLN, DOUGLAS = "abraham-lincoln", "stephen-douglas"
SOURCE_NAME = "project_gutenberg"


def text_url(n):
    return f"https://www.gutenberg.org/cache/epub/{n}/pg{n}.txt"


# 48364: (heading line, title, date, speaker, type); a None title marks a part
# that is left out but still ends the part before it.
NOTED = [
    ("COOPER INSTITUTE SPEECH", "Cooper Institute Speech", "1860-02-27", LINCOLN, "speech"),
    ("LINCOLN’S FIRST INAUGURAL ADDRESS", "First Inaugural Address", "1861-03-04", LINCOLN,
     "address"),
    ("LINCOLN’S GETTYSBURG SPEECH", "Gettysburg Speech", "1863-11-19", LINCOLN, "speech"),
    ("LINCOLN’S SECOND INAUGURAL ADDRESS", "Second Inaugural Address", "1865-03-04", LINCOLN,
     "address"),
    ("PROCLAMATION OF EMANCIPATION", "Proclamation of Emancipation", "1863-01-01", LINCOLN,
     "proclamation"),
    ("STEPHEN ARNOLD DOUGLAS", None, None, None, None),
    ("_Douglas’s Opening Speech_", "Lincoln-Douglas Debate at Ottawa: Douglas's Opening Speech",
     "1858-08-21", DOUGLAS, "debate"),
    ("LINCOLN-DOUGLAS DEBATE", None, None, None, None),
    ("_Lincoln’s Reply_", "Lincoln-Douglas Debate at Ottawa: Lincoln's Reply", "1858-08-21",
     LINCOLN, "debate"),
]

# 14721: where the documents start and stop, and what is not Lincoln's.
LETTERS_START = "LINCOLN'S SPEECHES AND LETTERS"
LETTERS_END = "Appendix"
# The "Lost Speech" is headed "Mr. Lincoln's Speech. May 19, 1856" in the body.
NOT_LINCOLN = re.compile(r"Lost Speech|May 19, 1856")
# The seven joint debates of 1858; Lincoln's replies there are debate, not speech.
JOINT_DEBATES = ("ottawa", "freeport", "jonesboro", "charleston", "galesburg", "quincy",
                 "alton")

MONTH_NAMES = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTH_NAMES.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})
MONTH_NAMES["sept"] = 9
DATE = re.compile(
    r"(?:(about) )?\b(January|February|March|April|May|June|July|August|September|October|"
    r"November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?,? "
    r"(?:(\d{1,2}),? )?(\d{4})")

_session = None


def fetch(n):
    path = os.path.join(RAW_DIR, f"gutenberg-{n}.txt")
    if not os.path.exists(path):
        global _session
        if _session is None:
            _session = requests.Session()
            _session.headers["User-Agent"] = user_agent()
        time.sleep(1.5)
        print(f"  fetching {text_url(n)}")
        resp = _session.get(text_url(n), timeout=60)
        resp.raise_for_status()
        os.makedirs(RAW_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(resp.content)
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


def paragraphs(lines):
    """Paragraphs from hard-wrapped lines, italics underscores removed."""
    text = "\n".join(lines)
    out = []
    for block in re.split(r"\n\s*\n", text):
        p = " ".join(block.split())
        p = re.sub(r"_([^_]+)_", r"\1", p).replace("_", "")
        if p:
            out.append(p)
    return out


# The editor summarizes, in a bracketed paragraph, what a delegation said before
# Lincoln's reply. Short bracketed lines (a seal mark, an interjection from the
# crowd) are the document's and stay.
EDITOR_NOTE = re.compile(r"^\[[^\]]*\]$")


def date_of(heading):
    """(ISO date, precision) from the last date in a heading. 'About' dates and
    dates without a day are stored as the first of the month."""
    matches = list(DATE.finditer(heading))
    if not matches:
        return None, None
    about, month, day, year = matches[-1].groups()
    m = MONTH_NAMES[month.lower()]
    if day and not about:
        return f"{year}-{m:02d}-{int(day):02d}", "day"
    return f"{year}-{m:02d}-01", "month"


def kind(title):
    t = title.lower()
    if "letter" in t or t.startswith("note to"):
        return "letter"
    if "proclamation" in t:
        return "proclamation"
    if t.startswith(("a fragment", "note for", "notes for")) or "circular" in t:
        return "memo"
    if "debate" in t or "rejoinder" in t or (
            "reply" in t and any(place in t for place in JOINT_DEBATES)):
        return "debate"
    if "message" in t or "address" in t or "inaugural" in t:
        return "address"
    if "remarks" in t or "serenade" in t or "farewell" in t:
        return "remarks"
    return "speech"


def record(n, speaker, date, typ, title, paras):
    text = "\n\n".join(paras)
    return {
        "id": make_id(speaker, text),
        "speaker": speaker,
        "date": date,
        "type": typ,
        "source_url": text_url(n),
        "source_name": SOURCE_NAME,
        "text": text,
        "title": title,
    }


def split_noted(raw):
    lines = raw.split("\n")
    # The book ends with the transcriber's note, then Gutenberg's license.
    end = next(i for i, l in enumerate(lines)
               if l.startswith("Transcriber’s note") or l.startswith("*** END OF THE PROJECT"))
    starts = []
    for heading, *rest in NOTED:
        after = starts[-1][0] + 1 if starts else 0
        i = next((j for j in range(after, end) if lines[j].strip() == heading), None)
        if i is None:
            sys.exit(f"48364: heading not found: {heading!r}")
        starts.append((i, rest))
    out = []
    for k, (i, (title, date, speaker, typ)) in enumerate(starts):
        if title is None:
            continue
        stop = starts[k + 1][0] if k + 1 < len(starts) else end
        body = lines[i + 1:stop]
        # Caption lines under the title ("DELIVERED AT COOPER INSTITUTE ...") are
        # all capitals; the speech starts at the first line that is not.
        while body and not re.search(r"[a-z]", body[0]):
            body.pop(0)
        out.append((record(48364, speaker, date, typ, title, paragraphs(body)), "day"))
    return out


def split_letters(raw):
    lines = raw.split("\n")
    start = next(i for i, l in enumerate(lines) if l.strip() == LETTERS_START)
    end = next(i for i, l in enumerate(lines) if i > start and l.strip() == LETTERS_END)
    # Group lines into blocks, keeping each block's line span.
    blocks, cur = [], []
    for i in range(start + 1, end):
        if lines[i].strip():
            cur.append(i)
        elif cur:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    docs = []
    for b in blocks:
        text = " ".join(lines[i].strip() for i in b)
        # A heading is an italic block with a date. Lincoln's own italic
        # sentences (the Greeley letter has one) carry none and stay in the text.
        if text.startswith("_") and text.endswith("_") and text.count("_") == 2 \
                and DATE.search(text):
            docs.append([text.strip("_ "), []])
        elif docs:
            docs[-1][1].extend(lines[b[0]:b[-1] + 1] + [""])
    out, skipped, undated = [], [], []
    for heading, body in docs:
        title = re.sub(r"\.$", "", " ".join(heading.split()))
        if NOT_LINCOLN.search(title):
            skipped.append(title)
            continue
        date, precision = date_of(title)
        if not date:
            undated.append(title)
            continue
        paras = [p for p in paragraphs(body)
                 if not (EDITOR_NOTE.match(p) and len(p.split()) > 12)]
        out.append((record(14721, LINCOLN, date, kind(title), title, paras), precision))
    if undated:
        sys.exit("14721: undated documents:\n  " + "\n  ".join(undated))
    # Every contents entry (a line at the left margin; wrapped ones continue
    # indented) must have become a document, or a heading was missed and two
    # documents ran together.
    contents = lines[next(i for i, l in enumerate(lines) if l.strip() == "CONTENTS") + 1:]
    entries = 0
    for l in contents:
        if l.strip() == "APPENDIX":
            break
        if l.strip() and not l.startswith(" "):
            entries += 1
    if entries != len(docs):
        sys.exit(f"14721: {len(docs)} documents found, {entries} in the contents")
    return out, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    print("Lincoln, re-split from Project Gutenberg")
    noted = split_noted(fetch(48364))
    letters, skipped = split_letters(fetch(14721))
    pairs = noted + letters
    for r, precision in pairs:
        flag = "  <- day on the 1st" if precision == "day" and r["date"].endswith("-01") else ""
        print(f"  {r['date']} {precision:<5} {r['type']:<12} {len(r['text']):>7,}  {r['title'][:70]}{flag}")
        if len(r["text"]) < 100:
            sys.exit(f"suspiciously short: {r['title']}")
    for t in skipped:
        print(f"  left out: {t}")
    records = [r for r, _ in pairs]
    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

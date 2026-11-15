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

  Shirley Chisholm, remarks on House Joint Resolution 264 (the Equal Rights
  Amendment) on the House floor, August 10, 1970. From the bound Congressional
  Record, vol. 116, part 21, pages 28028 (third column) to 28029 (third column):
  the House proceedings for the day (granule GPO-CRECB-1970-pt21-1-2), PDF pages
  35 and 36. There is no text file for the bound Record, only the scan with
  GPO's OCR layer, and the page is set in three columns that a plain text
  extraction interleaves. So the words are read with their positions
  (`pdftotext -tsv`, from poppler), sorted into the columns listed below, and
  put back into lines. A line whose first word sits right of the column's edge
  opens a paragraph. The remarks run from "Mrs. CHISHOLM." to the line before
  "Mr. MORSE.", the next speaker; the label is dropped. The Record prints no
  heading for them. They close with a quotation from Leo Kanowitz, set in
  smaller type in the print and kept here as her last paragraph.

  Line-end hyphens are rejoined, so a compound broken at its own hyphen loses it;
  each such word is restored in the fixes. The OCR reads the print's em dash as
  two hyphens, which become a dash, or as one, which is a listed fix.

GPO's text is OCR of the printed page. Where it misreads the print, the fix is
listed below, word for word, and each must apply exactly once. Chisholm's fixes
were read off the page images, column by column. Proceedings printed by the GPO
are U.S. government works.

Needs `pdftotext` (poppler) on PATH for the Record scan.

Usage (from the repo root):
  python3 scripts/corpus/import_govinfo.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_govinfo.py
"""

import argparse
import os
import re
import subprocess
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

GOVINFO = "https://www.govinfo.gov/content/pkg/"
DETAILS = "https://www.govinfo.gov/app/details/"

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
    {
        "package": "GPO-CRECB-1970-pt21",
        "granule": "GPO-CRECB-1970-pt21-1-2",
        "speaker": "shirley-chisholm",
        "date": "1970-08-10",
        "type": "floor_speech",
        "title": "Remarks on the Equal Rights Amendment (House of Representatives, "
                 "August 10, 1970)",
        # Where her remarks are printed, in reading order: (PDF page, left edge,
        # right edge), in points. Words above body_top are the running head.
        "columns": [(35, 386, 566), (36, 28, 206), (36, 206, 383), (36, 383, 560)],
        "body_top": 50,
        "label": "Mrs. CHISHOLM. ",
        "next": "Mr. MORSE.",
        "ocr_fixes": [
            # 28028, column 3
            ("under the h . . w for", "under the law for"),
            ("most clear-cu\\. opportunities", "most clear-cut opportunities"),
            ("civil rights bill-as it", "civil rights bill—as it"),
            ("in our laws-to perpetuate", "in our laws—to perpetuate"),
            ("in the fifth a.nd 14th", "in the fifth and 14th"),
            # 28029, column 1
            ("its citizer1s-not relationships", "its citizens—not relationships"),
            ("largely selfexecuting", "largely self-executing"),      # line-end hyphen
            # 28029, column 2
            ("are irrational, a.11.d the proof", "are irrational, and the proof"),
            ("the prescienti:fic beliefs", "the prescientific beliefs"),
            # 28029, column 3
            ("their coverage-for instance", "their coverage—for instance"),
            ("and salary :figures", "and salary figures"),
            ("make one paint.", "make one point."),
            ("has painted out:", "has pointed out:"),
            # The Kanowitz quotation. The print's own "inevitable produce" stays.
            ("that trea:t of the sexes", "that treat of the sexes"),
            ("produce far-reaohing effects", "produce far-reaching effects"),
            ("social, psychologioa.l and", "social, psychological and"),
            ("male-female relaitions beyond the limit.ed confines",
             "male-female relations beyond the limited confines"),
            ("social institutions, contllnue to", "social institutions, continue to"),
            ("and artlficla.Ily created", "and artificially created"),
            ("the llkellhOOd of men", "the likelihood of men"),
            ("When men aind women a.re prevented", "When men and women are prevented"),
            ("prejudices, nourtshed by", "prejudices, nourished by"),
            ("as social 1.nstltutlons, society", "as social institutions, society"),
            ("a whole rema4ns less", "a whole remains less"),
        ],
        "known": "Today, here, we should start to do so.",
    },
]

# A printed page number on a line of its own; OCR reads 111 as "Ill".
PAGE_NUMBER = re.compile(r"^(?:\d{1,4}|[Il1]{3})$")

# How far right of the column's edge a line must start to open a paragraph, and
# how far apart two words' tops can be on one line, in points.
INDENT = 4
SAME_LINE = 3

_session = None


def fetch(name, url):
    path = os.path.join(RAW_DIR, f"govinfo-{name}")
    if not os.path.exists(path):
        global _session
        if _session is None:
            _session = requests.Session()
            _session.headers["User-Agent"] = user_agent()
        time.sleep(1.5)
        print(f"  fetching {url}")
        resp = _session.get(url, timeout=300)
        resp.raise_for_status()
        os.makedirs(RAW_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(resp.content)
    return path


def cut_text(raw, s):
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
    return "\n\n".join(paras)


def page_words(pdf, page):
    """(left, top, text) for every word poppler reads on one PDF page."""
    out = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), "-tsv", pdf, "-"],
                         capture_output=True, text=True, check=True).stdout
    words = []
    for row in out.splitlines()[1:]:
        f = row.split("\t")
        if f[0] == "5" and f[11].strip():
            words.append((float(f[6]), float(f[7]), f[11]))
    return words


def column_lines(words, x0, x1, body_top):
    """The column's lines, top to bottom, each as (opens a paragraph, words)."""
    col = sorted((w for w in words if x0 <= w[0] < x1 and w[1] >= body_top),
                 key=lambda w: (w[1], w[0]))
    lines = []
    for w in col:
        if lines and abs(w[1] - lines[-1][0]) <= SAME_LINE:
            lines[-1][1].append(w)
        else:
            lines.append((w[1], [w]))
    lines = [sorted(ws) for _, ws in lines]
    edge = min(ws[0][0] for ws in lines)
    return [(ws[0][0] > edge + INDENT, " ".join(w[2] for w in ws)) for ws in lines]


def join(para, line):
    if para.endswith("--"):
        return para[:-2] + "—" + line
    if para.endswith("-") and para[-2:-1].isalpha():
        return para[:-1] + line
    return para + " " + line


def cut_pdf(pdf, s):
    lines = []
    pages = {}
    for page, x0, x1 in s["columns"]:
        if page not in pages:
            pages[page] = page_words(pdf, page)
        lines += column_lines(pages[page], x0, x1, s["body_top"])
    start = next(i for i, (_, l) in enumerate(lines) if l.startswith(s["label"]))
    end = next(i for i in range(start, len(lines)) if lines[i][1].startswith(s["next"]))
    paras = []
    for opens, line in lines[start:end]:
        if opens or not paras:
            paras.append(line)
        else:
            paras[-1] = join(paras[-1], line)
    paras[0] = paras[0][len(s["label"]):]
    return "\n\n".join(p.replace("--", "—") for p in paras)


def extract(s):
    if "granule" in s:
        pdf = fetch(f"{s['granule']}.pdf", f"{GOVINFO}{s['package']}/pdf/{s['granule']}.pdf")
        text = cut_pdf(pdf, s)
    else:
        path = fetch(f"{s['package']}.txt", f"{GOVINFO}{s['package']}/text/{s['package']}.txt")
        with open(path, encoding="utf-8") as f:
            text = cut_text(f.read(), s)
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
    ap.add_argument("--show", metavar="SPEAKER", help="print one speaker's text (with --dry-run)")
    args = ap.parse_args()

    print("GovInfo prints")
    records = []
    for s in STATEMENTS:
        text = extract(s)
        details = f"{DETAILS}{s['package']}" + (f"/{s['granule']}" if "granule" in s else "")
        records.append({
            "id": make_id(s["speaker"], text),
            "speaker": s["speaker"],
            "date": s["date"],
            "type": s["type"],
            "source_url": details,
            "source_name": "govinfo",
            "text": text,
            "title": s["title"],
        })
        print(f"  {s['date']}  {s['title']}  {len(text):,} chars")
        if args.show == s["speaker"]:
            print("\n" + text + "\n")
    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

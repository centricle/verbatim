#!/usr/bin/env python3
"""Import Supreme Court opinions of the Court, one record each, credited to the
justice the opinion's own first line names.

Two groups. The first is Brown v. Board of Education plus the ten decisions the
Constitution Annotated's table of overruled decisions pairs with opinions already
in the corpus (Bob Jones, not Brown, is the case that table says overruled
Plessy). The second replaces corpus records that hold a syllabus, a header or
part of an opinion instead of the opinion itself; build_release.py leaves those
out by URL.

Sources: Cornell LII for all but one, by U.S. Reports volume and page, or by
docket number for the two decisions too recent for the U.S. Reports pages
Cornell carries. Gregg v. Georgia comes from Wikisource, because Cornell's page
for it is empty. Opinions of the Court are U.S. government works.

A record is the opinion of the Court alone, from its opening line ("Mr. Justice
CLARK delivered the opinion of the Court", "PER CURIAM") to the line that opens
the first separate writing ("Mr. Justice HARLAN, dissenting"). Concurrences and
dissents are other justices' words and are not part of it. Footnotes, footnote
markers, the paragraph numbers Cornell's older pages carry, and the caption and
counsel blocks are dropped. Section headings stay.

Every page is checked before anything is written: the opening line must name the
expected author, the text must reach a minimum length and contain a phrase known
to be in the opinion, and the decision date on the page must match the date
here. A page that answers 200 with a stub fails, rather than becoming a record.

Usage (from the repo root):
  python3 scripts/corpus/import_opinions.py --dry-run   # parse and check, write nothing
  python3 scripts/corpus/import_opinions.py
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest import RAW_DIR, bulk_insert, make_id, user_agent  # noqa: E402

CORNELL = "https://www.law.cornell.edu/supremecourt/text/"
WIKISOURCE_API = "https://en.wikisource.org/w/api.php"
WIKISOURCE = "https://en.wikisource.org/wiki/"

# (title, date, speaker, author as the opening line prints it, source, known phrase)
# source is a Cornell path (volume/page, volume/page/version, or docket number)
# or "wikisource:<page title>". The author is matched case-insensitively against
# the opening line; PER CURIAM opinions and the joint Casey opinion are credited
# to the Court.
CASES = [
    # Brown, and the decisions paired with corpus opinions by the overruled table
    ("Brown v. Board of Education (347 U.S. 483)", "1954-05-17", "earl-warren", "WARREN",
     "347/483/USSC_PRO_347_483_1", "Separate educational facilities are inherently unequal"),
    ("Dobbs v. Jackson Women's Health Organization (597 U.S. 215)", "2022-06-24",
     "samuel-alito", "Alito", "19-1392", "Roe and Casey must be overruled"),
    ("Planned Parenthood of Southeastern Pennsylvania v. Casey (505 U.S. 833)", "1992-06-29",
     "supreme-court", "O'CONNOR, Justice KENNEDY, and Justice SOUTER", "505/833",
     "Liberty finds no refuge in a jurisprudence of doubt"),
    ("Trump v. Hawaii (585 U.S. 667)", "2018-06-26", "john-roberts", "Roberts", "17-965",
     "Korematsu was gravely wrong the day it was decided"),
    ("Bob Jones University v. United States (461 U.S. 574)", "1983-05-24", "warren-burger",
     "BURGER", "461/574", "We granted certiorari to decide whether petitioners"),
    ("Whitney v. California (274 U.S. 357)", "1927-05-16", "edward-sanford", "SANFORD",
     "274/357", "Criminal Syndicalism Act"),
    ("Betts v. Brady (316 U.S. 455)", "1942-06-01", "owen-roberts", "ROBERTS",
     "316/455", "totality of facts"),
    ("Wolf v. Colorado (338 U.S. 25)", "1949-06-27", "felix-frankfurter", "FRANKFURTER",
     "338/25", "The security of one's privacy against arbitrary intrusion by the police"),
    ("Crooker v. California (357 U.S. 433)", "1958-06-30", "tom-clark", "CLARK",
     "357/433", "confession"),
    ("Cicenia v. Lagay (357 U.S. 504)", "1958-06-30", "john-marshall-harlan-ii", "HARLAN",
     "357/504", "confession"),
    ("McGautha v. California (402 U.S. 183)", "1971-05-03", "john-marshall-harlan-ii",
     "HARLAN", "402/183", "death penalty"),
    # Re-imports of records that are not the opinion
    ("Heart of Atlanta Motel v. United States (379 U.S. 241)", "1964-12-14", "tom-clark",
     "CLARK", "379/241", "Civil Rights Act of 1964"),
    ("Engel v. Vitale (370 U.S. 421)", "1962-06-25", "hugo-black", "BLACK", "370/421",
     "no part of the business of government to compose official prayers"),
    ("Mapp v. Ohio (367 U.S. 643)", "1961-06-19", "tom-clark", "CLARK", "367/643",
     "inadmissible in a state court"),
    ("Brandenburg v. Ohio (395 U.S. 444)", "1969-06-09", "supreme-court", "PER CURIAM",
     "395/444", "imminent lawless action"),
    ("Gideon v. Wainwright (372 U.S. 335)", "1963-03-18", "hugo-black", "BLACK", "372/335",
     "lawyers in criminal courts are necessities, not luxuries"),
    ("Tinker v. Des Moines (393 U.S. 503)", "1969-02-24", "abe-fortas", "FORTAS", "393/503",
     "at the schoolhouse gate"),
    ("Furman v. Georgia (408 U.S. 238)", "1972-06-29", "supreme-court", "PER CURIAM",
     "408/238", "cruel and unusual punishment"),
    ("Schenck v. United States (249 U.S. 47)", "1919-03-03", "oliver-wendell-holmes",
     "HOLMES", "249/47", "falsely shouting fire in a theatre"),
    ("Gregg v. Georgia (428 U.S. 153)", "1976-07-02", "potter-stewart", "Stewart",
     "wikisource:Gregg v. Georgia/Opinion of the Court",
     "the punishment of death does not invariably violate the Constitution"),
    ("Miranda v. Arizona (384 U.S. 436)", "1966-06-13", "earl-warren", "WARREN", "384/436",
     "right to remain silent"),
]

MIN_CHARS = 400     # Furman's per curiam is the shortest, at about 600

# The opening line of the opinion of the Court, at the start of a paragraph.
MAJORITY = re.compile(
    r"^(?:(?:MR\.|Mr\.)\s*)?(?:(?:CHIEF|Chief)\s+)?(?:JUSTICE|Justice)\b.{0,160}?"
    r"(?:delivered the opinion of the [Cc]ourt|announced the judgment of the Court)"
    r"|^PER CURIAM|^Per Curiam|^Judgment of the Court, and opinion of")

# The syllabus summarizes the opinion in a line that opens the same way; this is
# how it goes on.
SYLLABUS = "concluding that"

# The opening line of a separate writing: at the start of a paragraph, or after a
# sentence that ends the opinion before it in the same paragraph ("Affirmed.
# Justice POWELL, concurring in part"), which is how some older pages run them.
# Three forms: "Mr. Justice HARLAN, dissenting" (or "(concurring)"), "Separate
# opinion of Mr. Justice BLACK", and a paragraph that is only "Mr. Justice
# DOUGLAS." The lookbehinds stop a citation inside a sentence ("As Mr. Justice
# Brandeis, dissenting, said") from matching after the period of "Mr.".
SEPARATE = re.compile(
    r"(?:^|(?<=[.:] ))(?<!Mr\. )(?<!MR\. )(?<!Chief )(?<!CHIEF )"
    r"(?:(?:(?:MR\.|Mr\.)\s*)?(?:THE\s+)?(?:(?:CHIEF|Chief)\s+)?(?:JUSTICE|Justice)\s+"
    r"[A-Z][A-Za-z'’-]+.{0,300}?[,(]\s*(?:concurring|dissenting)\b"
    r"|Separate opinion of (?:MR\.|Mr\.)\s*(?:JUSTICE|Justice)\s+[A-Z]"
    r"|(?:MR\.|Mr\.)\s*(?:(?:CHIEF|Chief)\s+)?(?:JUSTICE|Justice)\s+[A-Z][A-Za-z'’-]+\.?$)")

# The caption footnote naming the cases decided with this one, which older pages
# print as the last paragraph, and the heading left over once footnotes are gone.
CAPTION_NOTE = re.compile(r"^\*+ ?Together with|^Footnotes:?$")

# Cornell's newer pages (docket-number URLs) put the opinion of the Court in its
# own container, mark each writing's opening line with a class and the text with
# a few others; the rest is caption and furniture.
DOCKET_OPINION = "div.opinion"
DOCKET_OPENER = "casct-a"
DOCKET_TEXT = {"casct", "casct-d", "casct-a", "bqonly1para"}
DOCKET_NOT_HEADING = {"fnheader", "sylct-b"}

MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
DECIDED = re.compile(r"(?:Decided|\[)\s*(" + MONTHS + r"\.? \d{1,2},? \d{4})")

_session = None


def get(url, params=None):
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = user_agent()
    time.sleep(1.5)
    print(f"  fetching {url}")
    resp = _session.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp


def cached(name, fetcher):
    """Bytes from RAW_DIR/name, fetching and caching them on a miss."""
    path = os.path.join(RAW_DIR, name)
    if not os.path.exists(path):
        body = fetcher()
        os.makedirs(RAW_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
    with open(path, encoding="utf-8") as f:
        return f.read()


def clean(text):
    lines = (" ".join(line.split()) for line in text.replace("\xa0", " ").split("\n"))
    return "\n".join(line for line in lines if line)


def iso(text):
    return datetime.strptime(text.replace(".", "").replace(",", ""), "%B %d %Y").date().isoformat()


# ---------------------------------------------------------------------------
# Cornell LII
# ---------------------------------------------------------------------------

def cornell_blocks(html):
    """(paragraphs, docket_style, decided) for a Cornell opinion page."""
    soup = BeautifulSoup(html, "html.parser")
    pane = soup.select_one("#tab_default_1")
    if pane is None:
        return [], False, None
    m = DECIDED.search(" ".join(pane.get_text(" ").split()))
    decided = iso(m.group(1)) if m else None
    for junk in pane.select("div.footnotes, p.footnote, a.footnote, a.footref, "
                            "span.num, #footer"):
        junk.decompose()
    for br in pane.find_all("br"):
        br.replace_with("\n")
    docket = bool(pane.select("p." + DOCKET_OPENER))
    scope = pane.select_one(DOCKET_OPINION) if docket else pane
    blocks = []
    for el in scope.find_all(["p", "h2", "h3", "h4"]):
        if el.find_parent("p"):
            continue
        classes = set(el.get("class") or [])
        if docket and el.name == "p" and not classes & DOCKET_TEXT:
            continue
        if docket and el.name != "p" and classes & DOCKET_NOT_HEADING:
            continue
        text = clean(el.get_text())
        if text and not CAPTION_NOTE.match(text):
            blocks.append((text, DOCKET_OPENER in classes))
    return blocks, docket, decided


def majority(blocks, docket):
    """The opinion of the Court, as a list of paragraphs, opening line first."""
    start = next((i for i, (t, opener) in enumerate(blocks)
                  if (opener or not docket) and MAJORITY.search(t) and SYLLABUS not in t),
                 None)
    if start is None:
        return []
    out = [blocks[start][0]]
    for text, opener in blocks[start + 1:]:
        if docket:
            if opener:
                break
        else:
            m = SEPARATE.search(text)
            if m:
                head = text[:m.start()].strip()
                if head:
                    out.append(head)
                break
        out.append(text)
    return out


def from_cornell(path):
    key = path.replace("/", "-")
    html = cached(f"cornell-{key}.html", lambda: get(CORNELL + path).content)
    blocks, docket, decided = cornell_blocks(html)
    return majority(blocks, docket), decided, CORNELL + path, "cornell_lii"


# ---------------------------------------------------------------------------
# Wikisource
# ---------------------------------------------------------------------------

def wikitext_to_text(w):
    """Plain text from a Wikisource opinion's wikitext: page anchors, footnote
    references, templates and markup removed, links reduced to their labels."""
    w = re.sub(r"<ref[^>]*/>", "", w)
    w = re.sub(r"<ref[^>]*>.*?</ref>", "", w, flags=re.DOTALL)
    w = re.sub(r"'''\[p\. \d+\]'''\s*", "", w)
    w = re.sub(r"\{\{[^{}]*\}\}", "", w)
    w = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", w)
    w = re.sub(r"\[\[([^\]]*)\]\]", r"\1", w)
    w = re.sub(r"'{2,}", "", w)
    w = re.sub(r"<[^>]+>", "", w)
    w = re.sub(r"^=+\s*(.*?)\s*=+\s*$", r"\1", w, flags=re.MULTILINE)
    return [clean(p) for p in re.split(r"\n\s*\n", w) if clean(p)]


def from_wikisource(page):
    name = "wikisource-" + re.sub(r"[^A-Za-z0-9]+", "-", page).strip("-").lower() + ".json"

    def fetch():
        return get(WIKISOURCE_API, {"action": "parse", "page": page, "prop": "wikitext",
                                    "format": "json", "formatversion": "2"}).content
    data = json.loads(cached(name, fetch))
    if "parse" not in data:
        # The API answers a throttle or a missing page with an error object, not
        # an HTTP error; say which instead of reporting an empty page.
        sys.exit(f"wikisource {page}: {data.get('error', data)}")
    w = data["parse"]["wikitext"]
    body = w.split("<div class='courtopinion'>", 1)[-1]
    body = re.split(r"^=+\s*Notes\s*=+\s*$", body, maxsplit=1, flags=re.MULTILINE)[0]
    paragraphs = wikitext_to_text(body)
    start = next((i for i, p in enumerate(paragraphs) if MAJORITY.search(p)), None)
    paragraphs = paragraphs[start:] if start is not None else []
    return paragraphs, None, WIKISOURCE + page.replace(" ", "_"), "wikisource"


# ---------------------------------------------------------------------------

def build():
    records, failures = [], []
    for title, date, speaker, author, source, phrase in CASES:
        if source.startswith("wikisource:"):
            paragraphs, decided, url, source_name = from_wikisource(source.split(":", 1)[1])
        else:
            paragraphs, decided, url, source_name = from_cornell(source)
        text = "\n\n".join(paragraphs)
        problems = []
        if not paragraphs:
            problems.append("no opening line found")
        elif author.lower() not in paragraphs[0].lower():
            problems.append(f"opening line does not name {author!r}: {paragraphs[0][:120]!r}")
        if len(text) < MIN_CHARS:
            problems.append(f"only {len(text)} chars")
        if phrase.lower() not in " ".join(text.split()).lower():
            problems.append(f"known phrase missing: {phrase!r}")
        if decided and decided != date:
            problems.append(f"page says decided {decided}, expected {date}")
        if problems:
            failures.append((title, problems))
            continue
        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": "opinion",
            "source_url": url,
            "source_name": source_name,
            "text": text,
            "title": title,
        })
        print(f"  {date}  {title[:58]:<58} {speaker:<24} {len(text):>8,}"
              f"{'' if decided else '  (no date on page)'}")
    return records, failures


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="parse and check, write nothing")
    args = ap.parse_args()

    print("Supreme Court opinions")
    records, failures = build()
    if failures:
        for title, problems in failures:
            print(f"FAIL {title}")
            for p in problems:
                print(f"     {p}")
        sys.exit(f"\n{len(failures)} of {len(CASES)} failed; nothing written")
    if args.dry_run:
        print(f"\n{len(records)} records parsed (dry run, nothing written)")
        return
    inserted = bulk_insert(records)
    print(f"\n{len(records)} records parsed, {inserted} sent to corpus.db")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Import Susan B. Anthony and Elizabeth Cady Stanton into the verbatim corpus.

Sources:
- Project Gutenberg: "An Account of the Proceedings on the Trial of Susan B.
  Anthony" (18281), "Eighty Years and More" by Stanton (11982),
  "The Woman's Bible" by Stanton (9880)
- WikiSource: Declaration of Sentiments, key speeches and addresses

All works are public domain (Anthony died 1906, Stanton died 1902).
"""

import os
import re
import sys
import time

import requests

from ingest import bulk_insert, make_id

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "verbatim-corpus/0.1 (https://verbatim.fyi; ksmith@centricle.com)"
})

TMP_DIR = os.path.join(os.path.dirname(__file__), "tmp")


def read_local_or_fetch(filename, url):
    """Read from local tmp/ cache, or fetch from URL if not cached."""
    local_path = os.path.join(TMP_DIR, filename)
    if os.path.exists(local_path):
        print(f"  Reading from local cache: tmp/{filename}")
        with open(local_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    print(f"  Fetching from {url}...")
    resp = SESSION.get(url, timeout=60)
    resp.raise_for_status()
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(resp.text)
    return resp.text


def strip_gutenberg(raw):
    """Strip Project Gutenberg header and footer from text."""
    raw = raw.replace('\r\n', '\n')
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


def strip_wikitext(text):
    """Remove wiki markup from text."""
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    text = re.sub(r'\[\[Category:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[^|\]]*\|([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]]*)\]\]', r'\1', text)
    text = re.sub(r"'{2,3}", '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.DOTALL)
    text = re.sub(r'<ref[^/]*/>', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'={2,}.*?={2,}', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def fetch_wikisource_page(page_title):
    """Fetch and clean text from a WikiSource page."""
    url = "https://en.wikisource.org/w/api.php"
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json"
    }
    resp = SESSION.get(url, params=params, timeout=30)
    data = resp.json()
    if "error" in data:
        print(f"  WikiSource error for {page_title}: {data['error'].get('info', 'unknown')}")
        return None
    wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
    if not wikitext or len(wikitext) < 100:
        return None
    return strip_wikitext(wikitext)


# === SUSAN B. ANTHONY ===

ANTHONY_SPEAKER = "susan-b-anthony"

# Most Anthony speeches are not on WikiSource. The trial transcript is on Gutenberg.
ANTHONY_WIKISOURCE = []


def import_anthony_wikisource():
    """Import Anthony speeches from WikiSource."""
    print("Importing Susan B. Anthony from WikiSource...")
    records = []
    for page_title, date, rec_type, title in ANTHONY_WIKISOURCE:
        print(f"  Fetching: {title}")
        text = fetch_wikisource_page(page_title)
        if not text:
            print(f"    SKIP — no content")
            continue
        if len(text) < 200:
            print(f"    SKIP — too short ({len(text)} chars)")
            continue
        records.append({
            "id": make_id(ANTHONY_SPEAKER, text),
            "speaker": ANTHONY_SPEAKER,
            "date": date,
            "type": rec_type,
            "source_url": f"https://en.wikisource.org/wiki/{page_title}",
            "source_name": "wikisource",
            "text": text,
            "title": title,
        })
        print(f"    OK ({len(text)} chars)")
        time.sleep(1)
    return records


def import_anthony_trial():
    """Import 'An Account of the Proceedings on the Trial of Susan B. Anthony'
    (Gutenberg 18281)."""
    print("Importing Trial of Susan B. Anthony (Gutenberg 18281)...")
    raw = read_local_or_fetch("anthony_18281.txt",
                              "https://www.gutenberg.org/cache/epub/18281/pg18281.txt")
    content = strip_gutenberg(raw)

    records = []
    if len(content) > 300:
        records.append({
            "id": make_id(ANTHONY_SPEAKER, content),
            "speaker": ANTHONY_SPEAKER,
            "date": "1873-06-17",
            "type": "statement",
            "source_url": "https://www.gutenberg.org/ebooks/18281",
            "source_name": "project_gutenberg",
            "text": content,
            "title": "An Account of the Proceedings on the Trial of Susan B. Anthony",
        })
        print(f"    OK — {len(content)} chars")
    return records


# === ELIZABETH CADY STANTON ===

STANTON_SPEAKER = "elizabeth-cady-stanton"

STANTON_WIKISOURCE = [
    ("Declaration_of_Sentiments", "1848-07-20", "founding_document",
     "Declaration of Sentiments"),
    ("Solitude_of_Self", "1892-01-18", "speech",
     "The Solitude of Self"),
]


def import_stanton_wikisource():
    """Import Stanton speeches from WikiSource."""
    print("Importing Elizabeth Cady Stanton from WikiSource...")
    records = []
    for page_title, date, rec_type, title in STANTON_WIKISOURCE:
        print(f"  Fetching: {title}")
        text = fetch_wikisource_page(page_title)
        if not text:
            print(f"    SKIP — no content")
            continue
        if len(text) < 200:
            print(f"    SKIP — too short ({len(text)} chars)")
            continue
        records.append({
            "id": make_id(STANTON_SPEAKER, text),
            "speaker": STANTON_SPEAKER,
            "date": date,
            "type": rec_type,
            "source_url": f"https://en.wikisource.org/wiki/{page_title}",
            "source_name": "wikisource",
            "text": text,
            "title": title,
        })
        print(f"    OK ({len(text)} chars)")
        time.sleep(1)
    return records


def import_eighty_years():
    """Import 'Eighty Years and More' by Elizabeth Cady Stanton (Gutenberg 11982).
    Split by chapter."""
    print("Importing Eighty Years and More (Gutenberg 11982)...")
    raw = read_local_or_fetch("stanton_11982.txt",
                              "https://www.gutenberg.org/cache/epub/11982/pg11982.txt")
    content = strip_gutenberg(raw)

    # Split by "CHAPTER" headers
    chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+\.?\s*\n)', content)

    records = []
    for part in chapters:
        match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
        if match:
            text = part.strip()
            if len(text) > 500:
                records.append({
                    "id": make_id(STANTON_SPEAKER, text),
                    "speaker": STANTON_SPEAKER,
                    "date": "1898-01-01",
                    "type": "essay",
                    "source_url": "https://www.gutenberg.org/ebooks/11982",
                    "source_name": "project_gutenberg",
                    "text": text,
                    "title": f"Eighty Years and More, Chapter {match.group(1)}",
                })
                print(f"    Chapter {match.group(1)} — {len(text)} chars")
    return records


def import_womans_bible():
    """Import 'The Woman's Bible' by Elizabeth Cady Stanton (Gutenberg 9880).
    Split by part/chapter."""
    print("Importing The Woman's Bible (Gutenberg 9880)...")
    raw = read_local_or_fetch("stanton_9880.txt",
                              "https://www.gutenberg.org/cache/epub/9880/pg9880.txt")
    content = strip_gutenberg(raw)

    # Split by "CHAPTER" or major section headers
    chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content, flags=re.IGNORECASE)

    records = []
    chapter_num = 0
    for part in chapters:
        match = re.match(r'CHAPTER ([IVXLC]+)', part.strip(), re.IGNORECASE)
        if match:
            chapter_num += 1
            text = part.strip()
            if len(text) > 500:
                records.append({
                    "id": make_id(STANTON_SPEAKER, text),
                    "speaker": STANTON_SPEAKER,
                    "date": "1895-01-01",
                    "type": "essay",
                    "source_url": "https://www.gutenberg.org/ebooks/9880",
                    "source_name": "project_gutenberg",
                    "text": text,
                    "title": f"The Woman's Bible, Chapter {match.group(1)}",
                })
                print(f"    Chapter {match.group(1)} — {len(text)} chars")
    return records


def main():
    all_records = []

    # Anthony
    all_records.extend(import_anthony_wikisource())
    all_records.extend(import_anthony_trial())

    # Stanton
    all_records.extend(import_stanton_wikisource())
    all_records.extend(import_eighty_years())
    all_records.extend(import_womans_bible())

    # Dedup by id
    seen = set()
    unique = []
    for r in all_records:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    all_records = unique

    print(f"\n=== TOTAL: {len(all_records)} unique records ===")
    anthony = [r for r in all_records if r["speaker"] == ANTHONY_SPEAKER]
    stanton = [r for r in all_records if r["speaker"] == STANTON_SPEAKER]
    print(f"  Susan B. Anthony: {len(anthony)}")
    print(f"  Elizabeth Cady Stanton: {len(stanton)}")

    if all_records:
        inserted = bulk_insert(all_records)
        print(f"Inserted {inserted} records into corpus.db")


if __name__ == "__main__":
    main()

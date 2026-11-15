#!/usr/bin/env python3
"""Import Benjamin Franklin writings into the verbatim corpus.

Sources:
- Project Gutenberg: Autobiography (148), Poor Richard's Almanack (43855)
- WikiSource: Key speeches, letters, essays

All works are public domain (Franklin died 1790).
"""

import os
import re
import sys
import time

import requests

from ingest import bulk_insert, make_id, user_agent, RAW_DIR

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": user_agent()
})

SPEAKER = "benjamin-franklin"
TMP_DIR = RAW_DIR


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
    if not wikitext or len(wikitext) < 200:
        return None
    return strip_wikitext(wikitext)


# WikiSource essays and speeches
WIKISOURCE_WORKS = [
    ("An_Edict_by_the_King_of_Prussia", "1773-09-22", "essay",
     "An Edict by the King of Prussia"),
    ("An_Address_to_the_Public", "1789-11-09", "address",
     "An Address to the Public (Pennsylvania Society for Promoting the Abolition of Slavery)"),
]

# Silence Dogood letters (14 total, published 1722 in the New-England Courant)
SILENCE_DOGOOD = [
    (i, f"1722-{3 + (i-1)//2:02d}-{1 + ((i-1) % 2) * 14:02d}")
    for i in range(1, 15)
]


def import_wikisource():
    """Import essays and speeches from WikiSource."""
    print("Importing from WikiSource...")
    records = []
    for page_title, date, rec_type, title in WIKISOURCE_WORKS:
        print(f"  Fetching: {title}")
        text = fetch_wikisource_page(page_title)
        if not text:
            print(f"    SKIP — no content")
            continue
        if len(text) < 200:
            print(f"    SKIP — too short ({len(text)} chars)")
            continue
        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
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


def import_silence_dogood():
    """Import the 14 Silence Dogood letters from WikiSource."""
    print("Importing Silence Dogood Letters (WikiSource)...")
    records = []
    for num, date in SILENCE_DOGOOD:
        page = f"Silence_Dogood,_No._{num}"
        print(f"  Fetching: Silence Dogood No. {num}")
        text = fetch_wikisource_page(page)
        if not text or len(text) < 200:
            print(f"    SKIP")
            continue
        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
            "date": date,
            "type": "letter",
            "source_url": f"https://en.wikisource.org/wiki/{page}",
            "source_name": "wikisource",
            "text": text,
            "title": f"Silence Dogood, No. {num}",
        })
        print(f"    OK ({len(text)} chars)")
        time.sleep(0.5)
    return records


def import_autobiography():
    """Import 'Autobiography of Benjamin Franklin' (Gutenberg 148).
    The autobiography is a continuous narrative without chapter divisions."""
    print("Importing Autobiography (Gutenberg 148)...")
    raw = read_local_or_fetch("franklin_148.txt",
                              "https://www.gutenberg.org/cache/epub/148/pg148.txt")
    content = strip_gutenberg(raw)

    records = []
    if len(content) > 500:
        records.append({
            "id": make_id(SPEAKER, content),
            "speaker": SPEAKER,
            "date": "1791-01-01",
            "type": "essay",
            "source_url": "https://www.gutenberg.org/ebooks/148",
            "source_name": "project_gutenberg",
            "text": content,
            "title": "Autobiography of Benjamin Franklin",
        })
        print(f"    OK — {len(content)} chars")
    return records


def import_poor_richard():
    """Import 'Franklin's Way to Wealth; or, Poor Richard Improved' (Gutenberg 43855)."""
    print("Importing Poor Richard / Way to Wealth (Gutenberg 43855)...")
    raw = read_local_or_fetch("franklin_43855.txt",
                              "https://www.gutenberg.org/cache/epub/43855/pg43855.txt")
    content = strip_gutenberg(raw)

    records = []
    if len(content) > 300:
        records.append({
            "id": make_id(SPEAKER, content),
            "speaker": SPEAKER,
            "date": "1758-01-01",
            "type": "essay",
            "source_url": "https://www.gutenberg.org/ebooks/43855",
            "source_name": "project_gutenberg",
            "text": content,
            "title": "Poor Richard Improved (The Way to Wealth)",
        })
        print(f"    OK — {len(content)} chars")
    return records


def main():
    all_records = []

    ws_records = import_wikisource()
    all_records.extend(ws_records)

    sd_records = import_silence_dogood()
    all_records.extend(sd_records)

    auto_records = import_autobiography()
    all_records.extend(auto_records)

    pr_records = import_poor_richard()
    all_records.extend(pr_records)

    # Dedup by id
    seen = set()
    unique = []
    for r in all_records:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    all_records = unique

    print(f"\n=== TOTAL: {len(all_records)} unique Franklin records ===")

    if all_records:
        inserted = bulk_insert(all_records)
        print(f"Inserted {inserted} records into corpus.db")


if __name__ == "__main__":
    main()

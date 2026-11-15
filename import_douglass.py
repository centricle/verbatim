#!/usr/bin/env python3
"""Import Frederick Douglass speeches, essays, and addresses into the verbatim corpus.

Sources:
- Project Gutenberg: "Narrative of the Life of Frederick Douglass" (23),
  "My Bondage and My Freedom" (202), "Collected Articles" (99),
  "Life and Times" (71893), individual speeches (34915, 31839, 59116, 67919, 6545)
- WikiSource: "What to the Slave is the Fourth of July?", other speeches

All works are public domain (Douglass died 1895).
"""

import os
import re
import sys
import time

import requests

from ingest import bulk_insert, make_id, user_agent

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": user_agent()
})

SPEAKER = "frederick-douglass"
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
    if not wikitext or len(wikitext) < 200:
        return None
    return strip_wikitext(wikitext)


# WikiSource speeches — most Douglass pages are PDF scans, not transcribed text.
# Only include pages with actual wikitext content (not <pages index="...pdf"> format).
WIKISOURCE_SPEECHES = []


def import_wikisource():
    """Import speeches from WikiSource."""
    print("Importing from WikiSource...")
    records = []
    for page_title, date, rec_type, title in WIKISOURCE_SPEECHES:
        print(f"  Fetching: {title}")
        text = fetch_wikisource_page(page_title)
        if not text:
            print(f"    SKIP — no content")
            continue
        if len(text) < 300:
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


def import_standalone_speeches():
    """Import individual Gutenberg speech texts."""
    print("Importing standalone Gutenberg speeches...")

    speeches = [
        (34915, "1847-05-11", "speech",
         "Abolition Fanaticism in New York"),
        (31839, "1881-05-30", "address",
         "John Brown: An Address at the 14th Anniversary of Storer College"),
        (59116, "1894-01-01", "essay",
         "Why is the Negro Lynched?"),
        (6545, "1866-01-01", "speech",
         "Reconstruction"),
    ]

    records = []
    for guten_id, date, rec_type, title in speeches:
        print(f"  Fetching Gutenberg {guten_id}: {title}")
        url = f"https://www.gutenberg.org/cache/epub/{guten_id}/pg{guten_id}.txt"
        try:
            raw = read_local_or_fetch(f"douglass_{guten_id}.txt", url)
            text = strip_gutenberg(raw)
            if len(text) < 200:
                print(f"    SKIP — too short ({len(text)} chars)")
                continue
            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": date,
                "type": rec_type,
                "source_url": f"https://www.gutenberg.org/ebooks/{guten_id}",
                "source_name": "project_gutenberg",
                "text": text,
                "title": title,
            })
            print(f"    OK ({len(text)} chars)")
        except Exception as e:
            print(f"    ERROR: {e}")
        time.sleep(1)
    return records


def import_three_addresses():
    """Import from 'Three Addresses on the Relations Subsisting Between the
    White and Colored People of the United States' (Gutenberg 67919).
    Split into individual addresses."""
    print("Importing Three Addresses (Gutenberg 67919)...")
    raw = read_local_or_fetch("douglass_67919.txt",
                              "https://www.gutenberg.org/cache/epub/67919/pg67919.txt")
    content = strip_gutenberg(raw)

    # Split by address headers — look for large roman numeral or title patterns
    records = []

    # The book has three distinct addresses — find them by looking for headers
    parts = re.split(r'\n{2,}(?=(?:I\.|II\.|III\.)\s)', content)
    if len(parts) < 3:
        # Try splitting on ALL-CAPS headers
        parts = re.split(r'\n{2,}(?=[A-Z][A-Z\s,]{10,}\n)', content)

    if len(parts) >= 3:
        titles = [
            ("The Color Question", "1875-07-04"),
            ("The Negro Exodus from the Gulf States", "1879-09-12"),
            ("The Relations of the White and Colored People", "1886-01-01"),
        ]
        for i, (title, date) in enumerate(titles):
            if i < len(parts):
                text = parts[i].strip()
                if len(text) > 300:
                    records.append({
                        "id": make_id(SPEAKER, text),
                        "speaker": SPEAKER,
                        "date": date,
                        "type": "address",
                        "source_url": "https://www.gutenberg.org/ebooks/67919",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": title,
                    })
                    print(f"    {title} — {len(text)} chars")
    else:
        # If splitting fails, import as one record
        if len(content) > 300:
            records.append({
                "id": make_id(SPEAKER, content),
                "speaker": SPEAKER,
                "date": "1875-01-01",
                "type": "address",
                "source_url": "https://www.gutenberg.org/ebooks/67919",
                "source_name": "project_gutenberg",
                "text": content,
                "title": "Three Addresses on the Relations Between the White and Colored People",
            })
            print(f"    Single record — {len(content)} chars")
    return records


def import_collected_articles():
    """Import from 'Collected Articles of Frederick Douglass' (Gutenberg 99).
    Contains two articles: 'My Escape from Slavery' and 'Reconstruction'."""
    print("Importing Collected Articles (Gutenberg 99)...")
    raw = read_local_or_fetch("douglass_99.txt",
                              "https://www.gutenberg.org/cache/epub/99/pg99.txt")
    content = strip_gutenberg(raw)

    records = []
    articles = [
        ("My Escape from Slavery", "1881-11-01"),
        ("Reconstruction", "1866-01-01"),
    ]

    for title, date in articles:
        pos = content.find(title)
        if pos == -1:
            continue
        # Find the next article or end
        next_pos = len(content)
        for other_title, _ in articles:
            if other_title != title:
                np = content.find(other_title, pos + len(title) + 10)
                if np != -1 and np < next_pos:
                    next_pos = np

        # Find start of actual text (skip citation line)
        text_start = content.find('\n\n', pos)
        if text_start == -1:
            continue
        text = content[text_start:next_pos].strip()

        if len(text) > 300:
            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": date,
                "type": "essay",
                "source_url": "https://www.gutenberg.org/ebooks/99",
                "source_name": "project_gutenberg",
                "text": text,
                "title": title,
            })
            print(f"    {title} — {len(text)} chars")
    return records


def import_narrative():
    """Import 'Narrative of the Life of Frederick Douglass' (Gutenberg 23).
    Split by chapter — each chapter is a distinct narrative unit."""
    print("Importing Narrative of the Life (Gutenberg 23)...")
    raw = read_local_or_fetch("douglass_23.txt",
                              "https://www.gutenberg.org/cache/epub/23/pg23.txt")
    content = strip_gutenberg(raw)

    # Split by "CHAPTER" headers (may have leading spaces)
    chapters = re.split(r'\n{2,}(?=\s*CHAPTER [IVXLC]+)', content)

    records = []
    # Skip prefaces, appendix etc. — just get chapters
    chapter_num = 0
    for part in chapters:
        match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
        if match:
            chapter_num += 1
            text = part.strip()
            if len(text) > 300:
                records.append({
                    "id": make_id(SPEAKER, text),
                    "speaker": SPEAKER,
                    "date": "1845-01-01",
                    "type": "essay",
                    "source_url": "https://www.gutenberg.org/ebooks/23",
                    "source_name": "project_gutenberg",
                    "text": text,
                    "title": f"Narrative of the Life of Frederick Douglass, Chapter {match.group(1)}",
                })
                print(f"    Chapter {match.group(1)} — {len(text)} chars")
    return records


def import_my_bondage():
    """Import 'My Bondage and My Freedom' (Gutenberg 202).
    Split by chapter."""
    print("Importing My Bondage and My Freedom (Gutenberg 202)...")
    raw = read_local_or_fetch("douglass_202.txt",
                              "https://www.gutenberg.org/cache/epub/202/pg202.txt")
    content = strip_gutenberg(raw)

    chapters = re.split(r'\n{2,}(?=\s*CHAPTER [IVXLC]+)', content)

    records = []
    for part in chapters:
        match = re.match(r'\s*CHAPTER ([IVXLC]+)', part.strip())
        if match:
            text = part.strip()
            if len(text) > 500:
                records.append({
                    "id": make_id(SPEAKER, text),
                    "speaker": SPEAKER,
                    "date": "1855-01-01",
                    "type": "essay",
                    "source_url": "https://www.gutenberg.org/ebooks/202",
                    "source_name": "project_gutenberg",
                    "text": text,
                    "title": f"My Bondage and My Freedom, Chapter {match.group(1)}",
                })
                print(f"    Chapter {match.group(1)} — {len(text)} chars")
    return records


def main():
    all_records = []

    ws_records = import_wikisource()
    all_records.extend(ws_records)

    standalone_records = import_standalone_speeches()
    all_records.extend(standalone_records)

    three_records = import_three_addresses()
    all_records.extend(three_records)

    articles_records = import_collected_articles()
    all_records.extend(articles_records)

    narrative_records = import_narrative()
    all_records.extend(narrative_records)

    bondage_records = import_my_bondage()
    all_records.extend(bondage_records)

    # Dedup by id
    seen = set()
    unique = []
    for r in all_records:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    all_records = unique

    print(f"\n=== TOTAL: {len(all_records)} unique Douglass records ===")

    if all_records:
        inserted = bulk_insert(all_records)
        print(f"Inserted {inserted} records into corpus.db")


if __name__ == "__main__":
    main()

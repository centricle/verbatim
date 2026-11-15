#!/usr/bin/env python3
"""Deepen Lincoln corpus with canonical speeches and letters.

Current corpus has 15 Lincoln records from Miller Center (major addresses).
This script adds:
- Speeches & Letters from Gutenberg 14721 (comprehensive collection)
- Lincoln-Douglas debates from Gutenberg 48364
- Individual WikiSource pages for key letters

Deduplication is handled by ingest.py's SHA256(speaker:text) ID scheme.
Records that already exist (from Miller Center) will be silently ignored.
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

SPEAKER = "abraham-lincoln"
TMP_DIR = os.path.join(os.path.dirname(__file__), "tmp")


def read_local_or_fetch(filename, url):
    """Read from local tmp/ cache, or fetch from URL."""
    local_path = os.path.join(TMP_DIR, filename)
    if os.path.exists(local_path):
        print(f"  Reading from local cache: tmp/{filename}")
        with open(local_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    print(f"  Fetching from {url}...")
    resp = SESSION.get(url, timeout=120)
    resp.raise_for_status()
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(resp.text)
    return resp.text


def strip_gutenberg(raw):
    """Strip Project Gutenberg header and footer."""
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

    return raw[start:end].strip().replace('\r\n', '\n')


def classify_type(title):
    """Classify document type from title."""
    title_lower = title.lower()
    if "letter" in title_lower or "to " in title_lower:
        return "letter"
    if "address" in title_lower or "inaugural" in title_lower:
        return "address"
    if "proclamation" in title_lower or "emancipation" in title_lower:
        return "proclamation"
    if "order" in title_lower:
        return "executive_order"
    if "debate" in title_lower:
        return "speech"
    if "message" in title_lower:
        return "speech"
    return "speech"


def import_speeches_and_letters():
    """Import from 'Speeches & Letters of Abraham Lincoln, 1832-1865' (Gutenberg 14721)."""
    print("Importing Speeches & Letters of Abraham Lincoln (Gutenberg 14721)...")

    try:
        raw = read_local_or_fetch(
            "lincoln_speeches_letters.txt",
            "https://www.gutenberg.org/cache/epub/14721/pg14721.txt"
        )
    except Exception as e:
        print(f"  ERROR fetching: {e}")
        print("  Trying alternate URL...")
        try:
            raw = read_local_or_fetch(
                "lincoln_speeches_letters.txt",
                "https://www.gutenberg.org/files/14721/14721-0.txt"
            )
        except Exception as e2:
            print(f"  ERROR: {e2}")
            print("  SKIP: Could not download Lincoln speeches collection")
            return []

    content = strip_gutenberg(raw)

    # This collection is organized by date with section headings
    # Split on date-prefixed sections or titled sections
    # Pattern varies; try splitting on lines that look like titles (ALL CAPS or date headers)
    sections = re.split(r'\n{3,}', content)

    records = []
    current_title = ""
    current_date = None
    current_text = []

    for section in sections:
        section = section.strip()
        if not section:
            continue

        # Check if this is a title/header section
        lines = section.split('\n')
        first_line = lines[0].strip()

        # Date pattern: e.g., "1858", "June 16, 1858", "March 4, 1861"
        date_match = re.match(r'^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(\d{4})', first_line)
        year_match = re.match(r'^(\d{4})\.?\s*$', first_line)

        # Title pattern: mostly uppercase or short descriptive line
        is_title = (
            len(first_line) < 100 and
            (first_line.isupper() or
             first_line.startswith("TO ") or
             first_line.startswith("LETTER ") or
             first_line.startswith("SPEECH ") or
             first_line.startswith("ADDRESS ") or
             "INAUGURAL" in first_line.upper() or
             "GETTYSBURG" in first_line.upper() or
             "PROCLAMATION" in first_line.upper())
        )

        if is_title or date_match or year_match:
            # Save previous record if we have one
            if current_title and current_text:
                text = "\n\n".join(current_text).strip()
                if len(text) > 100:
                    records.append({
                        "id": make_id(SPEAKER, text),
                        "speaker": SPEAKER,
                        "date": current_date,
                        "type": classify_type(current_title),
                        "source_url": "https://www.gutenberg.org/ebooks/14721",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": current_title[:200],
                    })

            current_title = first_line
            current_text = [section]

            # Extract date
            if date_match:
                year = date_match.group(1)
                month_map = {
                    "January": "01", "February": "02", "March": "03",
                    "April": "04", "May": "05", "June": "06",
                    "July": "07", "August": "08", "September": "09",
                    "October": "10", "November": "11", "December": "12",
                }
                month_name = first_line.split()[0]
                day_match = re.search(r'(\d{1,2})', first_line.split(',')[0].split()[-1] if ',' in first_line else first_line)
                day = day_match.group(1).zfill(2) if day_match else "01"
                month = month_map.get(month_name, "01")
                current_date = f"{year}-{month}-{day}"
            elif year_match:
                current_date = f"{year_match.group(1)}-01-01"
            else:
                # Try to find a year in the title
                y = re.search(r'\b(1[789]\d{2})\b', first_line)
                current_date = f"{y.group(1)}-01-01" if y else None
        else:
            current_text.append(section)

    # Don't forget the last record
    if current_title and current_text:
        text = "\n\n".join(current_text).strip()
        if len(text) > 100:
            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": current_date,
                "type": classify_type(current_title),
                "source_url": "https://www.gutenberg.org/ebooks/14721",
                "source_name": "project_gutenberg",
                "text": text,
                "title": current_title[:200],
            })

    if records:
        inserted = bulk_insert(records)
        print(f"  Speeches & Letters: {len(records)} parsed, {inserted} processed")
    else:
        print("  WARNING: No records parsed from Gutenberg 14721")
    return records


def import_noted_speeches():
    """Import from 'Noted Speeches of Abraham Lincoln' (Gutenberg 48364).

    Contains: Cooper Institute Speech, First Inaugural, Gettysburg Address,
    Second Inaugural, Emancipation Proclamation, Lincoln-Douglas Debate (Ottawa).
    """
    print("\nImporting Noted Speeches (Gutenberg 48364)...")

    try:
        raw = read_local_or_fetch(
            "lincoln_douglas_debates.txt",
            "https://www.gutenberg.org/cache/epub/48364/pg48364.txt"
        )
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    content = strip_gutenberg(raw).replace('\r\n', '\n')

    # Known sections with their positions and dates
    sections = [
        ("COOPER INSTITUTE SPEECH", "1860-02-27", "speech", "Cooper Institute Speech"),
        ("LINCOLN'S FIRST INAUGURAL ADDRESS", "1861-03-04", "address", "First Inaugural Address"),
        ("LINCOLN'S GETTYSBURG SPEECH", "1863-11-19", "address", "Gettysburg Address"),
        ("LINCOLN'S SECOND INAUGURAL ADDRESS", "1865-03-04", "address", "Second Inaugural Address"),
        ("PROCLAMATION OF EMANCIPATION", "1863-01-01", "proclamation", "Emancipation Proclamation"),
        ("LINCOLN-DOUGLAS DEBATE", "1858-08-21", "speech", "Lincoln-Douglas Debate at Ottawa (Douglas's Opening)"),
    ]

    # Find positions of each section header
    section_positions = []
    for header, date, rec_type, title in sections:
        pos = content.find(header)
        if pos != -1:
            section_positions.append((pos, header, date, rec_type, title))

    # Sort by position
    section_positions.sort(key=lambda x: x[0])

    records = []
    for i, (pos, header, date, rec_type, title) in enumerate(section_positions):
        # End at next section or end of content
        if i + 1 < len(section_positions):
            end = section_positions[i + 1][0]
        else:
            end = len(content)

        # For Lincoln-Douglas, there are two parts (Douglas's opening, Lincoln's reply)
        # Find the second "LINCOLN-DOUGLAS DEBATE" for Lincoln's reply
        if header == "LINCOLN-DOUGLAS DEBATE":
            second = content.find("LINCOLN-DOUGLAS DEBATE", pos + 30)
            if second != -1 and second < end:
                # Import Douglas's opening as first part
                text1 = content[pos:second].strip()
                if len(text1) > 200:
                    records.append({
                        "id": make_id(SPEAKER, text1),
                        "speaker": SPEAKER,
                        "date": date,
                        "type": rec_type,
                        "source_url": "https://www.gutenberg.org/ebooks/48364",
                        "source_name": "project_gutenberg",
                        "text": text1,
                        "title": "Lincoln-Douglas Debate at Ottawa (Douglas's Opening)",
                    })
                    print(f"  Parsed: Lincoln-Douglas Debate, Part 1 ({len(text1)} chars)")

                # Import Lincoln's reply as second part
                text2 = content[second:end].strip()
                if len(text2) > 200:
                    records.append({
                        "id": make_id(SPEAKER, text2),
                        "speaker": SPEAKER,
                        "date": date,
                        "type": rec_type,
                        "source_url": "https://www.gutenberg.org/ebooks/48364",
                        "source_name": "project_gutenberg",
                        "text": text2,
                        "title": "Lincoln-Douglas Debate at Ottawa (Lincoln's Reply)",
                    })
                    print(f"  Parsed: Lincoln-Douglas Debate, Part 2 ({len(text2)} chars)")
                continue

        text = content[pos:end].strip()
        if len(text) > 200:
            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": date,
                "type": rec_type,
                "source_url": "https://www.gutenberg.org/ebooks/48364",
                "source_name": "project_gutenberg",
                "text": text,
                "title": title,
            })
            print(f"  Parsed: {title} ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Noted Speeches: {len(records)} parsed, {inserted} processed")
    return records


def import_wikisource_lincoln():
    """Import specific Lincoln works from WikiSource."""
    print("\nImporting Lincoln works from WikiSource...")

    pages = [
        ("Life_and_Works_of_Abraham_Lincoln/Volume_8/Bixby,_Mrs.", "1864-11-21", "letter", "Letter to Mrs. Lydia Bixby"),
        ("Life_and_Works_of_Abraham_Lincoln/Volume_9/Greeley,_Horace", "1862-08-22", "letter", "Letter to Horace Greeley"),
        ("Life_and_Works_of_Abraham_Lincoln/Volume_9/Hodges,_A._G.", "1864-04-04", "letter", "Letter to Albert G. Hodges"),
        ("Life_and_Works_of_Abraham_Lincoln/Volume_3/The_Perpetuation_of_Our_Political_Institutions", "1838-01-27", "address", "Lyceum Address: The Perpetuation of Our Political Institutions"),
    ]

    records = []
    for page_title, date, rec_type, title in pages:
        time.sleep(0.5)
        print(f"  Fetching: {title}...", end=" ", flush=True)

        url = "https://en.wikisource.org/w/api.php"
        params = {
            "action": "parse",
            "page": page_title,
            "prop": "wikitext",
            "format": "json",
        }
        try:
            resp = SESSION.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            if "error" in data:
                print("SKIP (page not found)")
                continue

            wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
            text = strip_wikitext(wikitext)

            if not text or len(text) < 30:
                print("SKIP (empty)")
                continue

            source_url = f"https://en.wikisource.org/wiki/{page_title}"
            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": date,
                "type": rec_type,
                "source_url": source_url,
                "source_name": "wikisource",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        except Exception as e:
            print(f"ERROR: {e}")

    if records:
        inserted = bulk_insert(records)
        print(f"  WikiSource: {len(records)} fetched, {inserted} processed")
    return records


def strip_wikitext(raw):
    """Convert WikiSource wikitext to plain text."""
    text = re.sub(r'\{\{header[^}]*\}\}', '', raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    text = re.sub(r'\[\[Category:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[a-z]{2,3}:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[^\]]*\|([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]]*)\]\]', r'\1', text)
    text = re.sub(r"'{2,}", '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'^=+\s*(.*?)\s*=+$', r'\1', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()




def main():
    total = 0

    speeches = import_speeches_and_letters()
    total += len(speeches)

    debates = import_noted_speeches()
    total += len(debates)

    wikisource = import_wikisource_lincoln()
    total += len(wikisource)

    print(f"\n{'='*60}")
    print(f"Total Lincoln records imported: {total}")
    print("(Duplicates with existing Miller Center records silently ignored)")


if __name__ == "__main__":
    main()

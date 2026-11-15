#!/usr/bin/env python3
"""Import Mark Twain essays, speeches, and letters into the verbatim corpus.

Sources:
- Project Gutenberg: "Mark Twain's Speeches" (3188), "What Is Man? and Other Essays" (70),
  "The $30,000 Bequest, and Other Stories" (142), "Fenimore Cooper's Literary Offences" (3172),
  "The Man That Corrupted Hadleyburg" (3251), individual essays
- WikiSource: The War Prayer, other individual works

NOT importing: full novels. A novel is not a "statement." Individual essays and
speeches from essay collections are fair game.

All works are public domain (Twain died 1910).
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

SPEAKER = "mark-twain"
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


def import_twain_speeches():
    """Import individual speeches from 'Mark Twain's Speeches' (Gutenberg 3188).

    The book contains ~80 individual speeches, each with a title header.
    """
    print("Importing Mark Twain's Speeches (Gutenberg 3188)...")
    raw = read_local_or_fetch("twain_speeches.txt", "https://www.gutenberg.org/cache/epub/3188/pg3188.txt")
    content = strip_gutenberg(raw)

    # Skip TOC, introduction, preface — find the second "THE STORY OF A SPEECH"
    # (first is in table of contents, second starts the actual speech)
    first_pos = content.find("THE STORY OF A SPEECH")
    if first_pos != -1:
        second_pos = content.find("THE STORY OF A SPEECH", first_pos + 30)
        if second_pos != -1:
            content = content[second_pos:]
        else:
            content = content[first_pos:]

    # Identify speech boundaries: ALL-CAPS title lines preceded by 2+ blank lines
    # Speeches are separated by \n\n\n+ then an ALL-CAPS title on its own line
    lines = content.split('\n')
    speech_starts = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        # Title lines: ALL CAPS, not indented, reasonably short
        if (stripped.isupper() and
            len(stripped) > 5 and len(stripped) < 80 and
            not line.startswith(' ') and
            not stripped.startswith('***')):
            # Check preceded by blank line(s)
            if i > 0 and not lines[i-1].strip():
                speech_starts.append(i)

    records = []
    for idx, start_line in enumerate(speech_starts):
        end_line = speech_starts[idx + 1] if idx + 1 < len(speech_starts) else len(lines)
        # Back up to include blank lines before next title
        while end_line > start_line and not lines[end_line - 1].strip():
            end_line -= 1

        chunk = '\n'.join(lines[start_line:end_line]).strip()
        if len(chunk) < 100:
            continue

        # Title is first non-empty line
        title = lines[start_line].strip()

        # Skip non-speech entries
        skip_titles = ["CONTENTS", "INTRODUCTION", "PREFACE", "FROM THE PREFACE",
                        "MARK TWAIN'S SPEECHES", "SEVENTIETH BIRTHDAY"]
        if any(title.startswith(s) for s in skip_titles):
            continue

        # Extract date from indented subtitle lines
        date = None
        for line in lines[start_line:min(start_line + 10, end_line)]:
            date_match = re.search(r'(\d{4})', line)
            if date_match:
                year = int(date_match.group(1))
                if 1835 <= year <= 1910:
                    date = f"{year}-01-01"
                    break

        records.append({
            "id": make_id(SPEAKER, chunk),
            "speaker": SPEAKER,
            "date": date,
            "type": "speech",
            "source_url": "https://www.gutenberg.org/ebooks/3188",
            "source_name": "project_gutenberg",
            "text": chunk,
            "title": title[:200],
        })

    if records:
        inserted = bulk_insert(records)
        print(f"  Speeches: {len(records)} parsed, {inserted} processed")
    return records


def import_twain_essays():
    """Import individual essays from 'What Is Man? and Other Essays' (Gutenberg 70)."""
    print("\nImporting 'What Is Man? and Other Essays' (Gutenberg 70)...")
    raw = read_local_or_fetch("twain_essays.txt", "https://www.gutenberg.org/cache/epub/70/pg70.txt")
    content = strip_gutenberg(raw)

    # Find actual essay starts by scanning for ALL-CAPS title lines
    # Skip the TOC which has the same titles but preceded by spaces
    lines = content.split('\n')

    # Known essays in this collection
    essay_titles = [
        "WHAT IS MAN?",
        "THE DEATH OF JEAN",
        "THE TURNING-POINT OF MY LIFE",
        "HOW TO MAKE HISTORY DATES STICK",
        "THE MEMORABLE ASSASSINATION",
        "A SCRAP OF CURIOUS HISTORY",
        "SWITZERLAND, THE CRADLE OF LIBERTY",
        "AT THE SHRINE OF ST. WAGNER",
        "WILLIAM DEAN HOWELLS",
        "ENGLISH AS SHE IS TAUGHT",
        "A SIMPLIFIED ALPHABET",
        "AS CONCERNS INTERPRETING THE DEITY",
        "CONCERNING TOBACCO",
        "THE BEE",
        "TAMING THE BICYCLE",
        "IS SHAKESPEARE DEAD?",
    ]

    # Find line positions of each essay title (non-indented, after TOC)
    # The TOC titles are preceded by spaces; actual essay titles are not
    title_positions = {}
    past_toc = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        # TOC ends when we hit the first non-indented essay title
        if stripped == "WHAT IS MAN?" and not line.startswith(' '):
            # Could be TOC or actual start — check if followed by blank + text
            if i + 2 < len(lines) and not lines[i + 1].strip():
                past_toc = True

        if past_toc and stripped in essay_titles and not line.startswith(' '):
            if stripped not in title_positions:
                title_positions[stripped] = i

    # Extract essays between consecutive title positions
    sorted_titles = sorted(title_positions.items(), key=lambda x: x[1])

    records = []
    for idx, (title, start_line) in enumerate(sorted_titles):
        end_line = sorted_titles[idx + 1][1] if idx + 1 < len(sorted_titles) else len(lines)

        text = '\n'.join(lines[start_line:end_line]).strip()
        if len(text) < 100:
            print(f"  SKIP: {title} (too short: {len(text)} chars)")
            continue

        # Approximate dates for known essays
        dates = {
            "WHAT IS MAN?": "1906-01-01",
            "THE DEATH OF JEAN": "1910-01-01",
            "THE TURNING-POINT OF MY LIFE": "1910-01-01",
            "THE MEMORABLE ASSASSINATION": "1898-09-01",
            "ENGLISH AS SHE IS TAUGHT": "1887-04-01",
            "CONCERNING TOBACCO": "1893-01-01",
            "TAMING THE BICYCLE": "1884-01-01",
            "IS SHAKESPEARE DEAD?": "1909-01-01",
        }

        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
            "date": dates.get(title),
            "type": "essay",
            "source_url": "https://www.gutenberg.org/ebooks/70",
            "source_name": "project_gutenberg",
            "text": text,
            "title": title.title(),
        })
        print(f"  Parsed: {title} ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Essays: {len(records)} parsed, {inserted} processed")
    return records


def import_standalone_essays():
    """Import notable standalone essays/stories from individual Gutenberg editions."""
    print("\nImporting standalone Twain essays...")

    standalone = [
        {
            "gutenberg_id": 3172,
            "filename": "twain_cooper.txt",
            "url": "https://www.gutenberg.org/cache/epub/3172/pg3172.txt",
            "title": "Fenimore Cooper's Literary Offences",
            "date": "1895-07-01",
            "type": "essay",
        },
        {
            "gutenberg_id": 3174,
            "filename": "twain_dogs_tale.txt",
            "url": "https://www.gutenberg.org/cache/epub/3174/pg3174.txt",
            "title": "A Dog's Tale",
            "date": "1903-01-01",
            "type": "essay",
        },
        {
            "gutenberg_id": 8525,
            "filename": "twain_eves_diary.txt",
            "url": "https://www.gutenberg.org/cache/epub/8525/pg8525.txt",
            "title": "Eve's Diary",
            "date": "1905-12-01",
            "type": "essay",
        },
        {
            "gutenberg_id": 19682,
            "filename": "twain_autobiography.txt",
            "url": "https://www.gutenberg.org/cache/epub/19682/pg19682.txt",
            "title": "Chapters from My Autobiography",
            "date": "1906-09-01",
            "type": "essay",
        },
    ]

    records = []
    for item in standalone:
        print(f"  Fetching: {item['title']}...", end=" ", flush=True)
        try:
            raw = read_local_or_fetch(item["filename"], item["url"])
            text = strip_gutenberg(raw)

            if len(text) < 200:
                print("SKIP (too short)")
                continue

            records.append({
                "id": make_id(SPEAKER, text),
                "speaker": SPEAKER,
                "date": item["date"],
                "type": item["type"],
                "source_url": f"https://www.gutenberg.org/ebooks/{item['gutenberg_id']}",
                "source_name": "project_gutenberg",
                "text": text,
                "title": item["title"],
            })
            print(f"OK ({len(text)} chars)")
        except Exception as e:
            print(f"ERROR: {e}")

    if records:
        inserted = bulk_insert(records)
        print(f"  Standalone: {len(records)} fetched, {inserted} processed")
    return records


def import_wikisource_twain():
    """Import notable Twain works from WikiSource."""
    print("\nImporting Twain works from WikiSource...")

    pages = [
        ("Harper's_Magazine/The_War_Prayer", "1905-01-01", "essay", "The War Prayer"),
        ("To_the_Person_Sitting_in_Darkness", "1901-02-01", "essay", "To the Person Sitting in Darkness"),
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
                print(f"SKIP (page not found)")
                continue

            wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
            text = strip_wikitext(wikitext)

            if not text or len(text) < 50:
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


def import_following_equator_maxims():
    """Import the famous maxims from 'Following the Equator' (Gutenberg 2895).

    Each chapter opens with an epigraph from 'Pudd'nhead Wilson's New Calendar.'
    These are among Twain's most quoted lines.
    """
    print("\nImporting 'Following the Equator' maxims (Gutenberg 2895)...")
    raw = read_local_or_fetch("twain_equator.txt", "https://www.gutenberg.org/cache/epub/2895/pg2895.txt")
    content = strip_gutenberg(raw)

    # Find maxims — they appear as epigraphs at chapter heads
    # Pattern: lines starting with dash or preceded by "Pudd'nhead Wilson"
    maxims = re.findall(
        r'(?:—Pudd\'nhead Wilson\'s New Calendar\.?\s*\n\s*\n(.*?)(?=\n\n\n|\nCHAPTER))',
        content,
        re.DOTALL
    )

    # Alternative: look for chapter epigraphs between CHAPTER heading and body
    if not maxims:
        chapters = re.split(r'\n\nCHAPTER [IVXLC]+\.?\n', content)
        maxims_text = []
        for ch in chapters[1:]:
            # Epigraph is typically first paragraph, ending with "—Pudd'nhead Wilson"
            match = re.search(r'^(.*?—Pudd\'nhead Wilson\'s New Calendar\.?)', ch, re.DOTALL)
            if match:
                maxim = match.group(1).strip()
                # Clean it up
                maxim = re.sub(r'\s+', ' ', maxim)
                if len(maxim) > 10 and len(maxim) < 500:
                    maxims_text.append(maxim)

        if maxims_text:
            # Combine all maxims into a single record
            combined = "Pudd'nhead Wilson's New Calendar\n(Maxims from Following the Equator)\n\n"
            combined += "\n\n".join(maxims_text)

            records = [{
                "id": make_id(SPEAKER, combined),
                "speaker": SPEAKER,
                "date": "1897-01-01",
                "type": "essay",
                "source_url": "https://www.gutenberg.org/ebooks/2895",
                "source_name": "project_gutenberg",
                "text": combined,
                "title": "Pudd'nhead Wilson's New Calendar (Following the Equator)",
            }]
            inserted = bulk_insert(records)
            print(f"  Maxims: {len(maxims_text)} maxims combined into 1 record, {inserted} processed")
            return records

    print("  SKIP: Could not extract maxims")
    return []


def main():
    total = 0

    speeches = import_twain_speeches()
    total += len(speeches)

    essays = import_twain_essays()
    total += len(essays)

    standalone = import_standalone_essays()
    total += len(standalone)

    wikisource = import_wikisource_twain()
    total += len(wikisource)

    maxims = import_following_equator_maxims()
    total += len(maxims)

    print(f"\n{'='*60}")
    print(f"Total Twain records imported: {total}")


if __name__ == "__main__":
    main()

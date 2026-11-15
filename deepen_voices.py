#!/usr/bin/env python3
"""Deepen existing non-presidential voices in the verbatim corpus.

Adds new sources for speakers who currently have thin representation:
- Susan B. Anthony: 1 → 30+ records
- Frederick Douglass: ~42 → 100+ records
- Benjamin Franklin: ~18 → 50+ records
- Winston Churchill: ~31 → 80+ records

All works are public domain. Run after the original import scripts.
Deduplication handled by ingest.py's SHA256(speaker:text) scheme.
"""

import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

from ingest import bulk_insert, make_id, user_agent

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": user_agent()
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
    resp = SESSION.get(url, timeout=120)
    resp.raise_for_status()
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(resp.text)
    return resp.text


def strip_gutenberg(raw):
    """Strip Project Gutenberg header and footer."""
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


def strip_wikitext(raw):
    """Convert WikiSource wikitext to plain text."""
    text = re.sub(r'\{\{header[^}]*\}\}', '', raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    text = re.sub(r'\[\[Category:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[a-z]{2,3}:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[^\]]*\|([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]]*)\]\]', r'\1', text)
    text = re.sub(r"'{2,}", '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.DOTALL)
    text = re.sub(r'<ref[^/]*/>', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'^=+\s*(.*?)\s*=+$', r'\1', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def fetch_wikisource_page(page_title):
    """Fetch and parse a WikiSource page via the API."""
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
            return None
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        cleaned = strip_wikitext(wikitext)
        return cleaned if len(cleaned) > 100 else None
    except Exception as e:
        print(f"  ERROR fetching {page_title}: {e}")
        return None


# =============================================================================
# SUSAN B. ANTHONY — Target: 30+ records (currently 1)
# =============================================================================

def deepen_anthony():
    """Add Anthony speeches, letters, and convention addresses."""
    print("\n" + "=" * 60)
    print("DEEPENING: Susan B. Anthony")
    print("=" * 60)
    speaker = "susan-b-anthony"
    records = []

    # WikiSource speeches
    wikisource_pages = [
        ("Is_It_a_Crime_for_a_Citizen_of_the_United_States_to_Vote%3F",
         "1873-01-01", "speech",
         "Is It a Crime for a Citizen of the United States to Vote?"),
        ("Susan_B._Anthony%27s_Speech_After_Being_Convicted_of_Voting",
         "1873-06-19", "speech",
         "Speech After Being Convicted of Voting"),
        ("On_Woman%27s_Right_to_the_Suffrage",
         "1873-01-01", "speech",
         "On Woman\u2019s Right to the Suffrage"),
    ]

    print("  WikiSource speeches...")
    for page_title, date, rec_type, title in wikisource_pages:
        time.sleep(0.5)
        print(f"    Fetching: {title}...", end=" ", flush=True)
        text = fetch_wikisource_page(page_title)
        if text and len(text) > 100:
            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": rec_type,
                "source_url": f"https://en.wikisource.org/wiki/{page_title}",
                "source_name": "wikisource",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        else:
            print("SKIP")

    # Gutenberg 28020: "The Life and Work of Susan B. Anthony" Vol 1
    # Contains many of her speeches and letters in full
    print("  Gutenberg 28020: Life and Work of Susan B. Anthony...")
    try:
        raw = read_local_or_fetch("anthony_28020.txt",
                                  "https://www.gutenberg.org/cache/epub/28020/pg28020.txt")
        content = strip_gutenberg(raw)

        # Split by chapter
        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1898-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/28020",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"Life and Work of Susan B. Anthony, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Gutenberg 28021: "The Life and Work of Susan B. Anthony" Vol 2
    print("  Gutenberg 28021: Life and Work of Susan B. Anthony, Vol. 2...")
    try:
        raw = read_local_or_fetch("anthony_28021.txt",
                                  "https://www.gutenberg.org/cache/epub/28021/pg28021.txt")
        content = strip_gutenberg(raw)

        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1898-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/28021",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"Life and Work of Susan B. Anthony Vol. 2, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Dedup
    seen = set()
    unique = [r for r in records if r["id"] not in seen and not seen.add(r["id"])]

    print(f"\n  Anthony total: {len(unique)} new records")
    if unique:
        bulk_insert(unique)
    return unique


# =============================================================================
# FREDERICK DOUGLASS — Target: 100+ records (currently ~42)
# =============================================================================

def deepen_douglass():
    """Add Douglass speeches, letters, and 'Life and Times'."""
    print("\n" + "=" * 60)
    print("DEEPENING: Frederick Douglass")
    print("=" * 60)
    speaker = "frederick-douglass"
    records = []

    # Gutenberg 71893: "Life and Times of Frederick Douglass"
    # This is the expanded autobiography — much more than Narrative
    print("  Gutenberg 71893: Life and Times of Frederick Douglass...")
    try:
        raw = read_local_or_fetch("douglass_71893.txt",
                                  "https://www.gutenberg.org/cache/epub/71893/pg71893.txt")
        content = strip_gutenberg(raw)

        # Split by chapter
        chapters = re.split(r'\n{2,}(?=\s*CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'\s*CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1881-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/71893",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"Life and Times of Frederick Douglass, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Additional WikiSource speeches
    wikisource_pages = [
        ("The_Meaning_of_July_Fourth_for_the_Negro",
         "1852-07-05", "speech",
         "What to the Slave is the Fourth of July?"),
        ("The_Hypocrisy_of_American_Slavery",
         "1852-07-04", "speech",
         "The Hypocrisy of American Slavery"),
        ("Men_of_Color,_To_Arms!",
         "1863-03-02", "speech",
         "Men of Color, To Arms!"),
        ("Frederick_Douglass%27_Paper/1855/If_There_Is_No_Struggle_There_Is_No_Progress",
         "1857-08-03", "speech",
         "If There Is No Struggle There Is No Progress (West India Emancipation Speech)"),
        ("The_Claims_of_the_Negro,_Ethnologically_Considered",
         "1854-07-12", "speech",
         "The Claims of the Negro, Ethnologically Considered"),
        ("Frederick_Douglass%27_Paper/Self-Made_Men",
         "1859-01-01", "speech",
         "Self-Made Men"),
    ]

    print("  WikiSource speeches...")
    for page_title, date, rec_type, title in wikisource_pages:
        time.sleep(0.5)
        print(f"    Fetching: {title}...", end=" ", flush=True)
        text = fetch_wikisource_page(page_title)
        if text and len(text) > 200:
            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": rec_type,
                "source_url": f"https://en.wikisource.org/wiki/{page_title}",
                "source_name": "wikisource",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        else:
            print("SKIP")

    # Gutenberg 36854: "The Frederick Douglass Papers" — collected speeches
    print("  Gutenberg 36854: Frederick Douglass Papers...")
    try:
        raw = read_local_or_fetch("douglass_36854.txt",
                                  "https://www.gutenberg.org/cache/epub/36854/pg36854.txt")
        content = strip_gutenberg(raw)

        if len(content) > 500:
            # Try chapter split
            chapters = re.split(r'\n{3,}(?=[A-Z][A-Z\s,\'\-]{10,}\n)', content)
            if len(chapters) > 3:
                for i, chunk in enumerate(chapters[1:], 1):
                    text = chunk.strip()
                    if len(text) < 300:
                        continue
                    lines = text.split('\n')
                    title_line = lines[0].strip()[:200]
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": None,
                        "type": "speech",
                        "source_url": "https://www.gutenberg.org/ebooks/36854",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": title_line,
                    })
                    print(f"    Section: {title_line[:60]}... ({len(text)} chars)")
            else:
                # Single record
                records.append({
                    "id": make_id(speaker, content),
                    "speaker": speaker,
                    "date": None,
                    "type": "speech",
                    "source_url": "https://www.gutenberg.org/ebooks/36854",
                    "source_name": "project_gutenberg",
                    "text": content,
                    "title": "Frederick Douglass Papers",
                })
    except Exception as e:
        print(f"    ERROR: {e}")

    # Dedup
    seen = set()
    unique = [r for r in records if r["id"] not in seen and not seen.add(r["id"])]

    print(f"\n  Douglass total: {len(unique)} new records")
    if unique:
        bulk_insert(unique)
    return unique


# =============================================================================
# BENJAMIN FRANKLIN — Target: 50+ records (currently ~18)
# =============================================================================

def deepen_franklin():
    """Add Franklin letters, essays, and Constitutional Convention speeches."""
    print("\n" + "=" * 60)
    print("DEEPENING: Benjamin Franklin")
    print("=" * 60)
    speaker = "benjamin-franklin"
    records = []

    # WikiSource works
    wikisource_pages = [
        ("Rules_by_Which_a_Great_Empire_May_Be_Reduced_to_a_Small_One",
         "1773-09-11", "essay",
         "Rules by Which a Great Empire May Be Reduced to a Small One"),
        ("Apology_for_Printers", "1731-06-10", "essay",
         "Apology for Printers"),
        ("The_Way_to_Wealth", "1758-01-01", "essay",
         "The Way to Wealth (Father Abraham's Speech)"),
        ("Speech_to_the_Constitutional_Convention_(1787)",
         "1787-09-17", "speech",
         "Speech at the Conclusion of the Constitutional Convention"),
        ("On_the_Slave-Trade", "1790-03-23", "essay",
         "On the Slave-Trade"),
        ("A_Narrative_of_the_Late_Massacres", "1764-01-01", "essay",
         "A Narrative of the Late Massacres in Lancaster County"),
        ("Information_to_Those_Who_Would_Remove_to_America",
         "1784-01-01", "essay",
         "Information to Those Who Would Remove to America"),
        ("Remarks_Concerning_the_Savages_of_North_America",
         "1784-01-01", "essay",
         "Remarks Concerning the Savages of North America"),
        ("Benjamin_Franklin%27s_Petition_to_Congress_Against_Slavery",
         "1790-02-03", "letter",
         "Petition to Congress Against Slavery"),
        ("The_Morals_of_Chess", "1779-06-01", "essay",
         "The Morals of Chess"),
        ("A_Witch_Trial_at_Mount_Holly", "1730-10-22", "essay",
         "A Witch Trial at Mount Holly"),
        ("The_Whistle_(Franklin)", "1779-11-10", "letter",
         "The Whistle"),
    ]

    print("  WikiSource works...")
    for page_title, date, rec_type, title in wikisource_pages:
        time.sleep(0.5)
        print(f"    Fetching: {title}...", end=" ", flush=True)
        text = fetch_wikisource_page(page_title)
        if text and len(text) > 100:
            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": rec_type,
                "source_url": f"https://en.wikisource.org/wiki/{page_title}",
                "source_name": "wikisource",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        else:
            print("SKIP")

    # Gutenberg 10: "The Complete Works of Benjamin Franklin" (if available)
    # This is a 10-volume set — try Volume 1
    print("  Gutenberg 10: Complete Works of Benjamin Franklin...")
    try:
        raw = read_local_or_fetch("franklin_10.txt",
                                  "https://www.gutenberg.org/cache/epub/10/pg10.txt")
        content = strip_gutenberg(raw)

        if len(content) > 500:
            # Split by chapters/letters/sections
            sections = re.split(r'\n{3,}', content)
            current_title = None
            current_text = []

            for section in sections:
                section = section.strip()
                if not section:
                    continue

                # Detect letter/essay headers
                first_line = section.split('\n')[0].strip()
                is_header = (
                    len(first_line) < 120 and
                    (first_line.isupper() or
                     first_line.startswith("TO ") or
                     first_line.startswith("LETTER ") or
                     "LETTER" in first_line.upper())
                )

                if is_header and current_title and current_text:
                    text = "\n\n".join(current_text).strip()
                    if len(text) > 200:
                        year_match = re.search(r'\b(1[67]\d{2})\b', text[:500])
                        date = f"{year_match.group(1)}-01-01" if year_match else None
                        rec_type = "letter" if "letter" in current_title.lower() or "to " in current_title.lower() else "essay"
                        records.append({
                            "id": make_id(speaker, text),
                            "speaker": speaker,
                            "date": date,
                            "type": rec_type,
                            "source_url": "https://www.gutenberg.org/ebooks/10",
                            "source_name": "project_gutenberg",
                            "text": text,
                            "title": current_title[:200],
                        })
                    current_title = first_line
                    current_text = [section]
                elif is_header:
                    current_title = first_line
                    current_text = [section]
                else:
                    current_text.append(section)

            # Last section
            if current_title and current_text:
                text = "\n\n".join(current_text).strip()
                if len(text) > 200:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": None,
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/10",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": current_title[:200],
                    })

            print(f"    Parsed sections from Complete Works")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Gutenberg 17449: "Experiments and Observations on Electricity"
    print("  Gutenberg 17449: Experiments and Observations on Electricity...")
    try:
        raw = read_local_or_fetch("franklin_17449.txt",
                                  "https://www.gutenberg.org/cache/epub/17449/pg17449.txt")
        content = strip_gutenberg(raw)

        if len(content) > 500:
            # This is a series of letters to Peter Collinson
            # Split by "LETTER" headers
            letters = re.split(r'\n{2,}(?=LETTER [IVXLC]+)', content)
            for part in letters:
                match = re.match(r'LETTER ([IVXLC]+)', part.strip())
                if match:
                    text = part.strip()
                    if len(text) > 300:
                        records.append({
                            "id": make_id(speaker, text),
                            "speaker": speaker,
                            "date": "1751-01-01",
                            "type": "letter",
                            "source_url": "https://www.gutenberg.org/ebooks/17449",
                            "source_name": "project_gutenberg",
                            "text": text,
                            "title": f"Experiments on Electricity, Letter {match.group(1)}",
                        })
                        print(f"    Letter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Dedup
    seen = set()
    unique = [r for r in records if r["id"] not in seen and not seen.add(r["id"])]

    print(f"\n  Franklin total: {len(unique)} new records")
    if unique:
        bulk_insert(unique)
    return unique


# =============================================================================
# WINSTON CHURCHILL — Target: 80+ records (currently ~31)
# =============================================================================

def deepen_churchill():
    """Add Churchill wartime speeches, parliamentary addresses, and essays."""
    print("\n" + "=" * 60)
    print("DEEPENING: Winston Churchill")
    print("=" * 60)
    speaker = "winston-churchill"
    records = []

    # Additional WikiSource speeches (wartime + post-war)
    wikisource_pages = [
        ("We_Shall_Never_Surrender", "1940-06-04", "speech",
         "We Shall Never Surrender"),
        ("Winston_Churchill%27s_address_to_Congress_(December_26,_1941)",
         "1941-12-26", "speech",
         "Address to the United States Congress"),
        ("Winston_Churchill%27s_address_to_Congress_(May_19,_1943)",
         "1943-05-19", "speech",
         "Second Address to the United States Congress"),
        ("Winston_Churchill%27s_VE_Day_speech_to_the_House_of_Commons",
         "1945-05-08", "speech",
         "VE Day Speech to the House of Commons"),
        ("The_Dream_(Churchill)", "1947-01-01", "essay",
         "The Dream"),
        ("Painting_as_a_Pastime", "1921-01-01", "essay",
         "Painting as a Pastime"),
    ]

    print("  Additional WikiSource speeches...")
    for page_title, date, rec_type, title in wikisource_pages:
        time.sleep(0.5)
        print(f"    Fetching: {title}...", end=" ", flush=True)
        text = fetch_wikisource_page(page_title)
        if text and len(text) > 100:
            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": rec_type,
                "source_url": f"https://en.wikisource.org/wiki/{page_title}",
                "source_name": "wikisource",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        else:
            print("SKIP")

    # Gutenberg 5400: "The River War" — Churchill's account of Sudan campaign
    print("  Gutenberg 5400: The River War...")
    try:
        raw = read_local_or_fetch("churchill_5400.txt",
                                  "https://www.gutenberg.org/cache/epub/5400/pg5400.txt")
        content = strip_gutenberg(raw)

        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1899-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/5400",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"The River War, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Gutenberg 6768: "London to Ladysmith via Pretoria" — Boer War dispatches
    print("  Gutenberg 6768: London to Ladysmith via Pretoria...")
    try:
        raw = read_local_or_fetch("churchill_6768.txt",
                                  "https://www.gutenberg.org/cache/epub/6768/pg6768.txt")
        content = strip_gutenberg(raw)

        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1900-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/6768",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"London to Ladysmith via Pretoria, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Gutenberg 6696: "Ian Hamilton's March" — more Boer War dispatches
    print("  Gutenberg 6696: Ian Hamilton's March...")
    try:
        raw = read_local_or_fetch("churchill_6696.txt",
                                  "https://www.gutenberg.org/cache/epub/6696/pg6696.txt")
        content = strip_gutenberg(raw)

        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1900-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/6696",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"Ian Hamilton's March, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Gutenberg 4368: "My African Journey"
    print("  Gutenberg 4368: My African Journey...")
    try:
        raw = read_local_or_fetch("churchill_4368.txt",
                                  "https://www.gutenberg.org/cache/epub/4368/pg4368.txt")
        content = strip_gutenberg(raw)

        chapters = re.split(r'\n{2,}(?=CHAPTER [IVXLC]+)', content)
        for part in chapters:
            match = re.match(r'CHAPTER ([IVXLC]+)', part.strip())
            if match:
                text = part.strip()
                if len(text) > 500:
                    records.append({
                        "id": make_id(speaker, text),
                        "speaker": speaker,
                        "date": "1908-01-01",
                        "type": "essay",
                        "source_url": "https://www.gutenberg.org/ebooks/4368",
                        "source_name": "project_gutenberg",
                        "text": text,
                        "title": f"My African Journey, Chapter {match.group(1)}",
                    })
                    print(f"    Chapter {match.group(1)} — {len(text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Dedup
    seen = set()
    unique = [r for r in records if r["id"] not in seen and not seen.add(r["id"])]

    print(f"\n  Churchill total: {len(unique)} new records")
    if unique:
        bulk_insert(unique)
    return unique


def main():
    grand_total = 0

    anthony = deepen_anthony()
    grand_total += len(anthony)

    douglass = deepen_douglass()
    grand_total += len(douglass)

    franklin = deepen_franklin()
    grand_total += len(franklin)

    churchill = deepen_churchill()
    grand_total += len(churchill)

    print(f"\n{'=' * 60}")
    print(f"GRAND TOTAL: {grand_total} new records across all speakers")
    print("(Duplicates with existing records silently ignored)")


if __name__ == "__main__":
    main()

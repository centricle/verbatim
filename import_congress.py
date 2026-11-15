#!/usr/bin/env python3
"""Import landmark Congressional floor speeches into the verbatim corpus.

Sources:
- WikiSource (pre-20th century speeches, well-transcribed)
- American Rhetoric (20th-21st century landmark speeches)
- Project Gutenberg (collected speeches volumes)

All speeches are public domain as government proceedings or by date.
Curated set of the most significant floor speeches and statements
in American legislative history.
"""

import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

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
        return strip_wikitext(wikitext)
    except Exception as e:
        print(f"  ERROR fetching {page_title}: {e}")
        return None


def extract_american_rhetoric(html):
    """Extract speech text from an American Rhetoric page."""
    soup = BeautifulSoup(html, "html.parser")
    # AR uses tables for layout — find the main content area
    # Look for the largest text block
    paragraphs = soup.find_all("p")
    if not paragraphs:
        return None
    texts = []
    for p in paragraphs:
        t = p.get_text(strip=True)
        if len(t) > 40:
            texts.append(t)
    text = "\n\n".join(texts)
    # Remove common AR boilerplate
    text = re.sub(r'(?i)audio.*?mp3.*?\n', '', text)
    text = re.sub(r'(?i)delivered.*?(?:house|senate|congress).*?\n', '', text, count=1)
    return text.strip() if len(text) > 200 else None


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


# WikiSource speeches — page title, speaker slug, date, title
WIKISOURCE_SPEECHES = [
    # Daniel Webster
    ("Daniel_Webster%27s_Second_Reply_to_Robert_Y._Hayne",
     "daniel-webster", "1830-01-26",
     "Second Reply to Hayne (Liberty and Union, Now and Forever)"),
    ("Daniel_Webster%27s_Seventh_of_March_Speech",
     "daniel-webster", "1850-03-07",
     "Seventh of March Speech"),

    # Henry Clay
    ("Henry_Clay%27s_Raleigh_Letter", "henry-clay", "1844-04-17",
     "Raleigh Letter on Texas Annexation"),

    # Charles Sumner
    ("The_Crime_Against_Kansas", "charles-sumner", "1856-05-19",
     "The Crime Against Kansas"),

    # Sojourner Truth
    ("Ain%27t_I_a_Woman%3F", "sojourner-truth", "1851-05-29",
     "Ain\u2019t I a Woman?"),

    # Eugene V. Debs
    ("Statement_to_the_Court_Upon_Being_Convicted_of_Violating_the_Sedition_Act",
     "eugene-debs", "1918-09-18",
     "Statement to the Court Upon Being Convicted of Violating the Sedition Act"),

    # Robert F. Kennedy
    ("Robert_F._Kennedy%27s_Speech_on_the_Assassination_of_Martin_Luther_King_Jr.",
     "robert-f-kennedy", "1968-04-04",
     "Speech on the Assassination of Martin Luther King Jr."),
]

# American Rhetoric speeches — URL path, speaker slug, date, title
# Text is public domain (Congressional proceedings / government speeches)
AMERICAN_RHETORIC_SPEECHES = [
    # Barbara Jordan — 1974 Impeachment Speech
    ("barbarajordanjudiciarystatement.htm",
     "barbara-jordan", "1974-07-25",
     "Statement on the Articles of Impeachment"),

    # Barbara Jordan — 1976 DNC Keynote
    ("barbarajordan1976dnc.htm",
     "barbara-jordan", "1976-07-12",
     "1976 Democratic National Convention Keynote Address"),

    # Margaret Chase Smith — Declaration of Conscience
    ("margaretchasesmithconscience.htm",
     "margaret-chase-smith", "1950-06-01",
     "Declaration of Conscience"),

    # Shirley Chisholm — Equal Rights Amendment
    ("shirleychisholmequalrights.htm",
     "shirley-chisholm", "1970-08-10",
     "For the Equal Rights Amendment"),

    # Shirley Chisholm — Presidential Candidacy
    ("shirleychisholm1972presidentialcampaignannouncement.htm",
     "shirley-chisholm", "1972-01-25",
     "Presidential Campaign Announcement"),

    # Ted Kennedy — 1980 DNC
    ("tedkennedy1980dnc.htm",
     "ted-kennedy", "1980-08-12",
     "1980 Democratic National Convention Address"),

    # Hubert Humphrey — Civil Rights
    ("huberthumphey1948dnc.htm",
     "hubert-humphrey", "1948-07-14",
     "1948 Democratic National Convention Address on Civil Rights"),

    # Robert Byrd — Against Iraq War
    ("robertbyrdiraqfloorstatement.htm",
     "robert-byrd", "2003-02-12",
     "We Stand Passively Mute — Against the Iraq War Resolution"),

    # Everett Dirksen — Civil Rights Act
    ("everettdaborndirksen.htm",
     "everett-dirksen", "1964-06-10",
     "Speech in Support of the Civil Rights Act"),
]

# Curated speeches available as direct text (entered manually from public domain sources)
DIRECT_SPEECHES = [
    {
        "speaker": "john-lewis",
        "date": "1963-08-28",
        "title": "Speech at the March on Washington",
        "source_url": "https://voicesofdemocracy.umd.edu/lewis-speech-at-the-march-on-washington-speech-text/",
        "source_name": "voices_of_democracy",
        "type": "speech",
        "wikisource_page": "John_Lewis%27_Speech_at_the_March_on_Washington",
    },
]


def import_wikisource_speeches():
    """Import Congressional speeches from WikiSource."""
    print("Importing Congressional speeches from WikiSource...")
    records = []

    for page_title, speaker, date, title in WIKISOURCE_SPEECHES:
        time.sleep(0.5)
        print(f"  Fetching: {title} ({speaker})...", end=" ", flush=True)

        text = fetch_wikisource_page(page_title)
        if not text or len(text) < 100:
            print("SKIP (empty or too short)")
            continue

        source_url = f"https://en.wikisource.org/wiki/{page_title}"
        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": "floor_speech",
            "source_url": source_url,
            "source_name": "wikisource",
            "text": text,
            "title": title,
        })
        print(f"OK ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  WikiSource speeches: {len(records)} fetched, {inserted} processed")
    return records


def import_american_rhetoric_speeches():
    """Import speeches from American Rhetoric (text is public domain)."""
    print("\nImporting speeches from American Rhetoric...")
    records = []

    for url_path, speaker, date, title in AMERICAN_RHETORIC_SPEECHES:
        url = f"https://www.americanrhetoric.com/speeches/{url_path}"
        cache_file = f"congress_ar_{url_path.replace('/', '_')}"
        print(f"  Fetching: {title} ({speaker})...", end=" ", flush=True)

        try:
            html = read_local_or_fetch(cache_file, url)
            text = extract_american_rhetoric(html)

            if not text:
                print("SKIP (could not extract text)")
                continue

            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": "floor_speech",
                "source_url": url,
                "source_name": "american_rhetoric",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(1)

    if records:
        inserted = bulk_insert(records)
        print(f"  American Rhetoric: {len(records)} fetched, {inserted} processed")
    return records


def import_direct_speeches():
    """Import speeches with known WikiSource pages."""
    print("\nImporting direct-source speeches...")
    records = []

    for speech in DIRECT_SPEECHES:
        ws_page = speech.get("wikisource_page")
        if ws_page:
            time.sleep(0.5)
            print(f"  Fetching: {speech['title']}...", end=" ", flush=True)
            text = fetch_wikisource_page(ws_page)
            if text and len(text) > 100:
                records.append({
                    "id": make_id(speech["speaker"], text),
                    "speaker": speech["speaker"],
                    "date": speech["date"],
                    "type": speech["type"],
                    "source_url": speech["source_url"],
                    "source_name": "wikisource",
                    "text": text,
                    "title": speech["title"],
                })
                print(f"OK ({len(text)} chars)")
            else:
                print("SKIP (empty or too short)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Direct speeches: {len(records)} fetched, {inserted} processed")
    return records


def import_webster_gutenberg():
    """Import Daniel Webster speeches from Gutenberg.

    'The Great Speeches and Orations of Daniel Webster' (Gutenberg 12606)
    """
    print("\nImporting Webster speeches from Gutenberg 12606...")
    url = "https://www.gutenberg.org/cache/epub/12606/pg12606.txt"

    try:
        raw = read_local_or_fetch("webster_12606.txt", url)
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    content = strip_gutenberg(raw)

    # Split into individual speeches/orations by major section headers
    # The book uses ALL-CAPS titles for each speech
    sections = re.split(r'\n{3,}(?=[A-Z][A-Z\s,\'\-]{15,}\n)', content)

    records = []
    speaker = "daniel-webster"

    for section in sections[1:]:  # Skip intro
        lines = section.strip().split('\n')
        if not lines:
            continue

        # Extract title from first non-empty uppercase lines
        title_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                break
            if stripped.isupper() or (len(stripped) > 5 and sum(1 for c in stripped if c.isupper()) > len(stripped) * 0.6):
                title_lines.append(stripped)
            else:
                break

        if not title_lines:
            continue

        title = " ".join(title_lines).strip()
        if len(title) < 5 or title.startswith("***"):
            continue

        text = section.strip()
        if len(text) < 300:
            continue

        # Try to extract date from text (Webster's dates are in introductory notes)
        date_match = re.search(r'(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})', text[:500])
        date = None
        if date_match:
            try:
                from datetime import datetime
                for fmt in ("%B %d, %Y", "%B %d %Y"):
                    try:
                        dt = datetime.strptime(date_match.group(1).replace(",", ""), "%B %d %Y")
                        date = dt.strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        continue
            except Exception:
                pass

        if not date:
            year_match = re.search(r'\b(1[78]\d{2})\b', text[:500])
            if year_match:
                date = f"{year_match.group(1)}-01-01"

        rec_type = "floor_speech"
        title_lower = title.lower()
        if "letter" in title_lower:
            rec_type = "letter"
        elif "address" in title_lower:
            rec_type = "address"

        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": rec_type,
            "source_url": "https://www.gutenberg.org/ebooks/12606",
            "source_name": "project_gutenberg",
            "text": text,
            "title": title[:200],
        })
        print(f"  Parsed: {title[:60]}... ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Webster speeches: {len(records)} parsed, {inserted} processed")
    return records


def import_clay_gutenberg():
    """Import Henry Clay speeches from Gutenberg.

    'Life and Speeches of Henry Clay, Vol. 2' (Gutenberg 21691)
    """
    print("\nImporting Clay speeches from Gutenberg 21691...")
    url = "https://www.gutenberg.org/cache/epub/21691/pg21691.txt"

    try:
        raw = read_local_or_fetch("clay_21691.txt", url)
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    content = strip_gutenberg(raw)
    speaker = "henry-clay"

    # Split by chapter/speech headers
    sections = re.split(r'\n{3,}(?=CHAPTER [IVXLC]+)', content)

    records = []
    for section in sections:
        match = re.match(r'CHAPTER ([IVXLC]+)', section.strip())
        if not match:
            continue

        text = section.strip()
        if len(text) < 500:
            continue

        # Extract title from lines after "CHAPTER X"
        lines = text.split('\n')
        title = f"Life and Speeches of Henry Clay, Chapter {match.group(1)}"
        for line in lines[1:5]:
            stripped = line.strip()
            if stripped and not stripped.startswith("CHAPTER"):
                title = stripped
                break

        # Extract date
        year_match = re.search(r'\b(1[78]\d{2})\b', text[:500])
        date = f"{year_match.group(1)}-01-01" if year_match else None

        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": "floor_speech",
            "source_url": "https://www.gutenberg.org/ebooks/21691",
            "source_name": "project_gutenberg",
            "text": text,
            "title": title[:200],
        })
        print(f"  Parsed: {title[:60]}... ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Clay speeches: {len(records)} parsed, {inserted} processed")
    return records


def import_debs_speeches():
    """Import Eugene V. Debs speeches from WikiSource.

    Debs' major speeches are on WikiSource as individual transcriptions.
    """
    print("\nImporting Debs speeches from WikiSource...")
    speaker = "eugene-debs"

    debs_pages = [
        ("Eugene_V._Debs%27_Canton,_Ohio_Speech",
         "1918-06-16", "speech",
         "Canton, Ohio Anti-War Speech"),
    ]

    records = []
    for page_title, date, rec_type, title in debs_pages:
        time.sleep(0.5)
        print(f"  Fetching: {title}...", end=" ", flush=True)
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

    if records:
        inserted = bulk_insert(records)
        print(f"  Debs speeches: {len(records)} fetched, {inserted} processed")
    return records


def main():
    total = 0

    ws = import_wikisource_speeches()
    total += len(ws)

    ar = import_american_rhetoric_speeches()
    total += len(ar)

    direct = import_direct_speeches()
    total += len(direct)

    webster = import_webster_gutenberg()
    total += len(webster)

    clay = import_clay_gutenberg()
    total += len(clay)

    debs = import_debs_speeches()
    total += len(debs)

    print(f"\n{'='*60}")
    print(f"Total Congressional/political records imported: {total}")


if __name__ == "__main__":
    main()

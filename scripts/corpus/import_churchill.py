#!/usr/bin/env python3
"""Import Winston Churchill speeches and writings into the verbatim corpus.

Sources:
- WikiSource (major speeches, wartime letters)
- Project Gutenberg (books/essays where individual chapters make sense)

All works are public domain (UK Crown Copyright expired, or PD-US per date).
"""

import re
import sys
import time

import requests

from ingest import bulk_insert, make_id, user_agent

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": user_agent()
})

SPEAKER = "winston-churchill"

# WikiSource speeches — page title, date, record type, human title
WIKISOURCE_SPEECHES = [
    ("Blood,_Toil,_Tears_and_Sweat", "1940-05-13", "speech", "Blood, Toil, Tears and Sweat"),
    ("We_shall_fight_on_the_beaches", "1940-06-04", "speech", "We Shall Fight on the Beaches"),
    ("Their_Finest_Hour", "1940-06-18", "speech", "Their Finest Hour"),
    ("The_Few", "1940-08-20", "speech", "The Few"),
    ("Churchill's_First_Radio_Address_as_Prime_Minister", "1940-05-19", "speech", "First Radio Address as Prime Minister"),
    ("Winston_Churchill_announces_the_Surrender_of_Germany", "1945-05-08", "speech", "Announcement of the Surrender of Germany"),
    ("Churchill's_1919_War_Office_Memorandum", "1919-01-01", "memo", "War Office Memorandum"),
]

# WikiSource letters (Churchill to FDR, etc.)
WIKISOURCE_LETTERS = [
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(March_17,_1941)", "1941-03-17", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(May_18,_1940)", "1940-05-18", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(June_13,_1940)", "1940-06-13", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(June_17,_1940)", "1940-06-17", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(September_24,_1940)", "1940-09-24", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(November,_1940)", "1940-11-01", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(November_16,_1940)", "1940-11-16", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(November_23,_1940)", "1940-11-23", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(December,_1940)", "1940-12-01", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(January,_1941)", "1941-01-01", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(April_2,_1941)", "1941-04-02", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Franklin_D._Roosevelt_(May_29,_1941)", "1941-05-29", "letter", "Letter to Franklin D. Roosevelt"),
    ("Winston_Churchill_to_Harry_Hopkins_(September_10,_1941)", "1941-09-10", "letter", "Letter to Harry Hopkins"),
]

# Great Speeches of the War (1914) — Churchill's WWI speeches on WikiSource
WIKISOURCE_WWI = [
    ("Great_Speeches_of_the_War/Churchill_(1)", None, "speech", "Great Speeches of the War — Speech 1"),
    ("Great_Speeches_of_the_War/Churchill_(2)", None, "speech", "Great Speeches of the War — Speech 2"),
    ("Great_Speeches_of_the_War/Churchill_(3)", None, "speech", "Great Speeches of the War — Speech 3"),
]


def strip_wikitext(raw):
    """Convert WikiSource wikitext to plain text."""
    # Remove header templates
    text = re.sub(r'\{\{header[^}]*\}\}', '', raw, flags=re.IGNORECASE | re.DOTALL)
    # Remove other templates
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    # Remove categories
    text = re.sub(r'\[\[Category:[^\]]*\]\]', '', text)
    # Remove interwiki links
    text = re.sub(r'\[\[[a-z]{2,3}:[^\]]*\]\]', '', text)
    # Convert wiki links to plain text: [[link|display]] -> display, [[link]] -> link
    text = re.sub(r'\[\[[^\]]*\|([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]]*)\]\]', r'\1', text)
    # Remove bold/italic markup
    text = re.sub(r"'{2,}", '', text)
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove section headers (== Title ==)
    text = re.sub(r'^=+\s*(.*?)\s*=+$', r'\1', text, flags=re.MULTILINE)
    # Clean up whitespace
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
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        return strip_wikitext(wikitext)
    except Exception as e:
        print(f"  ERROR fetching {page_title}: {e}")
        return None


def import_wikisource_entries(entries, label="speeches"):
    """Import a list of WikiSource entries."""
    print(f"\nImporting Churchill {label} from WikiSource...")
    records = []

    for page_title, date, rec_type, title in entries:
        time.sleep(0.5)  # Be polite to WikiSource
        print(f"  Fetching: {title}...", end=" ", flush=True)

        text = fetch_wikisource_page(page_title)
        if not text or len(text) < 50:
            print("SKIP (empty or too short)")
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

    if records:
        inserted = bulk_insert(records)
        print(f"  {label}: {len(records)} fetched, {inserted} processed")
    return records


# Speeches that aren't on WikiSource but are public domain and widely available.
# Text transcribed from public domain sources.
CANONICAL_SPEECHES = [
    {
        "date": "1946-03-05",
        "type": "speech",
        "title": "The Sinews of Peace (Iron Curtain Speech)",
        "source_url": "https://winstonchurchill.org/resources/speeches/1946-1963-elder-statesman/the-sinews-of-peace/",
        "source_name": "international_churchill_society",
        "text": None,  # Will be fetched
    },
    {
        "date": "1941-06-22",
        "type": "speech",
        "title": "The Fourth Climacteric (Response to German Invasion of Russia)",
        "source_url": "https://winstonchurchill.org/resources/speeches/1941-1945-war-leader/the-fourth-climacteric/",
        "source_name": "international_churchill_society",
        "text": None,
    },
    {
        "date": "1942-11-10",
        "type": "speech",
        "title": "The End of the Beginning",
        "source_url": "https://winstonchurchill.org/resources/speeches/1941-1945-war-leader/the-end-of-the-beginning/",
        "source_name": "international_churchill_society",
        "text": None,
    },
    {
        "date": "1943-09-06",
        "type": "speech",
        "title": "The Price of Greatness Is Responsibility",
        "source_url": "https://winstonchurchill.org/resources/speeches/1941-1945-war-leader/the-price-of-greatness-is-responsibility/",
        "source_name": "international_churchill_society",
        "text": None,
    },
]


def fetch_churchill_society_speech(url):
    """Attempt to fetch speech text from the International Churchill Society."""
    try:
        resp = SESSION.get(url, timeout=30)
        resp.raise_for_status()
        html = resp.text

        # Extract main content — their pages have speech text in article body
        # Try to get text between common markers
        # Remove HTML tags for plain text
        from html.parser import HTMLParser
        import io

        class TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.result = []
                self.in_content = False
                self.depth = 0

            def handle_starttag(self, tag, attrs):
                attrs_dict = dict(attrs)
                cls = attrs_dict.get("class", "")
                if tag == "div" and ("entry-content" in cls or "speech-content" in cls or "post-content" in cls):
                    self.in_content = True
                    self.depth = 0
                if self.in_content and tag == "div":
                    self.depth += 1

            def handle_endtag(self, tag):
                if self.in_content and tag == "div":
                    self.depth -= 1
                    if self.depth <= 0:
                        self.in_content = False

            def handle_data(self, data):
                if self.in_content:
                    self.result.append(data)

        parser = TextExtractor()
        parser.feed(html)
        text = " ".join(parser.result).strip()

        # Clean up
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r' +', ' ', text)
        # Re-add paragraph breaks at sentence boundaries after periods
        # This is imperfect but better than one massive paragraph
        text = text.replace('. ', '.\n\n')

        if len(text) > 200:
            return text
        return None
    except Exception as e:
        print(f"  ERROR: {e}")
        return None


def import_canonical_speeches():
    """Import well-known speeches from the International Churchill Society."""
    print("\nImporting canonical Churchill speeches...")
    records = []

    for speech in CANONICAL_SPEECHES:
        title = speech["title"]
        print(f"  Fetching: {title}...", end=" ", flush=True)
        time.sleep(1)

        text = fetch_churchill_society_speech(speech["source_url"])
        if not text:
            print("SKIP (could not extract text)")
            continue

        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
            "date": speech["date"],
            "type": speech["type"],
            "source_url": speech["source_url"],
            "source_name": speech["source_name"],
            "text": text,
            "title": title,
        })
        print(f"OK ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Canonical speeches: {len(records)} fetched, {inserted} processed")
    return records


def import_gutenberg_liberalism():
    """Import chapters from 'Liberalism and the Social Problem' (Gutenberg 18419).

    This is a collection of Churchill's political speeches from 1906-1909,
    each chapter is a separate speech.
    """
    print("\nImporting 'Liberalism and the Social Problem' from Gutenberg...")
    url = "https://www.gutenberg.org/cache/epub/18419/pg18419.txt"

    try:
        resp = SESSION.get(url, timeout=60)
        resp.raise_for_status()
        raw = resp.text.replace('\r\n', '\n')  # Normalize line endings
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    # Find start/end of actual content
    start = raw.find("LIBERALISM AND THE SOCIAL PROBLEM")
    if start == -1:
        start = 0

    end = len(raw)
    for marker in ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]:
        pos = raw.find(marker, start)
        if pos != -1:
            end = pos
            break

    content = raw[start:end]

    # Split into chapters — each is a speech
    # Pattern: chapter headings are in ALL CAPS, preceded by blank lines. One
    # ends in a period ("THE BUDGET AND PROPERTY."), so a period is allowed.
    chapters = re.split(r'\n\n\n+(?=[A-Z][A-Z\s,\':—\-]{10,}\.?\n)', content)

    records = []
    speech_dates = {
        "THE PEOPLE'S RIGHTS": "1909-01-01",
        "THE LIBERALISM OF TO-DAY": "1906-01-01",
        "TRADE UNIONS": "1907-01-01",
        "THE DUNDEE ELECTION": "1908-05-01",
    }

    for chunk in chapters[1:]:  # Skip preamble
        lines = chunk.strip().split('\n')
        if not lines:
            continue

        # First non-empty lines are the title
        title_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                break
            if stripped.isupper() or (len(stripped) > 5 and stripped[0].isupper()):
                title_lines.append(stripped)
            else:
                break

        if not title_lines:
            continue

        title = " ".join(title_lines).strip().rstrip(".")
        if len(title) < 5 or title.startswith("***"):
            continue

        text = chunk.strip()
        if len(text) < 200:
            continue

        # Try to find date from title mapping or default
        date = speech_dates.get(title, "1909-01-01")

        records.append({
            "id": make_id(SPEAKER, text),
            "speaker": SPEAKER,
            "date": date,
            "type": "speech",
            "source_url": "https://www.gutenberg.org/ebooks/18419",
            "source_name": "project_gutenberg",
            "text": text,
            "title": title[:200],
        })
        print(f"  Parsed: {title[:60]}... ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"  Liberalism chapters: {len(records)} parsed, {inserted} processed")
    return records


def main():
    total = 0

    # WikiSource speeches (the wartime greats)
    speeches = import_wikisource_entries(WIKISOURCE_SPEECHES, "major speeches")
    total += len(speeches)

    # WikiSource letters (Churchill-FDR correspondence)
    letters = import_wikisource_entries(WIKISOURCE_LETTERS, "wartime letters")
    total += len(letters)

    # WikiSource WWI speeches
    wwi = import_wikisource_entries(WIKISOURCE_WWI, "WWI speeches")
    total += len(wwi)

    # International Churchill Society canonical speeches
    canonical = import_canonical_speeches()
    total += len(canonical)

    # Gutenberg: Liberalism and the Social Problem
    gutenberg = import_gutenberg_liberalism()
    total += len(gutenberg)

    print(f"\n{'='*60}")
    print(f"Total Churchill records imported: {total}")


if __name__ == "__main__":
    main()

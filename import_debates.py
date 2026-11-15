#!/usr/bin/env python3
"""Import presidential debate transcripts into the verbatim corpus.

Sources:
- UCSB American Presidency Project (presidency.ucsb.edu)
  All debate transcripts are public domain government documents.

Covers all general election presidential and VP debates, 1960-2024.
Each debate is stored as a full transcript record with type 'debate'.
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
    resp = SESSION.get(url, timeout=60)
    resp.raise_for_status()
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(resp.text)
    return resp.text


def extract_ucsb_transcript(html):
    """Extract transcript text from a UCSB Presidency Project page."""
    soup = BeautifulSoup(html, "html.parser")
    # Transcript body is in .field-docs-content
    content = soup.select_one(".field-docs-content")
    if not content:
        content = soup.select_one('[class*="transcript"]')
    if not content:
        content = soup.select_one("article")
    if not content:
        return None
    text = content.get_text(separator="\n\n").strip()
    # Clean up excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text if len(text) > 200 else None


# Curated list of all general election presidential and VP debates.
# Format: (slug, date, title, speakers_desc)
# slugs are the UCSB American Presidency Project URL path component
PRESIDENTIAL_DEBATES = [
    # 1960 Kennedy-Nixon
    ("presidential-debate-chicago", "1960-09-26",
     "First Kennedy-Nixon Presidential Debate",
     "Kennedy vs. Nixon"),
    ("presidential-debate-washington-dc", "1960-10-07",
     "Second Kennedy-Nixon Presidential Debate",
     "Kennedy vs. Nixon"),
    ("presidential-debate-broadcast-from-new-york-and-los-angeles", "1960-10-13",
     "Third Kennedy-Nixon Presidential Debate",
     "Kennedy vs. Nixon"),
    ("presidential-debate-new-york", "1960-10-21",
     "Fourth Kennedy-Nixon Presidential Debate",
     "Kennedy vs. Nixon"),

    # 1976 Carter-Ford
    ("presidential-debate-philadelphia", "1976-09-23",
     "First Carter-Ford Presidential Debate",
     "Carter vs. Ford"),
    ("presidential-debate-san-francisco", "1976-10-06",
     "Second Carter-Ford Presidential Debate",
     "Carter vs. Ford"),
    ("presidential-debate-williamsburg-virginia", "1976-10-22",
     "Third Carter-Ford Presidential Debate",
     "Carter vs. Ford"),

    # 1976 VP debate
    ("vice-presidential-debate-houston-texas", "1976-10-15",
     "Mondale-Dole Vice Presidential Debate",
     "Mondale vs. Dole"),

    # 1980 Reagan-Anderson, Reagan-Carter
    ("presidential-debate-baltimore", "1980-09-21",
     "Anderson-Reagan Presidential Debate",
     "Anderson vs. Reagan"),
    ("presidential-debate-cleveland-1", "1980-10-28",
     "Carter-Reagan Presidential Debate",
     "Carter vs. Reagan"),

    # 1984 Reagan-Mondale
    ("presidential-debate-louisville-kentucky", "1984-10-07",
     "First Reagan-Mondale Presidential Debate",
     "Reagan vs. Mondale"),
    ("presidential-debate-kansas-city-missouri", "1984-10-21",
     "Second Reagan-Mondale Presidential Debate",
     "Reagan vs. Mondale"),

    # 1984 VP debate
    ("vice-presidential-debate-philadelphia-pennsylvania", "1984-10-11",
     "Bush-Ferraro Vice Presidential Debate",
     "Bush vs. Ferraro"),

    # 1988 Bush-Dukakis
    ("presidential-debate-winston-salem-north-carolina", "1988-09-25",
     "First Bush-Dukakis Presidential Debate",
     "Bush vs. Dukakis"),
    ("presidential-debate-los-angeles", "1988-10-13",
     "Second Bush-Dukakis Presidential Debate",
     "Bush vs. Dukakis"),

    # 1988 VP debate
    ("vice-presidential-debate-omaha-nebraska", "1988-10-05",
     "Bentsen-Quayle Vice Presidential Debate",
     "Bentsen vs. Quayle"),

    # 1992 Bush-Clinton-Perot
    ("presidential-debate-st-louis-missouri", "1992-10-11",
     "First Bush-Clinton-Perot Presidential Debate",
     "Bush vs. Clinton vs. Perot"),
    ("presidential-debate-richmond-virginia", "1992-10-15",
     "Second Bush-Clinton-Perot Presidential Debate",
     "Bush vs. Clinton vs. Perot"),
    ("presidential-debate-east-lansing-michigan", "1992-10-19",
     "Third Bush-Clinton-Perot Presidential Debate",
     "Bush vs. Clinton vs. Perot"),

    # 1992 VP debate
    ("vice-presidential-debate-atlanta-georgia", "1992-10-13",
     "Gore-Quayle-Stockdale Vice Presidential Debate",
     "Gore vs. Quayle vs. Stockdale"),

    # 1996 Clinton-Dole
    ("presidential-debate-hartford-connecticut", "1996-10-06",
     "First Clinton-Dole Presidential Debate",
     "Clinton vs. Dole"),
    ("presidential-debate-san-diego-california", "1996-10-16",
     "Second Clinton-Dole Presidential Debate",
     "Clinton vs. Dole"),

    # 1996 VP debate
    ("vice-presidential-debate-st-petersburg-florida", "1996-10-09",
     "Gore-Kemp Vice Presidential Debate",
     "Gore vs. Kemp"),

    # 2000 Bush-Gore
    ("presidential-debate-boston-massachusetts", "2000-10-03",
     "First Bush-Gore Presidential Debate",
     "Bush vs. Gore"),
    ("presidential-debate-winston-salem-north-carolina-0", "2000-10-11",
     "Second Bush-Gore Presidential Debate",
     "Bush vs. Gore"),
    ("presidential-debate-st-louis-missouri-0", "2000-10-17",
     "Third Bush-Gore Presidential Debate",
     "Bush vs. Gore"),

    # 2000 VP debate
    ("vice-presidential-debate-danville-kentucky", "2000-10-05",
     "Cheney-Lieberman Vice Presidential Debate",
     "Cheney vs. Lieberman"),

    # 2004 Bush-Kerry
    ("presidential-debate-coral-gables-florida", "2004-09-30",
     "First Bush-Kerry Presidential Debate",
     "Bush vs. Kerry"),
    ("presidential-debate-st-louis-missouri-1", "2004-10-08",
     "Second Bush-Kerry Presidential Debate",
     "Bush vs. Kerry"),
    ("presidential-debate-tempe-arizona", "2004-10-13",
     "Third Bush-Kerry Presidential Debate",
     "Bush vs. Kerry"),

    # 2004 VP debate
    ("vice-presidential-debate-cleveland-ohio", "2004-10-05",
     "Cheney-Edwards Vice Presidential Debate",
     "Cheney vs. Edwards"),

    # 2008 Obama-McCain
    ("presidential-debate-university-mississippi", "2008-09-26",
     "First Obama-McCain Presidential Debate",
     "Obama vs. McCain"),
    ("presidential-debate-belmont-university-nashville-tennessee", "2008-10-07",
     "Second Obama-McCain Presidential Debate",
     "Obama vs. McCain"),
    ("presidential-debate-hofstra-university-hempstead-new-york", "2008-10-15",
     "Third Obama-McCain Presidential Debate",
     "Obama vs. McCain"),

    # 2008 VP debate
    ("vice-presidential-debate-washington-university-st-louis-missouri", "2008-10-02",
     "Biden-Palin Vice Presidential Debate",
     "Biden vs. Palin"),

    # 2012 Obama-Romney
    ("presidential-debate-university-denver-denver-colorado", "2012-10-03",
     "First Obama-Romney Presidential Debate",
     "Obama vs. Romney"),
    ("presidential-debate-hofstra-university-hempstead-new-york-0", "2012-10-16",
     "Second Obama-Romney Presidential Debate",
     "Obama vs. Romney"),
    ("presidential-debate-lynn-university-boca-raton-florida", "2012-10-22",
     "Third Obama-Romney Presidential Debate",
     "Obama vs. Romney"),

    # 2012 VP debate
    ("vice-presidential-debate-centre-college-danville-kentucky", "2012-10-11",
     "Biden-Ryan Vice Presidential Debate",
     "Biden vs. Ryan"),

    # 2016 Clinton-Trump
    ("presidential-debate-hofstra-university-hempstead-new-york-1", "2016-09-26",
     "First Clinton-Trump Presidential Debate",
     "Clinton vs. Trump"),
    ("presidential-debate-washington-university-st-louis-missouri", "2016-10-09",
     "Second Clinton-Trump Presidential Debate",
     "Clinton vs. Trump"),
    ("presidential-debate-university-nevada-las-vegas", "2016-10-19",
     "Third Clinton-Trump Presidential Debate",
     "Clinton vs. Trump"),

    # 2016 VP debate
    ("vice-presidential-debate-longwood-university-farmville-virginia", "2016-10-04",
     "Kaine-Pence Vice Presidential Debate",
     "Kaine vs. Pence"),

    # 2020 Biden-Trump
    ("presidential-debate-case-western-reserve-university-cleveland-ohio", "2020-09-29",
     "First Biden-Trump Presidential Debate",
     "Biden vs. Trump"),
    ("presidential-debate-belmont-university-nashville-tennessee-0", "2020-10-22",
     "Second Biden-Trump Presidential Debate",
     "Biden vs. Trump"),

    # 2020 VP debate
    ("vice-presidential-debate-university-utah-salt-lake-city", "2020-10-07",
     "Harris-Pence Vice Presidential Debate",
     "Harris vs. Pence"),

    # 2024 Biden/Harris-Trump
    ("presidential-debate-atlanta-georgia", "2024-06-27",
     "Biden-Trump Presidential Debate",
     "Biden vs. Trump"),
    ("presidential-debate-philadelphia-pennsylvania", "2024-09-10",
     "Harris-Trump Presidential Debate",
     "Harris vs. Trump"),

    # 2024 VP debate
    ("vice-presidential-debate-new-york-city", "2024-10-01",
     "Vance-Walz Vice Presidential Debate",
     "Vance vs. Walz"),
]


def import_debates(dry_run=False):
    """Import all presidential debate transcripts."""
    print(f"Importing {len(PRESIDENTIAL_DEBATES)} presidential debate transcripts...")

    if dry_run:
        print("\nDry run — would import:")
        for slug, date, title, speakers in PRESIDENTIAL_DEBATES:
            print(f"  {date}: {title} ({speakers})")
        print(f"\nTotal: {len(PRESIDENTIAL_DEBATES)} debates")
        return len(PRESIDENTIAL_DEBATES)

    records = []
    errors = []

    for slug, date, title, speakers in PRESIDENTIAL_DEBATES:
        url = f"https://www.presidency.ucsb.edu/documents/{slug}"
        cache_file = f"debate_{slug}.html"
        print(f"  {date}: {title}...", end=" ", flush=True)

        try:
            html = read_local_or_fetch(cache_file, url)
            text = extract_ucsb_transcript(html)

            if not text:
                print("SKIP (could not extract transcript)")
                errors.append(slug)
                continue

            # Use a generic speaker slug for debates (full transcript)
            # Speaker is the debate event itself for searchability
            speaker_parts = speakers.lower().replace(" vs. ", "-vs-").replace(" ", "-")
            year = date[:4]
            speaker_slug = f"debate-{year}-{speaker_parts}"

            records.append({
                "id": make_id(speaker_slug, text),
                "speaker": speaker_slug,
                "date": date,
                "type": "debate",
                "source_url": url,
                "source_name": "ucsb_american_presidency_project",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        except Exception as e:
            print(f"ERROR: {e}")
            errors.append(slug)

        time.sleep(2)  # Respect UCSB's servers

    if records:
        inserted = bulk_insert(records)
        print(f"\nDebates: {len(records)} fetched, {inserted} processed")

    if errors:
        print(f"\nErrors ({len(errors)}): {', '.join(errors)}")

    return records


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Import presidential debate transcripts")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported")
    args = parser.parse_args()

    records = import_debates(dry_run=args.dry_run)
    count = len(records) if isinstance(records, list) else records
    print(f"\nDone. {count} debate transcripts {'would be imported' if args.dry_run else 'processed'}.")


if __name__ == "__main__":
    main()

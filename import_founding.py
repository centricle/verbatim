#!/usr/bin/env python3
"""Import founding documents into the verbatim corpus."""

import os
import re
import sys

import requests

from ingest import add_record, make_id, bulk_insert

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) verbatim-corpus/0.1"
})

# Federalist Papers authorship (essay number → speaker slug)
# Based on the scholarly consensus. Disputed papers assigned to likely author.
FED_AUTHORS = {}
# Hamilton: 1, 6-9, 11-13, 15-17, 21-36, 59-61, 65-85
for n in [1] + list(range(6, 10)) + list(range(11, 14)) + list(range(15, 18)) + list(range(21, 37)) + list(range(59, 62)) + list(range(65, 86)):
    FED_AUTHORS[n] = "alexander-hamilton"
# Madison: 10, 14, 37-58, 62-63
for n in [10, 14] + list(range(37, 59)) + [62, 63]:
    FED_AUTHORS[n] = "james-madison"
# Jay: 2-5, 64
for n in [2, 3, 4, 5, 64]:
    FED_AUTHORS[n] = "john-jay"
# Hamilton & Madison jointly: 18-20
for n in [18, 19, 20]:
    FED_AUTHORS[n] = "alexander-hamilton"  # Primary author per most scholarship

# Approximate publication dates (month/year from historical record)
FED_DATES = {
    1: "1787-10-27", 2: "1787-10-31", 3: "1787-11-03", 4: "1787-11-07",
    5: "1787-11-10", 6: "1787-11-14", 7: "1787-11-15", 8: "1787-11-20",
    9: "1787-11-21", 10: "1787-11-22", 11: "1787-11-24", 12: "1787-11-27",
    13: "1787-11-28", 14: "1787-11-30", 15: "1787-12-01", 16: "1787-12-04",
    17: "1787-12-05", 18: "1787-12-07", 19: "1787-12-08", 20: "1787-12-11",
    21: "1787-12-12", 22: "1787-12-14", 23: "1787-12-18", 24: "1787-12-19",
    25: "1787-12-21", 26: "1787-12-22", 27: "1787-12-25", 28: "1787-12-26",
    29: "1788-01-09", 30: "1787-12-28", 31: "1788-01-01", 32: "1788-01-02",
    33: "1788-01-02", 34: "1788-01-04", 35: "1788-01-05", 36: "1788-01-08",
    37: "1788-01-11", 38: "1788-01-12", 39: "1788-01-16", 40: "1788-01-18",
    41: "1788-01-19", 42: "1788-01-22", 43: "1788-01-23", 44: "1788-01-25",
    45: "1788-01-26", 46: "1788-01-29", 47: "1788-01-30", 48: "1788-02-01",
    49: "1788-02-02", 50: "1788-02-05", 51: "1788-02-06", 52: "1788-02-08",
    53: "1788-02-09", 54: "1788-02-12", 55: "1788-02-13", 56: "1788-02-16",
    57: "1788-02-19", 58: "1788-02-20", 59: "1788-02-22", 60: "1788-02-23",
    61: "1788-02-26", 62: "1788-02-27", 63: "1788-03-01", 64: "1788-03-05",
    65: "1788-03-07", 66: "1788-03-08", 67: "1788-03-11", 68: "1788-03-12",
    69: "1788-03-14", 70: "1788-03-15", 71: "1788-03-18", 72: "1788-03-19",
    73: "1788-03-21", 74: "1788-03-25", 75: "1788-03-26", 76: "1788-04-01",
    77: "1788-04-02", 78: "1788-05-28", 79: "1788-05-28", 80: "1788-05-28",
    81: "1788-05-28", 82: "1788-05-28", 83: "1788-05-28", 84: "1788-05-28",
    85: "1788-05-28",
}

SPEAKERS = {
    "alexander-hamilton": "Alexander Hamilton",
    "james-madison": "James Madison",
    "john-jay": "John Jay",
    "constitutional-convention": "Constitutional Convention",
    "continental-congress": "Continental Congress",
}


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


def import_federalist_papers():
    """Import all 85 Federalist Papers from Project Gutenberg."""
    print("Loading Federalist Papers...")
    raw = read_local_or_fetch("federalist.txt", "https://www.gutenberg.org/cache/epub/1404/pg1404.txt")

    # Split into individual papers
    # Pattern: "FEDERALIST No. XX" or "FEDERALIST. No. XX"
    papers = re.split(r'(?=FEDERALIST[.\s]+No\.\s+\d+)', raw, flags=re.IGNORECASE)

    records = []
    for chunk in papers:
        match = re.match(r'FEDERALIST[.\s]+No\.\s+(\d+)', chunk, re.IGNORECASE)
        if not match:
            continue

        num = int(match.group(1))
        if num < 1 or num > 85:
            continue

        # Clean up the text
        text = chunk.strip()
        # Remove Gutenberg header/footer artifacts if present
        text = re.sub(r'\*\*\*.*?\*\*\*', '', text)

        speaker = FED_AUTHORS.get(num, "alexander-hamilton")
        date = FED_DATES.get(num)

        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": "essay",
            "source_url": f"https://www.gutenberg.org/ebooks/1404",
            "source_name": "project_gutenberg",
            "text": text,
            "title": f"Federalist No. {num}",
        })
        print(f"  Parsed Federalist No. {num} ({SPEAKERS.get(speaker, speaker)})")

    if records:
        inserted = bulk_insert(records)
        print(f"\nFederalist Papers: {len(records)} essays parsed, {inserted} inserted")
    else:
        print("WARNING: No Federalist Papers found in text. Check parsing.")

    return records


def import_constitution():
    """Import US Constitution from Project Gutenberg."""
    print("\nLoading US Constitution...")
    raw = read_local_or_fetch("constitution.txt", "https://www.gutenberg.org/cache/epub/5/pg5.txt")

    # Strip Gutenberg header/footer
    start = raw.find("We the People")
    if start == -1:
        start = raw.find("WE THE PEOPLE")
    if start == -1:
        print("WARNING: Could not find Constitution text start marker")
        start = 0

    end_markers = ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]
    end = len(raw)
    for marker in end_markers:
        pos = raw.find(marker, start)
        if pos != -1:
            end = pos
            break

    text = raw[start:end].strip()

    if len(text) < 1000:
        print(f"WARNING: Constitution text suspiciously short ({len(text)} chars)")
        return []

    record = {
        "id": make_id("constitutional-convention", text),
        "speaker": "constitutional-convention",
        "date": "1787-09-17",
        "type": "founding_document",
        "source_url": "https://www.gutenberg.org/ebooks/5",
        "source_name": "project_gutenberg",
        "text": text,
        "title": "The Constitution of the United States of America",
    }

    result = add_record(record)
    if result:
        print(f"  Added: Constitution ({len(text)} chars)")
    else:
        print("  Skipped (duplicate or invalid)")

    return [record] if result else []


def import_bill_of_rights():
    """Import the Bill of Rights as a separate searchable record."""
    print("\nLoading Bill of Rights / Amendments...")
    raw = read_local_or_fetch("constitution.txt", "https://www.gutenberg.org/cache/epub/5/pg5.txt")

    # Try to extract amendments section
    amendments_start = re.search(r'(ARTICLES?\s+IN\s+ADDITION|AMENDMENT\s+[I1][\.\s])', raw, re.IGNORECASE)
    if amendments_start:
        text = raw[amendments_start.start():].strip()
        # Trim Gutenberg footer
        for marker in ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]:
            pos = text.find(marker)
            if pos != -1:
                text = text[:pos].strip()

        # Just the Bill of Rights (first 10)
        # Find where Amendment XI starts
        amend_11 = re.search(r'AMENDMENT\s+XI', text, re.IGNORECASE)
        if amend_11:
            bill_text = text[:amend_11.start()].strip()
        else:
            bill_text = text

        if len(bill_text) > 200:
            record = {
                "id": make_id("constitutional-convention", bill_text),
                "speaker": "constitutional-convention",
                "date": "1791-12-15",
                "type": "founding_document",
                "source_url": "https://www.gutenberg.org/ebooks/5",
                "source_name": "project_gutenberg",
                "text": bill_text,
                "title": "The Bill of Rights (Amendments I-X)",
            }
            result = add_record(record)
            if result:
                print(f"  Added: Bill of Rights ({len(bill_text)} chars)")
                return [record]
            else:
                print("  Skipped (duplicate or invalid)")

    print("  WARNING: Could not extract Bill of Rights section")
    return []


def import_declaration():
    """Import the Declaration of Independence."""
    print("\nLoading Declaration of Independence...")
    raw = read_local_or_fetch("declaration.txt", "https://www.gutenberg.org/cache/epub/1/pg1.txt")

    # Find the start of the actual text
    start_markers = ["IN CONGRESS", "In Congress", "When in the Course"]
    start = 0
    for marker in start_markers:
        pos = raw.find(marker)
        if pos != -1:
            start = pos
            break

    # Trim Gutenberg footer
    end = len(raw)
    for marker in ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]:
        pos = raw.find(marker, start)
        if pos != -1:
            end = pos
            break

    text = raw[start:end].strip()

    if len(text) < 500:
        print(f"WARNING: Declaration text suspiciously short ({len(text)} chars)")
        return []

    record = {
        "id": make_id("continental-congress", text),
        "speaker": "continental-congress",
        "date": "1776-07-04",
        "type": "founding_document",
        "source_url": "https://www.gutenberg.org/ebooks/1",
        "source_name": "project_gutenberg",
        "text": text,
        "title": "The Declaration of Independence",
    }

    result = add_record(record)
    if result:
        print(f"  Added: Declaration of Independence ({len(text)} chars)")
    else:
        print("  Skipped (duplicate or invalid)")

    return [record] if result else []


def main():
    total = 0
    total += len(import_federalist_papers())
    total += len(import_constitution())
    total += len(import_bill_of_rights())
    total += len(import_declaration())
    print(f"\n{'='*60}")
    print(f"Total founding documents imported: {total}")


if __name__ == "__main__":
    main()

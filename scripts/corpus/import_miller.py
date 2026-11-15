#!/usr/bin/env python3
"""Import presidential speeches from Miller Center (UVA) bulk JSON download."""

import argparse
import json
import os
import re
import sys
import tarfile
import tempfile

import requests
from bs4 import BeautifulSoup

from ingest import bulk_insert, make_id, validate_record, RAW_DIR
from scrape import SPEAKERS, classify_type

TGZ_URL = "https://data.millercenter.org/miller_center_speeches.tgz"
TMP_DIR = RAW_DIR

# Miller Center uses slightly different names for some presidents
SLUG_ALIASES = {
    "richard-m-nixon": "richard-nixon",
    "william-harrison": "william-henry-harrison",
    "william-taft": "william-howard-taft",
}


def download_tgz(url=TGZ_URL, dest_dir=TMP_DIR):
    """Download and extract the Miller Center tgz archive."""
    os.makedirs(dest_dir, exist_ok=True)
    tgz_path = os.path.join(dest_dir, "miller_center_speeches.tgz")

    if os.path.exists(tgz_path):
        print(f"Using cached archive: {tgz_path}")
    else:
        print(f"Downloading {url}...")
        resp = requests.get(url, stream=True, timeout=120)
        resp.raise_for_status()
        with open(tgz_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        size_mb = os.path.getsize(tgz_path) / (1024 * 1024)
        print(f"Downloaded {size_mb:.1f} MB to {tgz_path}")

    extract_dir = os.path.join(dest_dir, "miller_center")
    if not os.path.exists(extract_dir):
        print(f"Extracting to {extract_dir}...")
        with tarfile.open(tgz_path, "r:gz") as tar:
            tar.extractall(path=extract_dir)

    return extract_dir


def find_json_files(extract_dir):
    """Find all JSON files in the extracted archive."""
    json_files = []
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f.endswith(".json"):
                json_files.append(os.path.join(root, f))
    return json_files


def slugify(name):
    """Convert a display name to a speaker slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def strip_html(text):
    """Strip HTML tags from text, returning clean plaintext."""
    if not text:
        return ""
    if "<" in text and ">" in text:
        soup = BeautifulSoup(text, "html.parser")
        return soup.get_text(separator="\n\n").strip()
    return text.strip()


def load_all_speeches(extract_dir):
    """Load all individual JSON speech files into a list."""
    json_files = find_json_files(extract_dir)
    if not json_files:
        print("No JSON files found in archive.")
        return None

    print(f"\nFound {len(json_files)} JSON file(s)")

    # Each file is a single speech dict
    speeches = []
    for jf in json_files:
        try:
            with open(jf) as f:
                data = json.load(f)
            if isinstance(data, dict):
                speeches.append(data)
            elif isinstance(data, list):
                speeches.extend(data)
        except (json.JSONDecodeError, IOError):
            continue

    if speeches:
        sample = speeches[0]
        print(f"Fields: {list(sample.keys())}")
        print(f"\nSample record:")
        for k, v in sample.items():
            display = str(v)[:120] if v else "(empty)"
            print(f"  {k}: {display}")

    return speeches


def map_record(raw):
    """Map a Miller Center record to verbatim schema.

    Miller Center fields: title, doc_name, url, date, transcript,
    transcript_html, president, video, audio
    """
    speaker_name = raw.get("president", "")
    if not speaker_name:
        return None

    speaker = slugify(speaker_name)
    speaker = SLUG_ALIASES.get(speaker, speaker)

    # Prefer plain transcript over HTML version
    text = raw.get("transcript") or ""
    if not text:
        text = strip_html(raw.get("transcript_html", ""))
    else:
        text = strip_html(text)

    if not text or len(text) < 50:
        return None

    title = (raw.get("title") or "").strip()
    source_url = raw.get("url") or ""

    # Date comes as ISO 8601 with timezone — extract YYYY-MM-DD
    date = raw.get("date") or None
    if date:
        date = str(date).strip()[:10]

    stmt_type = classify_type(title) if title else "speech"

    return {
        "id": make_id(speaker, text),
        "speaker": speaker,
        "date": date,
        "type": stmt_type,
        "source_url": source_url,
        "source_name": "miller_center",
        "text": text,
        "title": title,
    }


def import_miller(dry_run=False, inspect_only=False):
    """Download, extract, and import Miller Center speeches."""
    extract_dir = download_tgz()
    data = load_all_speeches(extract_dir)

    if not data:
        print("Could not parse Miller Center data.")
        return 0

    if inspect_only:
        print(f"\nInspect complete. {len(data)} raw records found.")
        speakers = {}
        for raw in data:
            name = raw.get("president", "unknown")
            speakers[name] = speakers.get(name, 0) + 1
        print(f"\nSpeakers ({len(speakers)}):")
        for name, count in sorted(speakers.items(), key=lambda x: -x[1])[:20]:
            print(f"  {name}: {count}")
        if len(speakers) > 20:
            print(f"  ... and {len(speakers) - 20} more")
        return 0

    print(f"\nMapping {len(data)} records to verbatim schema...")
    records = []
    skipped = 0
    for raw in data:
        rec = map_record(raw)
        if rec:
            records.append(rec)
        else:
            skipped += 1

    print(f"Mapped {len(records)} records ({skipped} skipped — no speaker or insufficient text)")

    if dry_run:
        # Show what would be imported
        speakers = {}
        types = {}
        for rec in records:
            speakers[rec["speaker"]] = speakers.get(rec["speaker"], 0) + 1
            types[rec["type"]] = types.get(rec["type"], 0) + 1
        print(f"\nDry run — would import {len(records)} records:")
        print(f"\nBy speaker ({len(speakers)}):")
        for slug, count in sorted(speakers.items(), key=lambda x: -x[1])[:20]:
            name = SPEAKERS.get(slug, slug)
            print(f"  {name} ({slug}): {count}")
        if len(speakers) > 20:
            print(f"  ... and {len(speakers) - 20} more")
        print(f"\nBy type:")
        for t, count in sorted(types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {count}")
        return len(records)

    print(f"\nBulk inserting {len(records)} records...")
    inserted = bulk_insert(records)
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Import Miller Center presidential speeches")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported without inserting")
    parser.add_argument("--inspect", action="store_true", help="Download and inspect JSON structure only")
    args = parser.parse_args()

    count = import_miller(dry_run=args.dry_run, inspect_only=args.inspect)
    if not args.inspect:
        print(f"\nDone. {count} records {'would be imported' if args.dry_run else 'processed'}.")


if __name__ == "__main__":
    main()

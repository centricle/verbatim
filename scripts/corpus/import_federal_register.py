#!/usr/bin/env python3
"""Import executive orders and proclamations from the Federal Register API."""

import argparse
import json
import os
import sys
import time

import requests

from ingest import bulk_insert, make_id
from scrape import SPEAKERS

API_BASE = "https://www.federalregister.gov/api/v1"
PER_PAGE = 100
PAGE_DELAY = 0.5
TEXT_DELAY = 0.2

# Federal Register president identifiers → verbatim speaker slugs
# FR uses formal names; map to our canonical slugs
FR_PRESIDENT_SLUGS = {
    "franklin-d-roosevelt": "franklin-d-roosevelt",
    "harry-s-truman": "harry-s-truman",
    "dwight-d-eisenhower": "dwight-d-eisenhower",
    "john-f-kennedy": "john-f-kennedy",
    "lyndon-b-johnson": "lyndon-b-johnson",
    "richard-nixon": "richard-nixon",
    "gerald-r-ford": "gerald-ford",
    "gerald-ford": "gerald-ford",
    "jimmy-carter": "jimmy-carter",
    "ronald-reagan": "ronald-reagan",
    "george-h-w-bush": "george-h-w-bush",
    "george-bush": "george-h-w-bush",
    "william-j-clinton": "bill-clinton",
    "bill-clinton": "bill-clinton",
    "george-w-bush": "george-w-bush",
    "barack-obama": "barack-obama",
    "donald-trump": "donald-trump",
    "joe-biden": "joe-biden",
    "joseph-r-biden-jr": "joe-biden",
}

TYPE_MAP = {
    "Executive Order": "executive_order",
    "Proclamation": "proclamation",
    "Presidential Memorandum": "memo",
    "Administrative Order": "statement",
    "Determination": "statement",
    "Notice": "statement",
}


def get_speaker_slug(doc):
    """Extract speaker slug from a Federal Register document."""
    president = doc.get("president", {})
    if president:
        identifier = president.get("identifier", "")
        if identifier in FR_PRESIDENT_SLUGS:
            return FR_PRESIDENT_SLUGS[identifier]
        # Try using the identifier directly as a slug
        if identifier:
            return identifier
    return None


def get_type(doc):
    """Map Federal Register subtype to verbatim type."""
    subtype = doc.get("subtype", "")
    return TYPE_MAP.get(subtype, "statement")


def fetch_documents(doc_type, since=None, dry_run=False):
    """Fetch documents from Federal Register API with pagination."""
    params = {
        "conditions[presidential_document_type]": doc_type,
        "per_page": PER_PAGE,
        "fields[]": [
            "title", "document_number", "signing_date", "publication_date",
            "html_url", "raw_text_url", "president", "subtype", "abstract",
            "executive_order_number", "citation",
        ],
        "order": "oldest",
    }

    if since:
        params["conditions[signing_date][gte]"] = since

    records = []
    page = 1
    total_pages = None

    while True:
        params["page"] = page
        url = f"{API_BASE}/documents.json"

        print(f"  Fetching page {page}{f'/{total_pages}' if total_pages else ''}...")

        # A failed page used to end the loop as if the list were complete,
        # which silently truncated it. Stop the run instead.
        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            sys.exit(f"  Error fetching page {page}: {e}. Stopping; nothing inserted.")

        data = resp.json()
        results = data.get("results", [])

        if total_pages is None:
            total_count = data.get("count", 0) or data.get("total_count", 0)
            if total_count:
                total_pages = (total_count + PER_PAGE - 1) // PER_PAGE
                print(f"  Total documents: {total_count} ({total_pages} pages)")
            else:
                print(f"  Paginating (total count unavailable)...")

        if not results:
            break

        for doc in results:
            speaker = get_speaker_slug(doc)
            if not speaker:
                continue

            title = doc.get("title", "")
            date = doc.get("signing_date") or doc.get("publication_date", "")
            if date:
                date = str(date)[:10]

            source_url = doc.get("html_url", "")
            raw_text_url = doc.get("raw_text_url", "")
            stmt_type = get_type(doc)

            records.append({
                "speaker": speaker,
                "title": title,
                "date": date,
                "type": stmt_type,
                "source_url": source_url,
                "source_name": "federal_register",
                "raw_text_url": raw_text_url,
            })

        next_url = data.get("next_page_url")
        if not next_url:
            break

        page += 1
        time.sleep(PAGE_DELAY)

    print(f"  Collected {len(records)} document metadata entries")
    return records


STOP_STATUSES = {403, 429, 503}


def fetch_full_text(records, dry_run=False):
    """Fetch full text for each document from its raw_text_url.

    Returns (complete records, failures, stopped). Every document that does
    not come back is named in `failures` as (source_url, reason); they used to
    be counted and dropped, which left holes nobody could see. A 403, 429 or
    503 means the publisher said no: fetching stops there, with no retry.
    """
    complete = []
    failures = []

    for i, rec in enumerate(records):
        raw_url = rec.pop("raw_text_url", "")
        if not raw_url:
            failures.append((rec["source_url"], "no raw_text_url"))
            continue

        if dry_run:
            rec["text"] = "(dry run — text not fetched)"
            rec["id"] = make_id(rec["speaker"], rec["title"] + rec["date"])
            complete.append(rec)
            continue

        if (i + 1) % 50 == 0 or i == 0:
            print(f"  Fetching text [{i+1}/{len(records)}]...")

        try:
            resp = requests.get(raw_url, timeout=30)
        except requests.RequestException as e:
            failures.append((rec["source_url"], f"request failed: {e}"))
            continue
        if resp.status_code in STOP_STATUSES:
            failures.append((rec["source_url"], f"HTTP {resp.status_code}; stopped here"))
            return complete, failures, True
        if resp.status_code != 200:
            failures.append((rec["source_url"], f"HTTP {resp.status_code}"))
            continue
        text = resp.text.strip()

        if not text or len(text) < 50:
            failures.append((rec["source_url"], f"text too short ({len(text)} chars)"))
            continue

        rec["text"] = text
        rec["id"] = make_id(rec["speaker"], text)
        complete.append(rec)

        time.sleep(TEXT_DELAY)

    print(f"  Fetched text for {len(complete)} documents ({len(failures)} failed)")
    return complete, failures, False


def import_federal_register(doc_type="all", since=None, dry_run=False):
    """Import executive orders and/or proclamations from Federal Register."""
    types_to_fetch = []
    if doc_type in ("all", "executive_order"):
        types_to_fetch.append("executive_order")
    if doc_type in ("all", "proclamation"):
        types_to_fetch.append("proclamation")

    all_records = []
    for dtype in types_to_fetch:
        print(f"\n{'='*60}")
        print(f"Fetching {dtype}s from Federal Register API")
        print(f"{'='*60}")
        records = fetch_documents(dtype, since=since, dry_run=dry_run)
        all_records.extend(records)

    if not all_records:
        print("\nNo documents found.")
        return 0

    if dry_run:
        # Show summary without fetching text
        speakers = {}
        types = {}
        for rec in all_records:
            speakers[rec["speaker"]] = speakers.get(rec["speaker"], 0) + 1
            types[rec["type"]] = types.get(rec["type"], 0) + 1

        print(f"\nDry run — would import {len(all_records)} documents:")
        print(f"\nBy speaker:")
        for slug, count in sorted(speakers.items(), key=lambda x: -x[1]):
            name = SPEAKERS.get(slug, slug)
            print(f"  {name}: {count}")
        print(f"\nBy type:")
        for t, count in sorted(types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {count}")
        return len(all_records)

    print(f"\nFetching full text for {len(all_records)} documents...")
    complete, failures, stopped = fetch_full_text(all_records)

    inserted = 0
    if complete:
        print(f"\nBulk inserting {len(complete)} records...")
        inserted = bulk_insert(complete)
    else:
        print("No documents with valid text.")

    for source_url, reason in failures:
        print(f"  NOT FETCHED {source_url}: {reason}")
    if stopped or failures:
        sys.exit(f"{len(failures)} documents not fetched"
                 f"{' (stopped early; rerun later)' if stopped else ''}.")
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Import from Federal Register API")
    parser.add_argument(
        "--type",
        choices=["executive_order", "proclamation", "all"],
        default="all",
        help="Document type to import (default: all)",
    )
    parser.add_argument(
        "--since",
        help="Only import documents signed on or after this date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be imported without fetching text or inserting",
    )
    args = parser.parse_args()

    count = import_federal_register(doc_type=args.type, since=args.since, dry_run=args.dry_run)
    print(f"\nDone. {count} records {'would be imported' if args.dry_run else 'processed'}.")


if __name__ == "__main__":
    main()

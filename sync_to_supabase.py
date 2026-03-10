#!/usr/bin/env python3
"""Sync local corpus.db to Supabase Postgres."""

import os
import sqlite3
import sys
import time

import requests

CORPUS_DB = os.path.join(os.path.dirname(__file__), "corpus.db")

# Supabase config — uses env vars
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ycqvvjyplboqpmqnqenh.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

BATCH_SIZE = 500


def clean_text(val):
    """Strip null bytes that Postgres rejects in text columns."""
    if val and isinstance(val, str):
        return val.replace("\x00", "")
    return val


def get_local_records():
    """Read all records from local SQLite corpus."""
    conn = sqlite3.connect(CORPUS_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, speaker, date, type, source_url, source_name, text, title FROM statements ORDER BY date"
    ).fetchall()
    conn.close()
    records = []
    for r in rows:
        rec = dict(r)
        rec["text"] = clean_text(rec["text"])
        rec["title"] = clean_text(rec["title"])
        rec["source_url"] = clean_text(rec["source_url"])
        records.append(rec)
    return records


def upsert_batch(records):
    """Upsert a batch of records to Supabase via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/statements"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    resp = requests.post(url, json=records, headers=headers, timeout=120)
    if resp.status_code not in (200, 201):
        print(f"  ERROR {resp.status_code}: {resp.text[:200]}")
        return False
    return True


def sync():
    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_SERVICE_KEY environment variable")
        print("  Get it from: Supabase Dashboard → Settings → API → service_role key")
        sys.exit(1)

    print(f"Reading from {CORPUS_DB}...")
    records = get_local_records()
    print(f"  {len(records)} records to sync")

    total_synced = 0
    total_batches = (len(records) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} records)...", end=" ", flush=True)

        if upsert_batch(batch):
            total_synced += len(batch)
            print("OK")
        else:
            print("FAILED")
            # Retry once after a short delay
            time.sleep(2)
            if upsert_batch(batch):
                total_synced += len(batch)
                print("  Retry OK")
            else:
                print("  Retry FAILED — skipping batch")

    print(f"\nDone. {total_synced}/{len(records)} records synced to Supabase.")


if __name__ == "__main__":
    sync()

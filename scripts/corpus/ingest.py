#!/usr/bin/env python3
"""JSONL corpus manager and SQLite loader for verbatim."""

import hashlib
import json
import os
import sqlite3
import sys

# Every path the pipeline reads or writes hangs off these constants, so no
# script depends on the directory it is run from. The scrape (corpus.db,
# corpus.jsonl, sources.json) lives in data/corpus/ under the repo root, which
# is gitignored: none of it is committed. Raw downloads cache in
# tmp/corpus/raw/, also ignored. Set CORPUS_DIR to keep the data elsewhere.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CORPUS_DIR = os.environ.get("CORPUS_DIR") or os.path.join(REPO_ROOT, "data", "corpus")
RAW_DIR = os.path.join(REPO_ROOT, "tmp", "corpus", "raw")
CORPUS_JSONL = os.path.join(CORPUS_DIR, "corpus.jsonl")
CORPUS_DB = os.path.join(CORPUS_DIR, "corpus.db")
SOURCES_LOG = os.path.join(CORPUS_DIR, "sources.json")
EXPORT_DIR = os.path.join(CORPUS_DIR, "export")


def user_agent():
    """User-Agent for polite scraping, with a contact read from the environment.

    WikiSource and Project Gutenberg ask automated clients to identify themselves
    with a way to reach the operator. Set CORPUS_UA_CONTACT to an email address or
    URL before running any import script.
    """
    contact = os.environ.get("CORPUS_UA_CONTACT", "").strip()
    if not contact:
        sys.exit("CORPUS_UA_CONTACT is not set. Export a contact (email or URL) "
                 "for the User-Agent header, then rerun.")
    return f"verbatim-corpus/0.1 (https://verbatim.fyi; {contact})"

VALID_TYPES = {"tweet", "truth_social", "speech", "interview", "press_gaggle", "statement", "press_conference", "remarks", "earnings_call", "memo", "letter", "executive_order", "proclamation", "address", "founding_document", "essay", "debate", "floor_speech", "opinion"}


def make_id(speaker, text):
    return hashlib.sha256(f"{speaker}:{text.strip()}".encode()).hexdigest()


def validate_record(record):
    text = record.get("text", "").strip()
    speaker = record.get("speaker", "").strip()
    if not text or not speaker:
        return None
    rec = {
        "id": record.get("id") or make_id(speaker, text),
        "speaker": speaker,
        "date": record.get("date") or None,
        "type": record.get("type", "statement"),
        "source_url": record.get("source_url", ""),
        "source_name": record.get("source_name", "manual"),
        "text": text,
        "title": record.get("title", ""),
    }
    if rec["type"] not in VALID_TYPES:
        rec["type"] = "statement"
    return rec


def append_jsonl(record):
    rec = validate_record(record)
    if not rec:
        return None
    os.makedirs(CORPUS_DIR, exist_ok=True)
    with open(CORPUS_JSONL, "a") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def init_db(db_path=None):
    db_path = db_path or CORPUS_DB
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS statements (
            id TEXT PRIMARY KEY,
            speaker TEXT,
            date TEXT,
            type TEXT,
            source_url TEXT,
            source_name TEXT,
            text TEXT,
            title TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_speaker ON statements(speaker)")
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS statements_fts
        USING fts5(text, content='statements', content_rowid='rowid')
    """)
    conn.executescript("""
        CREATE TRIGGER IF NOT EXISTS statements_ai AFTER INSERT ON statements BEGIN
            INSERT INTO statements_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS statements_ad AFTER DELETE ON statements BEGIN
            INSERT INTO statements_fts(statements_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS statements_au AFTER UPDATE ON statements BEGIN
            INSERT INTO statements_fts(statements_fts, rowid, text) VALUES('delete', old.rowid, old.text);
            INSERT INTO statements_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
    """)
    conn.commit()
    return conn


COLUMNS = "(id, speaker, date, type, source_url, source_name, text, title)"
PLACEHOLDERS = "(?, ?, ?, ?, ?, ?, ?, ?)"


def _record_tuple(rec):
    return (rec["id"], rec["speaker"], rec["date"], rec["type"], rec["source_url"], rec["source_name"], rec["text"], rec["title"])


def load_jsonl_to_db(jsonl_path=None, db_path=None):
    jsonl_path = jsonl_path or CORPUS_JSONL
    db_path = db_path or CORPUS_DB

    if not os.path.exists(jsonl_path):
        print(f"No corpus file at {jsonl_path}")
        return 0

    conn = init_db(db_path)
    loaded = 0
    skipped = 0

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            rec = validate_record(record)
            if not rec:
                skipped += 1
                continue

            try:
                conn.execute(
                    f"INSERT OR IGNORE INTO statements {COLUMNS} VALUES {PLACEHOLDERS}",
                    _record_tuple(rec),
                )
                loaded += 1
            except sqlite3.IntegrityError:
                skipped += 1

    conn.commit()
    conn.close()
    print(f"Loaded {loaded} records, skipped {skipped} duplicates/invalid")
    return loaded


def add_record(record):
    rec = append_jsonl(record)
    if not rec:
        return None
    conn = init_db()
    try:
        conn.execute(
            f"INSERT OR IGNORE INTO statements {COLUMNS} VALUES {PLACEHOLDERS}",
            _record_tuple(rec),
        )
        conn.commit()
    finally:
        conn.close()
    return rec


def bulk_insert(records, db_path=None):
    """Validate and insert a list of records efficiently via executemany."""
    db_path = db_path or CORPUS_DB
    conn = init_db(db_path)
    valid = []
    skipped = 0
    for record in records:
        rec = validate_record(record)
        if rec:
            valid.append(_record_tuple(rec))
        else:
            skipped += 1
    try:
        conn.executemany(
            f"INSERT OR IGNORE INTO statements {COLUMNS} VALUES {PLACEHOLDERS}",
            valid,
        )
        conn.commit()
    finally:
        conn.close()
    inserted = len(valid)
    print(f"Bulk insert: {inserted} records processed ({skipped} invalid, duplicates silently ignored)")
    return inserted


def import_file(filepath):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 0

    with open(filepath) as f:
        content = f.read().strip()

    records = []
    try:
        data = json.loads(content)
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            records = [data]
    except json.JSONDecodeError:
        for line in content.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    added = 0
    for record in records:
        if add_record(record):
            added += 1

    print(f"Imported {added} records from {filepath}")
    return added


if __name__ == "__main__":
    if len(sys.argv) > 1:
        for filepath in sys.argv[1:]:
            import_file(filepath)
    else:
        load_jsonl_to_db()

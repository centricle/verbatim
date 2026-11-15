#!/usr/bin/env python3
"""Export corpus.db to flat text files organized by speaker."""

import os
import re
import sqlite3

from ingest import CORPUS_DB as DB_PATH, EXPORT_DIR as OUTPUT_DIR


def slugify(text):
    """Convert text to filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def export():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        "SELECT speaker, date, type, title, text, source_name "
        "FROM statements ORDER BY speaker, date"
    )

    counts = {}
    for row in cur:
        speaker = row["speaker"]
        date = row["date"] or "undated"
        title = row["title"] or "untitled"
        doc_type = row["type"] or "unknown"
        text = row["text"] or ""
        source = row["source_name"] or ""

        speaker_dir = os.path.join(OUTPUT_DIR, speaker)
        os.makedirs(speaker_dir, exist_ok=True)

        slug = slugify(title)[:80]
        filename = f"{date}-{slug}.txt"

        # Handle duplicates within same speaker
        filepath = os.path.join(speaker_dir, filename)
        if os.path.exists(filepath):
            i = 2
            while os.path.exists(filepath):
                filename = f"{date}-{slug}-{i}.txt"
                filepath = os.path.join(speaker_dir, filename)
                i += 1

        # Write with minimal header
        with open(filepath, "w") as f:
            f.write(f"{title}\n")
            f.write(f"{date} | {doc_type}")
            if source:
                f.write(f" | {source}")
            f.write("\n")
            f.write("-" * 40 + "\n\n")
            f.write(text)
            if not text.endswith("\n"):
                f.write("\n")

        counts[speaker] = counts.get(speaker, 0) + 1

    conn.close()

    total = sum(counts.values())
    print(f"Exported {total:,} documents across {len(counts)} speakers to {OUTPUT_DIR}/")
    for speaker in sorted(counts):
        print(f"  {speaker}: {counts[speaker]:,}")


if __name__ == "__main__":
    export()

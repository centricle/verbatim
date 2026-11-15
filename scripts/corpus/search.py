#!/usr/bin/env python3
"""Search CLI for verbatim public speech corpus."""

import argparse
import json
import os
import re
import sqlite3
import sys

from scrape import SPEAKERS

from ingest import CORPUS_DB

# ANSI colors
BOLD = "\033[1m"
DIM = "\033[2m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREEN = "\033[32m"
RED = "\033[31m"
MAGENTA = "\033[35m"
RESET = "\033[0m"


def highlight(text, query_terms, max_len=200):
    """Show snippet with highlighted matching terms."""
    text_lower = text.lower()

    best_pos = 0
    for term in query_terms:
        pos = text_lower.find(term.lower())
        if pos >= 0:
            best_pos = pos
            break

    start = max(0, best_pos - 80)
    end = min(len(text), start + max_len)
    if start > 0:
        while start > 0 and text[start] != " ":
            start -= 1
        start += 1

    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    for term in query_terms:
        pattern = re.compile(re.escape(term), re.IGNORECASE)
        snippet = pattern.sub(f"{YELLOW}{BOLD}\\g<0>{RESET}", snippet)

    return snippet


def speaker_display(slug):
    return SPEAKERS.get(slug, slug.replace("-", " ").title())


def search(query, date_filter=None, type_filter=None, speaker_filter=None, count_only=False, export_path=None):
    if not os.path.exists(CORPUS_DB):
        print(f"{RED}No corpus database found. Run: python ingest.py{RESET}")
        sys.exit(1)

    conn = sqlite3.connect(CORPUS_DB)
    conn.row_factory = sqlite3.Row

    where_clauses = []
    params = []

    if query:
        where_clauses.append("s.rowid IN (SELECT rowid FROM statements_fts WHERE statements_fts MATCH ?)")
        params.append(query)

    if date_filter:
        if len(date_filter) == 4:
            where_clauses.append("s.date LIKE ?")
            params.append(f"{date_filter}%")
        elif len(date_filter) == 7:
            where_clauses.append("s.date LIKE ?")
            params.append(f"{date_filter}%")
        else:
            where_clauses.append("s.date = ?")
            params.append(date_filter)

    if type_filter:
        where_clauses.append("s.type = ?")
        params.append(type_filter)

    if speaker_filter:
        where_clauses.append("s.speaker = ?")
        params.append(speaker_filter)

    where = " AND ".join(where_clauses) if where_clauses else "1=1"

    if count_only:
        row = conn.execute(f"SELECT COUNT(*) as cnt FROM statements s WHERE {where}", params).fetchone()
        print(f"{row['cnt']} matching records")
        conn.close()
        return

    sql = f"SELECT s.* FROM statements s WHERE {where} ORDER BY s.date DESC"
    rows = conn.execute(sql, params).fetchall()

    if export_path:
        results = [dict(r) for r in rows]
        with open(export_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Exported {len(results)} records to {export_path}")
        conn.close()
        return

    if not rows:
        print(f"{DIM}No results found.{RESET}")
        conn.close()
        return

    query_terms = query.split() if query else []

    print(f"\n{BOLD}{len(rows)} results{RESET}\n")

    for row in rows:
        date = row["date"] or "unknown"
        rtype = row["type"]
        source = row["source_name"]
        name = speaker_display(row["speaker"])
        title = row["title"]

        print(f"{MAGENTA}{name}{RESET}  {CYAN}{date}{RESET}  {GREEN}{rtype}{RESET}  {DIM}[{source}]{RESET}")
        if title:
            print(f"  {BOLD}{title}{RESET}")
        if query_terms:
            print(f"  {highlight(row['text'], query_terms)}")
        else:
            text = row["text"][:200]
            if len(row["text"]) > 200:
                text += "..."
            print(f"  {text}")
        print()

    conn.close()


def list_speakers():
    """List all speakers in the corpus with record counts."""
    if not os.path.exists(CORPUS_DB):
        print(f"{RED}No corpus database found. Run: python ingest.py{RESET}")
        return

    conn = sqlite3.connect(CORPUS_DB)
    rows = conn.execute("SELECT speaker, COUNT(*) as cnt FROM statements GROUP BY speaker ORDER BY cnt DESC").fetchall()

    if not rows:
        print(f"{DIM}No speakers in corpus.{RESET}")
        conn.close()
        return

    print(f"\n{BOLD}Speakers in corpus{RESET}\n")
    for row in rows:
        name = speaker_display(row[0])
        print(f"  {name} ({row[0]}): {row[1]} records")

    conn.close()


def stats():
    """Show corpus statistics."""
    if not os.path.exists(CORPUS_DB):
        print(f"{RED}No corpus database found. Run: python ingest.py{RESET}")
        return

    conn = sqlite3.connect(CORPUS_DB)

    total = conn.execute("SELECT COUNT(*) FROM statements").fetchone()[0]
    print(f"\n{BOLD}Corpus Statistics{RESET}")
    print(f"  Total records: {total}")

    if total == 0:
        conn.close()
        return

    print(f"\n  {BOLD}By speaker:{RESET}")
    for row in conn.execute("SELECT speaker, COUNT(*) as cnt FROM statements GROUP BY speaker ORDER BY cnt DESC"):
        print(f"    {speaker_display(row[0])}: {row[1]}")

    print(f"\n  {BOLD}By type:{RESET}")
    for row in conn.execute("SELECT type, COUNT(*) as cnt FROM statements GROUP BY type ORDER BY cnt DESC"):
        print(f"    {row[0]}: {row[1]}")

    print(f"\n  {BOLD}By source:{RESET}")
    for row in conn.execute("SELECT source_name, COUNT(*) as cnt FROM statements GROUP BY source_name ORDER BY cnt DESC"):
        print(f"    {row[0]}: {row[1]}")

    row = conn.execute("SELECT MIN(date), MAX(date) FROM statements WHERE date IS NOT NULL").fetchone()
    if row[0]:
        print(f"\n  Date range: {row[0]} to {row[1]}")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Search the verbatim public speech corpus")
    parser.add_argument("query", nargs="?", help="Search query (FTS5 syntax)")
    parser.add_argument("--date", help="Filter by date (YYYY, YYYY-MM, or YYYY-MM-DD)")
    parser.add_argument("--type", help="Filter by type (speech, tweet, interview, etc.)")
    parser.add_argument("--speaker", help="Filter by speaker slug (e.g. donald-trump)")
    parser.add_argument("--speakers", action="store_true", help="List all speakers in corpus")
    parser.add_argument("--count", action="store_true", help="Show only result count")
    parser.add_argument("--export", help="Export results to JSON file")
    parser.add_argument("--stats", action="store_true", help="Show corpus statistics")
    args = parser.parse_args()

    if args.speakers:
        list_speakers()
        return

    if args.stats:
        stats()
        return

    if not args.query and not any([args.date, args.type, args.speaker]):
        stats()
        return

    search(args.query, date_filter=args.date, type_filter=args.type, speaker_filter=args.speaker, count_only=args.count, export_path=args.export)


if __name__ == "__main__":
    main()

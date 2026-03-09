# Verbatim

Private research tool. Collects publicly available speech transcripts and posts into a searchable local corpus. Any public figure: presidents, CEOs, founders, civil rights leaders.

**Content constraint:** Public domain only. All presidential speeches are public domain (17 U.S.C. § 105 — government works). No copyrighted full text.

## Setup

```bash
pip install -r requirements.txt
```

## Bulk Import (recommended for initial population)

### Miller Center (UVA) — All Presidents

Downloads structured JSON of ~1,000-2,000 presidential speeches, Washington through present.

```bash
python import_miller.py --inspect          # Inspect JSON structure
python import_miller.py --dry-run          # Preview what would be imported
python import_miller.py                    # Full import
```

### Federal Register API — Executive Orders & Proclamations

Free API, no auth key. ~6,000 documents from 1937 to present.

```bash
python import_federal_register.py --dry-run                          # Preview all
python import_federal_register.py --type executive_order             # EOs only
python import_federal_register.py --type proclamation                # Proclamations only
python import_federal_register.py --type all                         # Everything
python import_federal_register.py --type all --since 2026-03-01      # Incremental update
```

## Scraping

```bash
python scrape.py --source rev --speaker donald-trump       # Rev.com transcripts
python scrape.py --source rev --speaker barack-obama       # Different speaker
python scrape.py --source twitter                          # Trump Twitter archive (Trump only)
python scrape.py --source ucsb --speaker donald-trump      # UCSB Presidency Project (slow)
python scrape.py --dry-run --source rev --speaker donald-trump  # Preview without fetching
```

## Loading

```bash
python ingest.py                     # Load corpus.jsonl into SQLite
python ingest.py somefile.json       # Import external JSON/JSONL file
```

Records must include a `speaker` field (slug format, e.g. `donald-trump`).

## Searching

```bash
python search.py "tariffs"                                  # Full-text search
python search.py --speaker donald-trump "tariffs"           # Filter by speaker
python search.py --speaker george-washington                # Browse a speaker
python search.py --date 2025 "tariffs"                     # Filter by year
python search.py --type executive_order                     # Filter by type
python search.py --count "tariffs"                         # Result count only
python search.py --export results.json "tariffs"           # Export to JSON
python search.py --speakers                                 # List speakers in corpus
python search.py --stats                                    # Corpus statistics
```

## Speaker Slugs

Speakers are identified by slug (lowercase, hyphenated). Full presidential roster built in. Examples:

- `george-washington`, `john-adams`, `thomas-jefferson`
- `abraham-lincoln`, `theodore-roosevelt`, `franklin-d-roosevelt`
- `barack-obama`, `donald-trump`, `joe-biden`

Any slug works for manual imports. The built-in display name table covers all 46 presidents.

## Sources

| Source | Method | Coverage | Records (est.) |
|--------|--------|----------|---------------|
| Miller Center (UVA) | Bulk JSON download | All presidents, 1789-present | ~1,000-2,000 |
| Federal Register API | REST API w/ pagination | EOs & proclamations, 1937-present | ~6,000 |
| Twitter Archive | GitHub JSON mirrors | Trump only, 2017-2020 | ~25,000 |
| Rev.com | HTML scraping | Targeted transcripts | Varies |
| UCSB Presidency Project | HTML scraping | Presidential documents | Slow (10s delay) |

## Ongoing Updates

No cron, no automation. Federal Register API supports date filtering:

```bash
python import_federal_register.py --type all --since 2026-03-01
```

Run weekly, monthly, whenever. The corpus doesn't need real-time freshness.

## Data

- `corpus.jsonl` — append-only raw records (gitignored)
- `corpus.db` — SQLite + FTS5 for querying (gitignored)
- `sources.json` — scraping log (gitignored)

## Record Shape

```json
{
  "id": "<sha256 of speaker + text>",
  "speaker": "donald-trump",
  "date": "2025-01-20",
  "type": "speech",
  "source_url": "https://...",
  "source_name": "miller_center",
  "text": "...",
  "title": "Inaugural Address"
}
```

Valid types: `tweet`, `truth_social`, `speech`, `interview`, `press_gaggle`, `statement`, `remarks`, `press_conference`, `earnings_call`, `memo`, `letter`, `executive_order`, `proclamation`, `address`.

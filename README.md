# Verbatim

**250 years of American political speech, searchable.**

43,990+ records from 91 speakers spanning 1776 to 2025. The Federalist Papers, the Constitution, the Bill of Rights, the Declaration of Independence, presidential speeches, executive orders, proclamations, press conferences, and yes, tweets. One full-text search index.

**Live:** [verbatim.fyi](https://verbatim.fyi)

## Why

The founding documents are the most time-tested political texts in the American tradition. The confusion is the interpretation layer. The clarity is the actual words.

Search "tariffs" and get Hamilton in 1791 next to executive orders from 2025 making the same structural argument. Search "foreign" and Washington's Farewell Address sits alongside modern proclamations. The anxiety about external manipulation is a continuous thread from the founding to this week.

The tool exists because the builder needed it.

## Stack

- **Frontend:** Vanilla JS + Tailwind 4 + Vite
- **Database:** Supabase (Postgres with tsvector FTS + GIN index)
- **Hosting:** Netlify (static deploy)
- **Data pipeline:** Python (scrape/import → local SQLite → sync to Supabase)

No framework. No server. Browser talks directly to Supabase.

## Corpus Sources

| Source | Records | Content |
|--------|---------|---------|
| Trump Tweet Archive (GitHub) | 36,167 | Trump tweets 2009-2018 |
| Federal Register API | 5,885 | Executive orders + proclamations |
| Miller Center (UVA) | 1,052 | Presidential speeches (all 45 presidents) |
| Project Gutenberg | 88 | Federalist Papers, Constitution, Bill of Rights, Declaration |

Tweets are opt-in via toggle. Default view shows the 7,025-record non-tweet corpus.

## Local Development

```bash
npm install
npm run dev          # Vite dev server on port 8033
```

The frontend connects directly to the production Supabase instance. No local server needed for browsing.

### Data Pipeline (corpus curation)

Requires Python 3.9+ and `pip install -r requirements.txt`.

```bash
# Import from sources
python import_miller.py                    # Miller Center presidential speeches
python import_federal_register.py          # Federal Register EOs + proclamations
python import_founding.py                  # Founding documents from Gutenberg

# Sync local SQLite → Supabase
SUPABASE_SERVICE_KEY=... python sync_to_supabase.py
```

The pipeline writes to local `corpus.db` (SQLite) for curation, then syncs to Supabase for production. The DB file is gitignored (118MB, regenerable).

## Record Schema

```json
{
  "id": "<sha256 of speaker:text>",
  "speaker": "alexander-hamilton",
  "date": "1787-10-27",
  "type": "essay",
  "source_url": "https://www.gutenberg.org/ebooks/1404",
  "source_name": "project_gutenberg",
  "text": "...",
  "title": "Federalist No. 1"
}
```

Types: `tweet`, `speech`, `address`, `remarks`, `press_conference`, `press_gaggle`, `interview`, `statement`, `executive_order`, `proclamation`, `memo`, `letter`, `founding_document`, `essay`

## License

Code: MIT. Corpus data is public domain (US government works, Project Gutenberg, public tweet archives).

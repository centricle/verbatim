# Corpus pipeline

The scrapers and importers behind Verbatim's speech corpus: presidential
addresses, executive orders and proclamations, founding documents, debate
transcripts, Congressional floor speeches, Supreme Court opinions, and the
speeches, letters and essays of a handful of non-presidential voices.

Each record is one statement with a speaker, date, type, title, source name and
source URL. Records are keyed by `sha256(speaker:text)`, so rerunning an import
never duplicates a record.

## Sources

| Source | Script | What it supplies |
|---|---|---|
| Miller Center, University of Virginia | `import_miller.py` | Presidential speeches (bulk download, `data.millercenter.org`) |
| Federal Register API | `import_federal_register.py` | Executive orders and proclamations |
| Project Gutenberg | `import_founding.py` | Declaration of Independence, Constitution, Bill of Rights, Federalist Papers |
| National Archives | `import_constitution.py` | The Constitution's Preamble and seven Articles and the 27 amendments, one record each, from the archive's transcriptions (the release uses these in place of the Gutenberg Constitution and Bill of Rights) |
| UCSB American Presidency Project | `import_debates.py` | General-election presidential and VP debate transcripts, 1960 to 2024 |
| WikiSource, American Rhetoric, Project Gutenberg | `import_congress.py` | Landmark Congressional floor speeches |
| WikiSource, Cornell LII | `import_scotus.py` | Landmark Supreme Court opinions |
| Cornell LII, WikiSource | `import_opinions.py` | Opinions of the Court, one per decision and credited to the author the opinion names: Brown, the decisions paired with corpus opinions by the Constitution Annotated's table of overruled decisions, and full-text replacements for corpus records that hold a syllabus or part of an opinion |
| GovInfo (Government Publishing Office) | `import_govinfo.py` | Statements taken from GPO prints in place of transcript-site copies: Barbara Jordan's 1974 impeachment statement, from the Judiciary Committee's print, and Shirley Chisholm's 1970 Equal Rights Amendment remarks, from the bound Congressional Record scan (needs `pdftotext` from poppler) |
| Historic Hansard (UK Parliament) | `import_hansard.py` | Four of Churchill's 1940 House of Commons speeches. Kept in `corpus.db` and out of the release: the Open Parliament Licence covers Parliament's report, not the Churchill estate's rights in the speeches |
| Project Gutenberg, WikiSource | `import_churchill.py`, `import_douglass.py`, `import_franklin.py`, `import_suffrage.py`, `import_twain.py` | Speeches, letters and essays by non-presidential voices |
| Project Gutenberg, WikiSource | `deepen_lincoln.py`, `deepen_voices.py` | Additional records for speakers with thin coverage |
| Project Gutenberg | `import_lincoln.py` | Two Lincoln books re-split one record per document, in place of `deepen_lincoln.py`'s split of them; the Ottawa debate's opening speech is credited to Douglas |
| Project Gutenberg | `import_gutenberg_sotu.py` | State of the Union messages missing from the Miller Center download: Roosevelt 1934 to 1940, 1942 and 1945, Truman 1946 to 1953, Eisenhower 1961, Nixon 1973, Carter 1981 |
| Public archive mirror | `scrape.py --source twitter` | Archived social media posts |

Each script's docstring lists its exact sources (Gutenberg ebook numbers,
WikiSource page titles). Rights differ by source, and not all of this material
is public domain. `scrape.py` also carries Rev.com and UCSB scrapers, kept for
reference only; read its docstring before running either.

## Where the data goes

Nothing the pipeline produces is committed. Every path comes from the constants
at the top of `ingest.py`:

| Path | Contents |
|---|---|
| `data/corpus/corpus.db` | SQLite, one `statements` table plus a full-text index |
| `data/corpus/corpus.jsonl` | Records added one at a time through `ingest.add_record` |
| `data/corpus/sources.json` | Log of what `scrape.py` has fetched |
| `data/corpus/export/` | Flat text files written by `export_corpus.py` |
| `data/corpus/release.jsonl` | The release, written by `build_release.py` |
| `data/corpus/release-report.json` | What the release builder kept, changed and left out, and why |
| `tmp/corpus/raw/` | Cached downloads, so a rerun does not refetch |

Set `CORPUS_DIR` to keep the data somewhere other than `data/corpus/`.

## Rebuilding

Python 3. Run everything from the repository root.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/corpus/requirements.txt

# The import scripts identify themselves to WikiSource and Gutenberg.
# They exit without this set.
export CORPUS_UA_CONTACT="you@example.com"

python3 scripts/corpus/import_miller.py            # --dry-run to preview, --inspect to see the JSON
python3 scripts/corpus/import_federal_register.py
python3 scripts/corpus/import_founding.py
python3 scripts/corpus/import_constitution.py      # --dry-run to parse and check only
python3 scripts/corpus/import_opinions.py          # --dry-run to parse and check only
python3 scripts/corpus/import_hansard.py           # --dry-run to parse and check only
python3 scripts/corpus/import_lincoln.py           # --dry-run to parse and check only
python3 scripts/corpus/import_govinfo.py           # --dry-run to parse and check only
python3 scripts/corpus/import_debates.py
# ...then any of the other import_*.py and deepen_*.py scripts, in any order
```

`ingest.py` manages the database: with no arguments it reloads
`corpus.jsonl` into `corpus.db`, and with file arguments it imports JSON or
JSONL records from them.

## The release

`corpus.db` is the scrape as imported, and nothing after the importers writes to
it. What the site serves is built from it:

```bash
python3 scripts/corpus/build_release.py --summary
```

The builder needs only the standard library. It opens `corpus.db` read-only,
applies the rules at the top of `build_release.py` and writes `release.jsonl`
and `release-report.json`. The rules cover works the importers got wrong (a
novel filed under a statesman, a book split in the wrong places), retweets,
dates (the tweet scrape lost its years, which come back from the status ids),
collections (`core`, `executive`, `tweets`, `voices`), a normalized `genre` beside the
original `type`, a rights basis per work, amendment dates (from `amendments.json`,
which reconciles three government sources and states its conventions), the
Miller Center pages its bulk download leaves out (`miller_urls.json`), what
publishers and editors added around the words (GPO's Federal Register header,
page markers and footer, with the FR Doc number kept as an `fr_doc` field; HTML
entities left as text; editors' captions, headnotes and footnotes in the Twain
and Churchill books), dates a source prints wrong (`DATE_FIXES`, each quoting the
record that settles it), and near-duplicates. Each excluded or
changed record is listed in the report with the rule that did it. Rerunning on
the same `corpus.db` gives byte-identical output. Speakers' display names come
from `speakers.json`.

```bash
python3 scripts/corpus/check_release.py    # invariants; exits 1 if any fails
```

## Into Postgres

`/corpus/` searches the `core` and `voices` collections in Postgres (Neon).
The Node side loads the release as it is and changes no value:

```bash
npm run corpus -- schema     # apply db/corpus.sql: table, search, stats, get-one
npm run corpus -- load       # replace every row in one transaction
npm run corpus -- check      # release vs loaded, every column; exits 1 on a mismatch
npm run corpus -- sample 20  # stratified rows to tmp/corpus/sample.json for a reviewer
npm test                     # check.mjs against fixtures with planted defects
```

`parse.mjs` picks the collections and columns, `check.mjs` compares a raw scan
of `release.jsonl` (no JSON parser), the parsed rows and every loaded row.
`make-fixtures.mjs` rebuilds `fixtures/release.jsonl` from real records cut to
400 characters. After changing a stored function, regenerate `db/schema.sql`
(its header says how).

## Searching it locally

```bash
python3 scripts/corpus/search.py "tariff"          # full-text search, highlighted
python3 scripts/corpus/search.py --help            # date, type and speaker filters, export
python3 scripts/corpus/export_corpus.py            # one folder per speaker under data/corpus/export/
```
